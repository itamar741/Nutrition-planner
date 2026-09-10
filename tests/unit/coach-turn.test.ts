import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeCoachTurn } from "@/application/coach-turn";
import { createExistingDemoState } from "@/data/demo-fixtures";
import type { AgentInteraction } from "@/domain/agent/types";
import type {
  FoodApprovalCandidate,
  FoodSearchCandidate,
} from "@/domain/catalog/runtime";
import type { CatalogFood } from "@/domain/catalog/types";
import {
  createLookup,
  getProfile,
  mutateProfile,
  resetMemoryPersistenceForTests,
  saveCandidates,
} from "@/persistence/repository";
import { makeReadyState, makeValidDraft } from "../fixtures/turn-2";

const agent = vi.hoisted(() => ({
  systemPrompts: [] as string[],
  conversations: [] as Array<
    Array<{ role: "assistant" | "user"; content: string }>
  >,
  tool: null as null | { name: string; arguments: Record<string, unknown> },
  toolSequence: [] as Array<{
    name: string;
    arguments: Record<string, unknown>;
  }>,
  allowedAfterCalls: [] as string[][],
  requiredFirstTools: [] as Array<string | null>,
  responseText: "Completed safely.",
  toolResults: [] as Array<Record<string, unknown>>,
}));

const foodSearch = vi.hoisted(() => ({
  summaries: [
    {
      fdcId: 100,
      title: "Milk chocolate",
      description: "SR Legacy · Sweets",
      dataType: "SR Legacy" as const,
    },
  ],
  ranking: {
    outcome: "clarification" as const,
    message: "Which type of milk would you like to add?",
  },
  searchSummaries: vi.fn(),
}));

vi.mock("@/sources/usda", () => ({
  searchUsdaFoodSummaries: (...args: unknown[]) => {
    foodSearch.searchSummaries(...args);
    return Promise.resolve(foodSearch.summaries);
  },
  resolveUsdaFoodCandidates: vi.fn(),
  UsdaUnavailableError: class UsdaUnavailableError extends Error {},
  usdaFoodUrl: (fdcId: number) => `https://fdc.example/${fdcId}`,
}));

vi.mock("@/ai/food-catalog", () => ({
  rankUsdaCandidates: () => Promise.resolve(foodSearch.ranking),
}));

vi.mock("@/ai/coach-agent", () => ({
  buildArnoldSystemPrompt: (context: Record<string, unknown>) =>
    `ARNOLD\n${JSON.stringify(context)}`,
  runCoachAgent: vi.fn(
    async (input: {
      getSystemPrompt: () => string;
      conversation: Array<{
        role: "assistant" | "user";
        content: string;
      }>;
      getAllowedTools: () => string[];
      getRequiredFirstTool?: () => string | null;
      onText: (delta: string) => void;
      onTool: (
        call: {
          name: string;
          callId: string;
          arguments: Record<string, unknown>;
        },
        sequence: number,
      ) => Promise<Record<string, unknown>>;
    }) => {
      agent.systemPrompts.push(input.getSystemPrompt());
      agent.conversations.push(structuredClone(input.conversation));
      agent.requiredFirstTools.push(input.getRequiredFirstTool?.() ?? null);
      const tools = agent.toolSequence.length
        ? agent.toolSequence
        : agent.tool
          ? [agent.tool]
          : [];
      for (const [index, tool] of tools.entries()) {
        const allowed = input.getAllowedTools();
        agent.allowedAfterCalls.push([...allowed]);
        if (!allowed.includes(tool.name)) break;
        agent.toolResults.push(
          await input.onTool(
            { ...tool, callId: `mock-call-${index + 1}` },
            index + 1,
          ),
        );
      }
      agent.allowedAfterCalls.push([...input.getAllowedTools()]);
      input.onText(agent.responseText);
      return {
        text: agent.responseText,
        toolCall: agent.tool,
        toolResult: null,
      };
    },
  ),
}));

const identity = { sessionHash: "session", ipHash: "ip" };

function turnInput(
  profileId: "new" | "existing",
  expectedVersion: number,
  commandId: string,
  text: string,
) {
  return {
    request: {
      profileId,
      expectedVersion,
      commandId,
      input: { type: "text" as const, text },
    },
    rateIdentity: identity,
    turnId: commandId,
    onStatus: vi.fn(),
    onText: vi.fn(),
  };
}

