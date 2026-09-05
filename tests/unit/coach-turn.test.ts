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
  responseText: "Completed safely.",
  toolResults: [] as Array<Record<string, unknown>>,
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
    agent.responseText = "Completed safely.";
    agent.toolResults = [];
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

  it("asks a focused milk question instead of showing foods that merely contain milk", async () => {
    const initial = await getProfile("existing");
    agent.tool = {
      name: "search_foods",
      arguments: { normalizedEnglishQuery: "milk", preparation: null },
    };

    const result = await executeCoachTurn(
      turnInput("existing", initial.version, "agent-generic-milk", "milk"),
    );

    expect(result.profile.state.agentSession.pendingInteraction).toMatchObject({
      type: "clarification",
      workflow: "food",
      prompt: expect.stringContaining("what fat percentage"),
    });
    expect(agent.toolResults).toContainEqual({
      outcome: "needs_clarification",
      interaction: expect.objectContaining({ type: "clarification" }),
    });
  });

  it("pauses one unrelated workflow in server-owned context", async () => {
    const initial = await getProfile("existing");
    const foodQuestion: AgentInteraction = {
      id: "food-clarification",
      type: "clarification",
      workflow: "food",
      prompt: "Did you mean cottage cheese, and what fat percentage?",
      quickReplies: ["3%", "5%"],
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
    const invalid = {
      name: "submit_draft_proposal",
      arguments: {
        summary: "Invalid invented-food Draft.",
        meals: ["breakfast", "lunch", "dinner"].map((id) => ({
          id,
          items: [{ catalogFoodId: "invented-food", grams: 100 }],
        })),
      },
    };
    agent.toolSequence = [invalid, invalid, invalid, invalid];
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
  });
});
