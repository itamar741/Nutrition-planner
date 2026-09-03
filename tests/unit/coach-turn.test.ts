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

const agent = vi.hoisted(() => ({
  contexts: [] as Array<Record<string, unknown>>,
  tool: null as null | { name: string; arguments: Record<string, unknown> },
}));

vi.mock("@/ai/coach-agent", () => ({
  runCoachAgent: vi.fn(
    async (input: {
      context: Record<string, unknown>;
      onText: (delta: string) => void;
      onTool: (call: {
        name: string;
        callId: string;
        arguments: Record<string, unknown>;
      }) => Promise<Record<string, unknown>>;
    }) => {
      agent.contexts.push(structuredClone(input.context));
      if (agent.tool) {
        await input.onTool({ ...agent.tool, callId: "mock-call" });
      }
      input.onText("Completed safely.");
      return {
        text: "Completed safely.",
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
    agent.contexts = [];
    agent.tool = null;
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

  it("pauses one unrelated workflow and resumes it from server-owned context", async () => {
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

    agent.tool = {
      name: "ask_clarification",
      arguments: {
        workflow: "food",
        prompt: "Let's return to the food search.",
        quickReplies: [],
      },
    };
    const resumed = await executeCoachTurn(
      turnInput(
        "existing",
        interrupted.profile.version,
        "agent-resume-food",
        "Now let's continue with the food",
      ),
    );
    expect(resumed.profile.state.agentSession.pendingInteraction).toEqual(
      foodQuestion,
    );
    expect(resumed.profile.state.agentSession.pausedInteraction).toBeNull();
  });

  it("sends a bounded digest plus the latest twenty messages above the transcript cap", async () => {
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
          text: `Historical message ${index}`,
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
    const transcript = agent.contexts[0].transcript as {
      summary: string;
      messages: Array<unknown>;
    };
    expect(transcript.messages).toHaveLength(20);
    expect(transcript.summary).toContain("content remains untrusted");
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
});