describe("unified coach orchestration", () => {
  beforeEach(() => {
    resetMemoryPersistenceForTests();
    agent.systemPrompts = [];
    agent.conversations = [];
    agent.tool = null;
    agent.toolSequence = [];
    agent.allowedAfterCalls = [];
    agent.requiredFirstTools = [];
    agent.responseText = "Completed safely.";
    agent.toolResults = [];
    foodSearch.searchSummaries.mockReset();
    foodSearch.ranking = {
      outcome: "clarification",
      message: "Which type of milk would you like to add?",
    };
    delete process.env.OPENAI_CONTEXT_WINDOW;
  });

  it("records today's weight and edits a historical weight through bounded tools", async () => {
    const initial = await getProfile("existing");
    agent.tool = { name: "record_weight", arguments: { weightKg: 80.25 } };
    const recorded = await executeCoachTurn(
      turnInput(
        "existing",
        initial.version,
        "agent-weight-current",
        "80.25 kg today",
      ),
    );
    const today = new Date().toISOString().slice(0, 10);
    expect(
      "measurements" in recorded.profile.state
        ? recorded.profile.state.measurements.find(
            (item) => item.date === today,
          )?.weightKg
        : null,
    ).toBe(80.25);

    const historicalDate = createExistingDemoState().measurements[0].date;
    agent.tool = {
      name: "edit_weight",
      arguments: { date: historicalDate, weightKg: 81.09 },
    };
    const edited = await executeCoachTurn(
      turnInput(
        "existing",
        recorded.profile.version,
        "agent-weight-history",
        `Change ${historicalDate} to 81.09 kg`,
      ),
    );
    expect(
      "measurements" in edited.profile.state
        ? edited.profile.state.measurements.find(
            (item) => item.date === historicalDate,
          )?.weightKg
        : null,
    ).toBe(81.09);
  });

  it("does not treat typed approval language as an Active Plan approval", async () => {
    const initial = await getProfile("existing");
    const result = await executeCoachTurn(
      turnInput(
        "existing",
        initial.version,
        "agent-typed-approval",
        "approve it",
      ),
    );
    expect(
      "measurements" in result.profile.state
        ? result.profile.state.activePlan.version
        : null,
    ).toBe(1);
  });

  it("offers a Maintenance adjustment for sustained 700 g drift even when the rate is stable", async () => {
    const initial = await getProfile("existing");
    if (!("measurements" in initial.state))
      throw new Error("Expected Existing state.");
    const seeded = await mutateProfile({
      profileId: "existing",
      expectedVersion: initial.version,
      commandId: "seed-sustained-maintenance-drift",
      mutation: (state) => {
        if ("profile" in state) throw new Error("Expected Existing state.");
        return {
          ...state,
          measurements: state.measurements.map((measurement, index) => ({
            ...measurement,
            weightKg: index < 24 ? 75 : 75.72,
          })),
          activePlan: {
            ...state.activePlan,
            maintenanceReferenceWeightKg: 75,
          },
        };
      },
    });
    if (!("measurements" in seeded.state))
      throw new Error("Expected Existing state.");

    const result = await executeCoachTurn({
      ...turnInput(
        "existing",
        seeded.version,
        "review-sustained-maintenance-drift",
        "unused",
      ),
      request: {
        profileId: "existing",
        expectedVersion: seeded.version,
        commandId: "review-sustained-maintenance-drift",
        input: {
          type: "interaction",
          interactionId: `existing-session-review-v${seeded.state.activePlan.version}`,
          action: "review_trend",
        },
      },
    });

    expect(result.profile.state.agentSession.pendingInteraction).toMatchObject({
      type: "adjustment_offer",
      direction: "decrease",
    });
  });

  it("forces the adjustment skill for the Generate AI proposal control", async () => {
    const initial = await getProfile("existing");
    if (!("measurements" in initial.state))
      throw new Error("Expected Existing state.");
    const seeded = await mutateProfile({
      profileId: "existing",
      expectedVersion: initial.version,
      commandId: "seed-adjustment-control",
      mutation: (state) => {
        if ("profile" in state) throw new Error("Expected Existing state.");
        return {
          ...state,
          measurements: state.measurements.map((measurement, index) => ({
            ...measurement,
            weightKg: index < 24 ? 75 : 75.72,
          })),
          activePlan: {
            ...state.activePlan,
            maintenanceReferenceWeightKg: 75,
          },
          agentSession: {
            ...state.agentSession,
            pendingInteraction: {
              id: `adjustment-offer-v${state.activePlan.version}`,
              type: "adjustment_offer",
              basePlanVersion: state.activePlan.version,
              direction: "decrease",
              adjustmentKcal: 150,
            },
          },
        };
      },
    });
    if (!("activePlan" in seeded.state) || !seeded.state.activePlan)
      throw new Error("Expected Existing state.");
    agent.tool = {
      name: "submit_adjustment_proposal",
      arguments: {
        summary: "A bounded adjustment Draft.",
        meals: seeded.state.activePlan.plan.meals.map((meal) => ({
          id: meal.id,
          items: meal.items.map(({ catalogFoodId, grams }) => ({
            catalogFoodId,
            grams,
          })),
        })),
      },
    };

    const result = await executeCoachTurn({
      ...turnInput(
        "existing",
        seeded.version,
        "generate-adjustment-control",
        "unused",
      ),
      request: {
        profileId: "existing",
        expectedVersion: seeded.version,
        commandId: "generate-adjustment-control",
        input: {
          type: "interaction",
          interactionId: `adjustment-offer-v${seeded.state.activePlan.version}`,
          action: "generate_adjustment",
        },
      },
    });

    expect(agent.requiredFirstTools).toEqual(["submit_adjustment_proposal"]);
    expect(agent.toolResults[0]).toMatchObject({
      accepted: false,
      attemptsRemaining: 2,
    });
    expect(result.profile.state.agentSession.pendingInteraction?.type).toBe(
      "adjustment_offer",
    );
  });

  it("uses the generic ranking clarification instead of a milk-specific branch", async () => {
    const initial = await getProfile("existing");
    agent.tool = {
      name: "search_foods",
      arguments: { normalizedEnglishQuery: "milk" },
    };

    const result = await executeCoachTurn(
      turnInput(
        "existing",
        initial.version,
        "agent-generic-milk",
        "I want to add milk to my catalog",
      ),
    );

    expect(result.profile.state.agentSession.pendingInteraction).toMatchObject({
      type: "clarification",
      workflow: "food",
      prompt: "Which type of milk would you like to add?",
    });
    expect(foodSearch.searchSummaries).toHaveBeenCalledOnce();
    expect(agent.requiredFirstTools).toEqual(["search_foods"]);
    expect(agent.toolResults).toContainEqual({
      outcome: "needs_clarification",
      interaction: expect.objectContaining({ type: "clarification" }),
    });
  });

  it("persists a missing-food-name clarification and forces the contextual follow-up search", async () => {
    const initial = await getProfile("existing");
    const missing = await executeCoachTurn(
      turnInput(
        "existing",
        initial.version,
        "agent-food-name-missing",
        "I want to add food to my catalog",
      ),
    );
    expect(missing.profile.state.agentSession.pendingInteraction).toMatchObject(
      {
        type: "clarification",
        workflow: "food",
        prompt: "Which basic food would you like to add?",
      },
    );
    expect(agent.requiredFirstTools).toEqual([null]);

    agent.tool = {
      name: "search_foods",
      arguments: { normalizedEnglishQuery: "milk" },
    };
    await executeCoachTurn(
      turnInput(
        "existing",
        missing.profile.version,
        "agent-food-name-follow-up",
        "milk",
      ),
    );
    expect(agent.requiredFirstTools.at(-1)).toBe("search_foods");
    expect(foodSearch.searchSummaries).toHaveBeenCalledOnce();
  });

  it("pauses one unrelated workflow in server-owned context", async () => {
    const initial = await getProfile("existing");
    const foodQuestion: AgentInteraction = {
      id: "food-clarification",
      type: "clarification",
      workflow: "food",
      prompt: "Which basic food would you like to add?",
      quickReplies: [],
    };
    const seeded = await mutateProfile({
      profileId: "existing",
      expectedVersion: initial.version,
      commandId: "seed-food-workflow",
      mutation: (state) => ({
        ...state,
        agentSession: {
          ...state.agentSession,
          pendingInteraction: foodQuestion,
        },
      }),
    });

    agent.tool = { name: "record_weight", arguments: { weightKg: 80.25 } };
    const interrupted = await executeCoachTurn(
      turnInput(
        "existing",
        seeded.version,
        "agent-interrupt-food",
        "Before that, record 80.25 kg today",
      ),
    );
    expect(
      interrupted.profile.state.agentSession.pendingInteraction,
    ).toBeNull();
    expect(interrupted.profile.state.agentSession.pausedInteraction).toEqual(
      foodQuestion,
    );

    expect(agent.systemPrompts.at(-1)).toContain("pausedInteraction");
  });

  it("sends a bounded digest plus the latest twenty messages above the transcript cap", async () => {
    process.env.OPENAI_CONTEXT_WINDOW = "8000";
    const initial = await getProfile("existing");
    const seeded = await mutateProfile({
      profileId: "existing",
      expectedVersion: initial.version,
      commandId: "seed-long-transcript",
      mutation: (state) => ({
        ...state,
        messages: Array.from({ length: 55 }, (_, index) => ({
          id: `history-${index}`,
          role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
          text: `Historical message ${index} ${"detail ".repeat(55)}`,
        })),
      }),
    });
    await executeCoachTurn(
      turnInput(
        "existing",
        seeded.version,
        "agent-summary-context",
        "continue",
      ),
    );
    expect(agent.conversations[0]).toHaveLength(20);
    expect(agent.systemPrompts[0]).toContain("validated_conversation_digest");
    expect(agent.conversations[0][0]).toEqual(
      expect.objectContaining({
        role: expect.any(String),
        content: expect.any(String),
      }),
    );
  });

  it("selects the fifth displayed candidate by text, then requires the visible approval action", async () => {
    const lookup = await createLookup({
      profileId: "new",
      query: "cottage cheese 5%",
      context: { preparation: "packaged" },
      status: "ready",
      failureCode: null,
    });
    const food: CatalogFood = {
      schemaVersion: 1,
      id: "runtime-cottage-five",
      displayName: "Cottage cheese, 5% milkfat",
      preparation: "packaged",
      category: "protein",
      mealClassification: "dairy",
      kosherCatalogApproved: false,
      kosherReview: "not_checked",
      source: {
        provider: "USDA FoodData Central",
        fdcId: 900005,
        dataset: "SR Legacy",
        release: "test",
        retrievedAt: "2026-09-03T00:00:00.000Z",
        energyNutrient: "Energy",
        energyNutrientId: 1008,
        verification: "detail",
      },
      nutrientsPer100g: {
        energyKcal: 103,
        proteinG: 11.6,
        carbohydrateG: 4.6,
        fatG: 4.2,
        fiberG: null,
      },
      displayPortion: { label: "100 g", grams: 100 },
      practicalGrams: { min: 50, max: 500, step: 5 },
    };
    const candidates: FoodSearchCandidate[] = Array.from(
      { length: 5 },
      (_, index) => ({
        id: `f00d0000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        fdcId: 900001 + index,
        title: `Cottage option ${index + 1}`,
        description: "Dairy and Egg Products",
        dataType: "SR Legacy",
        verification: "detail",
        release: "test",
        retrievedAt: "2026-09-03T00:00:00.000Z",
        energyNutrientId: 1008,
        nutrientsPer100g: food.nutrientsPer100g,
        displayPortion: food.displayPortion,
      }),
    );
    const approval: FoodApprovalCandidate = {
      id: candidates[4].id,
      lookupId: lookup.id,
      food,
      sourceLabel: "USDA FoodData Central verified",
    };
    await saveCandidates(
      candidates.map((candidate, index) => ({
        id: candidate.id,
        lookupId: lookup.id,
        sourceUrl: `https://fdc.nal.usda.gov/food-details/${candidate.fdcId}/nutrients`,
        sourceIdentifier: `usda:${candidate.fdcId}`,
        status: index === 4 ? ("detailed" as const) : ("summary" as const),
        data:
          index === 4
            ? (approval as unknown as Record<string, unknown>)
            : (candidate as unknown as Record<string, unknown>),
      })),
    );
    const initial = await getProfile("new");
    const pending: AgentInteraction = {
      id: "candidate-list",
      type: "food_candidates",
      lookupId: lookup.id,
      candidates,
    };
    const seeded = await mutateProfile({
      profileId: "new",
      expectedVersion: initial.version,
      commandId: "seed-candidate-list",
      mutation: (state) => ({
        ...state,
        agentSession: { ...state.agentSession, pendingInteraction: pending },
      }),
    });
    agent.tool = {
      name: "select_food_candidate",
      arguments: { candidateId: candidates[4].id },
    };
    const selected = await executeCoachTurn(
      turnInput("new", seeded.version, "agent-select-fifth", "the fifth one"),
    );
    expect(
      selected.profile.state.agentSession.pendingInteraction,
    ).toMatchObject({
      type: "food_approval",
      candidate: { id: candidates[4].id },
    });
    expect(
      "profile" in selected.profile.state
        ? selected.profile.state.profile.approvedCatalogFoodIds
        : [],
    ).not.toContain(food.id);

    agent.tool = null;
    const approved = await executeCoachTurn({
      ...turnInput(
        "new",
        selected.profile.version,
        "agent-approve-fifth",
        "unused",
      ),
      request: {
        profileId: "new",
        expectedVersion: selected.profile.version,
        commandId: "agent-approve-fifth",
        input: {
          type: "interaction",
          interactionId:
            selected.profile.state.agentSession.pendingInteraction!.id,
          action: "approve_food",
          candidateId: candidates[4].id,
        },
      },
    });
    expect(
      "profile" in approved.profile.state
        ? approved.profile.state.profile.approvedCatalogFoodIds
        : [],
    ).toContain(food.id);
    expect(
      approved.profile.state.agentSession.pendingInteraction,
    ).toMatchObject({
      type: "confirm_draft_food",
      foodId: food.id,
    });
  });

  it("creates and activates an ordinary Existing Draft from the same bounded skill", async () => {
    const initial = await getProfile("existing");
    if (!("measurements" in initial.state))
      throw new Error("Expected Existing state.");
    const activeBefore = structuredClone(initial.state.activePlan);
    const pending: AgentInteraction = {
      id: "existing-food-continuation",
      type: "confirm_draft_food",
      foodId: "white-rice-cooked",
      displayName: "White rice",
    };
    const seeded = await mutateProfile({
      profileId: "existing",
      expectedVersion: initial.version,
      commandId: "seed-existing-food-continuation",
      mutation: (state) => ({
        ...state,
        agentSession: { ...state.agentSession, pendingInteraction: pending },
      }),
    });
    agent.tool = {
      name: "submit_draft_proposal",
      arguments: {
        summary: "A new arrangement using the approved food.",
        meals: activeBefore.plan.meals.map((meal) => ({
          id: meal.id,
          items: meal.items.map((item) => ({
            catalogFoodId: item.catalogFoodId,
            grams:
              item.catalogFoodId === "chicken-breast-roasted"
                ? 200
                : item.grams,
          })),
        })),
      },
    };

    const drafted = await executeCoachTurn({
      ...turnInput(
        "existing",
        seeded.version,
        "existing-create-draft-with-food",
        "unused",
      ),
      request: {
        profileId: "existing",
        expectedVersion: seeded.version,
        commandId: "existing-create-draft-with-food",
        input: {
          type: "interaction",
          interactionId: pending.id,
          action: "confirm_draft_food",
        },
      },
    });
    if (!("measurements" in drafted.profile.state))
      throw new Error("Expected Existing state.");
    expect(drafted.profile.state.activePlan).toEqual(activeBefore);
    expect(drafted.profile.state.draft).toMatchObject({
      basePlanVersion: activeBefore.version,
      plan: {
        version: activeBefore.version + 1,
        targetSnapshot: expect.objectContaining({ energyKcal: 2875 }),
        validation: { valid: true },
      },
    });
    expect(drafted.profile.state.agentSession.draftIntent).toBeNull();

    agent.tool = null;
    const activated = await executeCoachTurn({
      ...turnInput(
        "existing",
        drafted.profile.version,
        "existing-approve-ordinary-draft",
        "unused",
      ),
      request: {
        profileId: "existing",
        expectedVersion: drafted.profile.version,
        commandId: "existing-approve-ordinary-draft",
        input: {
          type: "interaction",
          interactionId: drafted.profile.state.draft!.id,
          action: "approve_draft",
        },
      },
    });
    if (!("measurements" in activated.profile.state))
      throw new Error("Expected Existing state.");
    expect(activated.profile.state.draft).toBeNull();
    expect(activated.profile.state.activePlan.version).toBe(2);
    expect(
      activated.profile.state.activePlan.maintenanceReferenceWeightKg,
    ).toBe(activated.profile.state.measurements[0].weightKg);
  });

  it("forces a complete rebalanced Draft when an approved food is added to an Existing plan", async () => {
    const initial = await getProfile("existing");
    if (!("measurements" in initial.state))
      throw new Error("Expected Existing state.");
    const activeBefore = structuredClone(initial.state.activePlan);
    const pending: AgentInteraction = {
      id: "existing-tofu-continuation",
      type: "confirm_draft_food",
      foodId: "tofu-firm",
      displayName: "Firm tofu",
    };
    const seeded = await mutateProfile({
      profileId: "existing",
      expectedVersion: initial.version,
      commandId: "seed-existing-tofu-continuation",
      mutation: (state) => ({
        ...state,
        agentSession: { ...state.agentSession, pendingInteraction: pending },
      }),
    });
    agent.tool = {
      name: "submit_draft_proposal",
      arguments: {
        summary: "Adds tofu without changing the current plan.",
        meals: activeBefore.plan.meals.map((meal) => ({
          id: meal.id,
          items: [
            ...meal.items.map((item) => ({
              catalogFoodId: item.catalogFoodId,
              grams: item.grams,
            })),
            ...(meal.id === "snack"
              ? [{ catalogFoodId: "tofu-firm", grams: 60 }]
              : []),
          ],
        })),
      },
    };

    const result = await executeCoachTurn({
      ...turnInput(
        "existing",
        seeded.version,
        "existing-integrate-tofu",
        "unused",
      ),
      request: {
        profileId: "existing",
        expectedVersion: seeded.version,
        commandId: "existing-integrate-tofu",
        input: {
          type: "interaction",
          interactionId: pending.id,
          action: "confirm_draft_food",
        },
      },
    });

    expect(agent.requiredFirstTools).toEqual(["submit_draft_proposal"]);
    expect(agent.toolResults[0]).toMatchObject({
      accepted: false,
      issues: expect.arrayContaining([
        "This adds the required food without reducing or replacing another Active Plan portion. Rebalance the complete Draft before resubmitting.",
      ]),
    });
    if (!("measurements" in result.profile.state))
      throw new Error("Expected Existing state.");
    expect(result.profile.state.draft).toBeNull();
    expect(result.profile.state.activePlan).toEqual(activeBefore);
  });

  it("forces a Draft proposal for a persisted food-integration request expressed in text", async () => {
    const initial = await getProfile("existing");
    if (!("measurements" in initial.state))
      throw new Error("Expected Existing state.");
    const seeded = await mutateProfile({
      profileId: "existing",
      expectedVersion: initial.version,
      commandId: "seed-food-integration-intent",
      mutation: (state) => ({
        ...state,
        agentSession: {
          ...state.agentSession,
          draftIntent: {
            basePlanVersion: state.activePlan?.version ?? null,
            requiredCatalogFoodId: "tofu-firm",
          },
        },
      }),
    });

    await executeCoachTurn(
      turnInput(
        "existing",
        seeded.version,
        "existing-propose-tofu-plan",
        "Propose a plan that includes tofu.",
      ),
    );

    expect(agent.requiredFirstTools).toEqual(["submit_draft_proposal"]);
  });

  it("rejects an Existing Draft whose base Active Plan version is stale", async () => {
    const initial = await getProfile("existing");
    if (!("measurements" in initial.state))
      throw new Error("Expected Existing state.");
    const originalActivePlan = initial.state.activePlan;
    const currentActivePlan = {
      ...originalActivePlan,
      version: 2,
      plan: { ...originalActivePlan.plan, version: 2 },
    };
    const staleDraft = {
      schemaVersion: 1 as const,
      id: "stale-existing-draft",
      basePlanVersion: 1,
      reason: "modification" as const,
      summary: "A proposal based on the prior Active Plan.",
      plan: { ...originalActivePlan.plan, version: 2 },
    };
    const seeded = await mutateProfile({
      profileId: "existing",
      expectedVersion: initial.version,
      commandId: "seed-stale-existing-draft",
      mutation: (state) => ({
        ...state,
        activePlan: currentActivePlan,
        draft: staleDraft,
      }),
    });

    await expect(
      executeCoachTurn({
        ...turnInput(
          "existing",
          seeded.version,
          "approve-stale-existing-draft",
          "unused",
        ),
        request: {
          profileId: "existing",
          expectedVersion: seeded.version,
          commandId: "approve-stale-existing-draft",
          input: {
            type: "interaction",
            interactionId: staleDraft.id,
            action: "approve_draft",
          },
        },
      }),
    ).rejects.toThrow("stale or failed deterministic validation");

    const unchanged = await getProfile("existing");
    if (!("measurements" in unchanged.state))
      throw new Error("Expected Existing state.");
    expect(unchanged.state.activePlan).toEqual(currentActivePlan);
    expect(unchanged.state.draft).toEqual(staleDraft);
  });

  it("stores an explicit preference as reset-scoped structured data", async () => {
    const initial = await getProfile("new");
    const seeded = await mutateProfile({
      profileId: "new",
      expectedVersion: initial.version,
      commandId: "seed-preference-message",
      mutation: (state) => ({
        ...state,
        messages: [
          ...state.messages,
          {
            id: "user-preference-source",
            role: "user" as const,
            text: "Yes, cottage cheese at 3% fat.",
          },
        ],
      }),
    });
    agent.tool = {
      name: "remember_preference",
      arguments: {
        type: "food",
        subject: "Cottage cheese",
        value: "Prefers 3% fat",
        supportingMessageId: "user-preference-source",
      },
    };
    const result = await executeCoachTurn(
      turnInput(
        "new",
        seeded.version,
        "remember-cottage-preference",
        "Please remember that.",
      ),
    );
    expect(result.profile.state.agentSession.preferences).toEqual([
      expect.objectContaining({
        type: "food",
        subject: "Cottage cheese",
        value: "Prefers 3% fat",
        supportingMessageId: "user-preference-source",
      }),
    ]);
  });

  it("inspects and removes an approved food without changing the Active Plan", async () => {
    const initial = await getProfile("existing");
    const activeBefore = structuredClone(
      "measurements" in initial.state ? initial.state.activePlan : null,
    );
    agent.toolSequence = [
      {
        name: "inspect_food_availability",
        arguments: { query: "rice" },
      },
      {
        name: "remove_approved_food",
        arguments: { catalogFoodId: "white-rice-cooked" },
      },
    ];
    const result = await executeCoachTurn(
      turnInput(
        "existing",
        initial.version,
        "inspect-remove-rice",
        "Do I have rice, and remove it from future Drafts.",
      ),
    );
    expect(agent.toolResults[0]).toMatchObject({
      matches: expect.arrayContaining([
        expect.objectContaining({
          id: "white-rice-cooked",
          approvedForProfile: true,
          inActivePlan: true,
        }),
      ]),
    });
    expect(
      "measurements" in result.profile.state
        ? result.profile.state.approvedCatalogFoodIds
        : [],
    ).not.toContain("white-rice-cooked");
    expect(
      "measurements" in result.profile.state
        ? result.profile.state.activePlan
        : null,
    ).toEqual(activeBefore);
  });

  it("accepts Arnold's complete valid Draft and adds no substitutions", async () => {
    const initial = await getProfile("new");
    const ready = makeReadyState();
    const seeded = await mutateProfile({
      profileId: "new",
      expectedVersion: initial.version,
      commandId: "seed-ready-for-arnold-draft",
      mutation: () => ready,
    });
    const valid = makeValidDraft("arnold-valid-candidate");
    agent.tool = {
      name: "submit_draft_proposal",
      arguments: {
        summary: "A practical approved-food day.",
        meals: valid.plan.meals.map((meal) => ({
          id: meal.id,
          items: meal.items.map((item) => ({
            catalogFoodId: item.catalogFoodId,
            grams: item.grams,
          })),
        })),
      },
    };
    const result = await executeCoachTurn(
      turnInput(
        "new",
        seeded.version,
        "arnold-submits-valid-draft",
        "Please create my Draft.",
      ),
    );
    if (!("profile" in result.profile.state)) {
      throw new Error("Expected Fresh state.");
    }
    expect(agent.requiredFirstTools).toEqual(["submit_draft_proposal"]);
    expect(result.profile.state.draft?.plan.validation.valid).toBe(true);
    expect(
      result.profile.state.draft?.plan.meals.flatMap((meal) =>
        meal.items.flatMap((item) => item.alternatives),
      ),
    ).toEqual([]);
  });

  it("removes proposal submission after three invalid attempts without a hidden fallback", async () => {
    const initial = await getProfile("new");
    const seeded = await mutateProfile({
      profileId: "new",
      expectedVersion: initial.version,
      commandId: "seed-ready-for-invalid-drafts",
      mutation: () => makeReadyState(),
    });
    const invalid = (grams: number) => ({
      name: "submit_draft_proposal",
      arguments: {
        summary: `Invalid rice-only Draft at ${grams} grams per meal.`,
        meals: ["breakfast", "lunch", "snack", "dinner"].map((id) => ({
          id,
          items: [{ catalogFoodId: "white-rice-cooked", grams }],
        })),
      },
    });
    agent.toolSequence = [
      invalid(500),
      invalid(450),
      invalid(400),
      invalid(350),
    ];
    agent.responseText =
      "Which approved protein would you most like me to use at lunch?";
    const result = await executeCoachTurn(
      turnInput(
        "new",
        seeded.version,
        "arnold-three-invalid-drafts",
        "Create a Draft.",
      ),
    );
    expect(agent.toolResults).toHaveLength(3);
    expect(agent.allowedAfterCalls.at(-1)).not.toContain(
      "submit_draft_proposal",
    );
    expect(result.assistantText).toContain("Which approved protein");
    expect(
      "profile" in result.profile.state ? result.profile.state.draft : null,
    ).toBeNull();
    const review = result.profile.state.agentSession.pendingInteraction;
    expect(review).toMatchObject({
      type: "draft_failure_review",
      attempts: [
        {
          attempt: 1,
          meals: expect.arrayContaining([
            expect.objectContaining({
              name: "Breakfast",
              items: [
                expect.objectContaining({
                  displayName: "White rice",
                  grams: 500,
                }),
              ],
            }),
          ]),
        },
        { attempt: 2 },
        { attempt: 3 },
      ],
    });
    if (review?.type !== "draft_failure_review") {
      throw new Error("Expected a rejected Draft review.");
    }
    expect(review.attempts.map((attempt) => attempt.totals.energyKcal)).toEqual(
      [2600, 2340, 2080],
    );
    expect(review.attempts[2].checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "energy", passed: false }),
        expect.objectContaining({ key: "fiber", passed: false }),
      ]),
    );
    expect(agent.toolResults.at(-1)).toMatchObject({
      attemptedDraft: { attempt: 3 },
      failedAttempts: [{ attempt: 1 }, { attempt: 2 }, { attempt: 3 }],
    });
  });

  it("keeps a required-food Draft intent after the third rejected proposal", async () => {
    const initial = await getProfile("existing");
    if (!("measurements" in initial.state))
      throw new Error("Expected Existing state.");
    const basePlanVersion = initial.state.activePlan.version;
    const seeded = await mutateProfile({
      profileId: "existing",
      expectedVersion: initial.version,
      commandId: "seed-required-food-draft-intent",
      mutation: (state) => ({
        ...state,
        agentSession: {
          ...state.agentSession,
          draftIntent: {
            basePlanVersion,
            requiredCatalogFoodId: "white-rice-cooked",
          },
        },
      }),
    });
    const invalid = {
      name: "submit_draft_proposal",
      arguments: {
        summary: "Invalid invented-food Draft.",
        meals: ["breakfast", "lunch", "dinner", "snack"].map((id) => ({
          id,
          items: [{ catalogFoodId: "invented-food", grams: 100 }],
        })),
      },
    };
    agent.toolSequence = [invalid, invalid, invalid];
    agent.responseText = "Which approved protein should I use?";

    const result = await executeCoachTurn(
      turnInput(
        "existing",
        seeded.version,
        "existing-three-invalid-required-food",
        "Try the Draft again.",
      ),
    );
    if (!("measurements" in result.profile.state))
      throw new Error("Expected Existing state.");
    expect(result.profile.state.draft).toBeNull();
    expect(result.profile.state.agentSession.draftIntent).toEqual({
      basePlanVersion: 1,
      requiredCatalogFoodId: "white-rice-cooked",
    });
  });
});
