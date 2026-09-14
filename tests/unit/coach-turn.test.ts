import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeCoachTurn } from "@/application/coach-turn";
import { createExistingDemoState } from "@/data/demo-fixtures";
import type {
  AgentInteraction,
  PlanChangeWorkflow,
} from "@/domain/agent/types";
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

vi.mock("@/ai/onboarding", () => ({
  extractOnboardingFacts: () =>
    Promise.resolve({ patch: {}, acknowledgement: "" }),
}));

vi.mock("@/ai/turn-decision", () => ({
  interpretTurnDecision: vi.fn(
    async (input: {
      message: string;
      hasDraft: boolean;
      recentConversation: Array<{
        role: "assistant" | "user";
        content: string;
      }>;
      pendingInteraction: {
        type: string;
        workflow?: string | null;
        offeredFoodNames: string[];
      } | null;
    }) => {
      const text = input.message.toLocaleLowerCase("en-US");
      const namedFood = ["milk", "rice", "tofu", "cottage cheese"].find(
        (name) => text.includes(name),
      );
      const base = {
        foodNames: namedFood ? [namedFood] : ([] as string[]),
        candidateOrdinal: null as number | null,
        planChangeStrategy: null as
          null | "preserve_structure" | "different_approved_mix",
        evidence: input.message,
      };
      if (
        /(?:do not|don't|never).{0,40}(?:change|create|make|build|replace|update)/.test(
          text,
        ) &&
        /plan|draft/.test(text)
      ) {
        return { ...base, intent: "plan_revise", speechAct: "negated" };
      }
      if (input.pendingInteraction?.workflow === "adjustment") {
        return {
          ...base,
          intent: "adjustment_retry",
          speechAct: "answer",
          planChangeStrategy: /different mix|fresh mix/.test(text)
            ? "different_approved_mix"
            : "preserve_structure",
        };
      }
      if (/different mix|fresh mix/.test(text)) {
        return {
          ...base,
          intent: "draft_retry",
          speechAct: "answer",
          planChangeStrategy: "different_approved_mix",
        };
      }
      if (
        input.pendingInteraction?.type === "draft_failure_review" &&
        /try|again|smaller|portion|structure/.test(text)
      ) {
        return {
          ...base,
          intent: "draft_retry",
          speechAct: "answer",
          planChangeStrategy: "preserve_structure",
        };
      }
      const selected = input.pendingInteraction?.offeredFoodNames.find((name) =>
        text.includes(name.toLocaleLowerCase("en-US")),
      );
      if (selected) {
        return {
          ...base,
          intent: "food_alternative_selection",
          speechAct: "answer",
          foodNames: [selected],
        };
      }
      if (/option|oprion|alternative|replacement|substitute/.test(text)) {
        return {
          ...base,
          intent: "food_alternatives",
          speechAct: "question",
          foodNames: text.includes("rice") ? ["rice"] : [],
        };
      }
      if (/what would|what if|if i/.test(text) && /plan|draft/.test(text)) {
        return {
          ...base,
          intent: "plan_replace",
          speechAct: "hypothetical",
        };
      }
      if (
        /what would|what if|if i/.test(text) &&
        /weigh|weight|kg/.test(text)
      ) {
        return {
          ...base,
          intent: "weight_record",
          speechAct: "hypothetical",
        };
      }
      if (
        /(?:do not|don't|never).{0,40}(?:record|edit|delete|weight|weigh)/.test(
          text,
        )
      ) {
        return {
          ...base,
          intent: "weight_record",
          speechAct: "negated",
        };
      }
      if (/remove/.test(text) && /food|rice|future draft/.test(text)) {
        return {
          ...base,
          intent: "food_remove",
          speechAct: "request",
          foodNames: text.includes("rice") ? ["rice"] : [],
        };
      }
      const recentText = input.recentConversation
        .map((message) => message.content)
        .join(" ")
        .toLocaleLowerCase("en-US");
      if (/edit it/.test(text) && /today|todays/.test(recentText)) {
        return { ...base, intent: "weight_record", speechAct: "answer" };
      }
      if (
        /add it/.test(text) &&
        /yesterday|\d{4}-\d{2}-\d{2}/.test(recentText)
      ) {
        return { ...base, intent: "weight_edit", speechAct: "answer" };
      }
      if (
        input.pendingInteraction?.type === "food_candidates" &&
        /\b(?:first|second|third|fourth|fifth|[1-5])\b/.test(text)
      ) {
        return {
          ...base,
          intent: "food_candidate_selection",
          speechAct: "answer",
          candidateOrdinal: /\b(?:fifth|5)\b/.test(text)
            ? 5
            : /\b(?:fourth|4)\b/.test(text)
              ? 4
              : /\b(?:third|3)\b/.test(text)
                ? 3
                : /\b(?:second|2)\b/.test(text)
                  ? 2
                  : 1,
        };
      }
      if (
        /\b(?:add|find|search|lookup|look up)\b/.test(text) ||
        (input.pendingInteraction?.type === "clarification" &&
          input.pendingInteraction.workflow === "food")
      ) {
        return {
          ...base,
          intent: "food_search",
          speechAct:
            input.pendingInteraction?.type === "clarification"
              ? "answer"
              : "request",
        };
      }
      if (
        /\b(?:delete|erase|remove)\b/.test(text) &&
        /weight|measurement|entry/.test(text)
      ) {
        return { ...base, intent: "weight_delete", speechAct: "request" };
      }
      if (
        /yesterday|\d{4}-\d{2}-\d{2}|^-\d{1,2}\.\d{1,2}/.test(text) &&
        /weight|weigh|kg|record|edit|update|change/.test(text)
      ) {
        return { ...base, intent: "weight_edit", speechAct: "request" };
      }
      if (/\b\d{1,3}(?:[.,]\d{1,2})?\s*kg\b|\bweigh\b|weight is/.test(text)) {
        return { ...base, intent: "weight_record", speechAct: "request" };
      }
      if (/remember|save.*preference/.test(text)) {
        return { ...base, intent: "preference_save", speechAct: "request" };
      }
      if (/change the whole|replace the whole|new whole/.test(text)) {
        return { ...base, intent: "plan_replace", speechAct: "request" };
      }
      if (
        /create|generate|make|build|prepare|propose|draft|plan/.test(text) &&
        !/how would you|what would|could you explain/.test(text)
      ) {
        return {
          ...base,
          intent: input.hasDraft ? "plan_revise" : "plan_create",
          speechAct: "request",
        };
      }
      return { ...base, intent: "unknown", speechAct: "unknown" };
    },
  ),
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
    leaseToken: null,
    onStatus: vi.fn(),
    onText: vi.fn(),
  };
}

function planChangeWorkflow(
  input: Partial<PlanChangeWorkflow> = {},
): PlanChangeWorkflow {
  return {
    mode: "replace_active",
    basePlanVersion: 1,
    baseDraftId: null,
    requiredCatalogFoodIds: [],
    excludedCatalogFoodIds: [],
    mustDiffer: true,
    scope: "unspecified",
    portionRecalculation: "whole_draft",
    strategy: null,
    offeredAlternativeFoodIds: [],
    selectedAlternativeFoodId: null,
    attemptBatch: 1,
    ...input,
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

  it("upserts today's weight, deletes it, and edits a historical weight through bounded tools", async () => {
    const initial = await getProfile("existing");
    agent.tool = { name: "record_weight", arguments: { weightKg: 1 } };
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

    agent.tool = { name: "record_weight", arguments: { weightKg: 68.3 } };
    const updated = await executeCoachTurn(
      turnInput(
        "existing",
        recorded.profile.version,
        "agent-weight-current-update",
        "I weigh 68.3 kg today",
      ),
    );
    if (!("measurements" in updated.profile.state))
      throw new Error("Expected Existing state.");
    expect(
      updated.profile.state.measurements.filter((item) => item.date === today),
    ).toHaveLength(1);
    expect(
      updated.profile.state.measurements.find((item) => item.date === today)
        ?.weightKg,
    ).toBe(68.3);
    expect(agent.toolResults.at(-1)).toMatchObject({
      operation: "updated",
      previousWeightKg: 80.25,
      measurement: { date: today, weightKg: 68.3 },
    });
    expect(agent.requiredFirstTools.at(-1)).toBe("record_weight");

    agent.tool = { name: "record_weight", arguments: { weightKg: 76 } };
    const updatedAgain = await executeCoachTurn(
      turnInput(
        "existing",
        updated.profile.version,
        "agent-weight-current-update-again",
        "todays weight is 76",
      ),
    );
    if (!("measurements" in updatedAgain.profile.state))
      throw new Error("Expected Existing state.");
    expect(
      updatedAgain.profile.state.measurements.filter(
        (item) => item.date === today,
      ),
    ).toHaveLength(1);
    expect(agent.toolResults.at(-1)).toMatchObject({
      operation: "updated",
      previousWeightKg: 68.3,
      measurement: { date: today, weightKg: 76 },
    });
    expect(agent.requiredFirstTools.at(-1)).toBe("record_weight");

    const contextualSeed = await mutateProfile({
      profileId: "existing",
      expectedVersion: updatedAgain.profile.version,
      commandId: "seed-contextual-weight-request",
      mutation: (state) => ({
        ...state,
        messages: [
          ...state.messages,
          {
            id: "contextual-weight-user",
            role: "user" as const,
            text: "todays weight is 76",
          },
          {
            id: "contextual-weight-assistant",
            role: "assistant" as const,
            text: "Today's weight already exists; edit it instead.",
          },
        ],
      }),
    });
    agent.tool = { name: "record_weight", arguments: { weightKg: 76 } };
    const contextuallyUpdated = await executeCoachTurn(
      turnInput(
        "existing",
        contextualSeed.version,
        "agent-weight-contextual-update",
        "okay edit it for me",
      ),
    );
    expect(agent.requiredFirstTools.at(-1)).toBeNull();
    expect(agent.allowedAfterCalls.at(-1)).not.toContain("record_weight");

    agent.tool = { name: "delete_weight", arguments: { date: today } };
    const deleted = await executeCoachTurn(
      turnInput(
        "existing",
        contextuallyUpdated.profile.version,
        "agent-weight-current-delete",
        "Delete today's weight",
      ),
    );
    if (!("measurements" in deleted.profile.state))
      throw new Error("Expected Existing state.");
    expect(
      deleted.profile.state.measurements.some((item) => item.date === today),
    ).toBe(false);
    expect(agent.toolResults.at(-1)).toMatchObject({
      deleted: { date: today, weightKg: 76 },
    });
    expect(agent.requiredFirstTools.at(-1)).toBe("delete_weight");
    expect(deleted.assistantText).toBe(
      "Deleted the 76 kg measurement for today.",
    );

    const historicalDate = createExistingDemoState().measurements[0].date;
    agent.tool = {
      name: "edit_weight",
      arguments: { date: "2000-01-01", weightKg: 1 },
    };
    const edited = await executeCoachTurn(
      turnInput(
        "existing",
        deleted.profile.version,
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

  it("gives Fresh Arnold the complete weight history and today's measurement", async () => {
    const initial = await getProfile("new");
    const ready = makeReadyState();
    const draft = makeValidDraft("fresh-weight-context");
    const today = new Date().toISOString().slice(0, 10);
    const seeded = await mutateProfile({
      profileId: "new",
      expectedVersion: initial.version,
      commandId: "seed-fresh-weight-context",
      mutation: () => ({
        ...ready,
        activePlan: {
          schemaVersion: 1,
          version: 1,
          activatedAt: "2026-08-01T08:00:00.000Z",
          maintenanceReferenceWeightKg: ready.profile.currentWeightKg,
          plan: draft.plan,
        },
        weightMeasurements: [
          {
            id: "fresh-today-weight",
            date: today,
            weightKg: 69.1,
            commandId: "seed-fresh-weight-context",
          },
        ],
      }),
    });

    agent.tool = null;
    await executeCoachTurn(
      turnInput(
        "new",
        seeded.version,
        "inspect-fresh-weight-context",
        "What is today's recorded weight?",
      ),
    );

    const prompt = agent.systemPrompts.at(-1) ?? "";
    expect(prompt).toContain('"weightHistory"');
    expect(prompt).toContain('"todayMeasurement"');
    expect(prompt).toContain('"weightKg":69.1');
  });

  it("does not revive a historical weight mutation from transcript prose alone", async () => {
    const initial = await getProfile("existing");
    const today = new Date().toISOString().slice(0, 10);
    const yesterdayValue = new Date(`${today}T12:00:00Z`);
    yesterdayValue.setUTCDate(yesterdayValue.getUTCDate() - 1);
    const yesterday = yesterdayValue.toISOString().slice(0, 10);
    const seeded = await mutateProfile({
      profileId: "existing",
      expectedVersion: initial.version,
      commandId: "seed-missing-yesterday-weight",
      mutation: (state) => {
        if ("profile" in state) throw new Error("Expected Existing state.");
        return {
          ...state,
          measurements: state.measurements.filter(
            (measurement) => measurement.date !== yesterday,
          ),
          messages: [
            ...state.messages,
            {
              id: "missing-yesterday-user",
              role: "user" as const,
              text: "yesterday was 76 kg",
            },
            {
              id: "missing-yesterday-assistant",
              role: "assistant" as const,
              text: "No weight is recorded for that date.",
            },
          ],
        };
      },
    });
    agent.tool = {
      name: "edit_weight",
      arguments: { date: "2000-01-01", weightKg: 1 },
    };
    agent.responseText =
      "Please state the date and weight you want to record in this message.";
    const request = turnInput(
      "existing",
      seeded.version,
      "agent-weight-contextual-history",
      "so add it",
    );

    const result = await executeCoachTurn(request);

    if (!("measurements" in result.profile.state))
      throw new Error("Expected Existing state.");
    expect(agent.requiredFirstTools.at(-1)).toBeNull();
    expect(agent.toolResults).toHaveLength(0);
    expect(
      result.profile.state.measurements.filter(
        (measurement) => measurement.date === yesterday,
      ),
    ).toHaveLength(0);
    expect(result.assistantText).toBe(
      "Please state the date and weight you want to record in this message.",
    );
    expect(request.onText).toHaveBeenCalledTimes(1);
    expect(request.onText).toHaveBeenCalledWith(
      "Please state the date and weight you want to record in this message.",
    );

    const shortDate = `${today.slice(0, 4)}-09-09`;
    agent.tool = {
      name: "edit_weight",
      arguments: { date: "2000-01-01", weightKg: 1 },
    };
    const shortDateRequest = turnInput(
      "existing",
      result.profile.version,
      "agent-weight-short-date",
      "-9.9 weight is 77",
    );
    const shortDateResult = await executeCoachTurn(shortDateRequest);
    if (!("measurements" in shortDateResult.profile.state))
      throw new Error("Expected Existing state.");
    expect(agent.requiredFirstTools.at(-1)).toBe("edit_weight");
    expect(
      shortDateResult.profile.state.measurements.filter(
        (measurement) => measurement.date === shortDate,
      ),
    ).toEqual([expect.objectContaining({ date: shortDate, weightKg: 77 })]);
    expect(shortDateResult.assistantText).not.toContain(
      "Your trend was recalculated.Updated",
    );

    agent.tool = {
      name: "delete_weight",
      arguments: { date: "2000-01-01" },
    };
    agent.responseText = "Deleted the requested weight.";
    const deleteRequest = turnInput(
      "existing",
      shortDateResult.profile.version,
      "agent-delete-short-date",
      "remove 9/9 weight",
    );
    const deleteResult = await executeCoachTurn(deleteRequest);
    if (!("measurements" in deleteResult.profile.state))
      throw new Error("Expected Existing state.");
    expect(agent.requiredFirstTools.at(-1)).toBe("delete_weight");
    expect(
      deleteResult.profile.state.measurements.some(
        (measurement) => measurement.date === shortDate,
      ),
    ).toBe(false);
    expect(agent.toolResults.at(-1)).toMatchObject({
      deleted: { date: shortDate, weightKg: 77 },
    });
    expect(deleteResult.assistantText).toBe(
      `Deleted the 77 kg measurement for ${shortDate}.`,
    );
    expect(deleteRequest.onText).toHaveBeenCalledTimes(1);
  });

  it.each([
    "If I weigh 76 kg today, how would my trend change?",
    "Do not record this: I weigh 76 kg today",
  ])("does not write weight for non-mutating language: %s", async (message) => {
    const initial = await getProfile("existing");
    if (!("measurements" in initial.state))
      throw new Error("Expected Existing state.");
    const measurementsBefore = structuredClone(initial.state.measurements);
    agent.tool = { name: "record_weight", arguments: { weightKg: 76 } };

    const result = await executeCoachTurn(
      turnInput(
        "existing",
        initial.version,
        `non-mutating-weight-${message.length}`,
        message,
      ),
    );

    expect(agent.requiredFirstTools.at(-1)).toBeNull();
    expect(agent.allowedAfterCalls.at(-1)).toEqual([]);
    expect(
      "measurements" in result.profile.state
        ? result.profile.state.measurements
        : [],
    ).toEqual(measurementsBefore);
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

  it("keeps protected state unchanged when the agent redirects an unsupported programming request", async () => {
    const initial = await getProfile("existing");
    if (!("measurements" in initial.state))
      throw new Error("Expected Existing state.");
    agent.responseText =
      "I can help with nutrition, food, meal preparation, weight tracking, or general fitness information.";

    const result = await executeCoachTurn(
      turnInput(
        "existing",
        initial.version,
        "agent-unsupported-programming",
        "write a for loop that counts from 1 to 10",
      ),
    );

    if (!("measurements" in result.profile.state))
      throw new Error("Expected Existing state.");
    expect(agent.toolResults).toHaveLength(0);
    expect(result.assistantText).toBe(agent.responseText);
    expect(result.profile.state.activePlan).toEqual(initial.state.activePlan);
    expect(result.profile.state.draft).toEqual(initial.state.draft);
    expect(result.profile.state.measurements).toEqual(
      initial.state.measurements,
    );
    expect(result.profile.state.approvedCatalogFoodIds).toEqual(
      initial.state.approvedCatalogFoodIds,
    );
  });

  it("rejects adjustment approval from a noncurrent interaction", async () => {
    const initial = await getProfile("existing");
    if (!("measurements" in initial.state))
      throw new Error("Expected Existing state.");
    const draft = {
      schemaVersion: 1 as const,
      id: "stored-adjustment-proposal",
      basePlanVersion: initial.state.activePlan.version,
      reason: "modification" as const,
      summary: "A stored adjustment proposal.",
      plan: {
        ...initial.state.activePlan.plan,
        id: "stored-adjustment-plan",
        version: initial.state.activePlan.version + 1,
      },
    };
    const seeded = await mutateProfile({
      profileId: "existing",
      expectedVersion: initial.version,
      commandId: "seed-adjustment-approval",
      mutation: (state) => ({
        ...state,
        agentSession: {
          ...state.agentSession,
          pendingInteraction: {
            id: "current-adjustment-interaction",
            type: "adjustment_approval" as const,
            draft,
          },
        },
      }),
    });

    await expect(
      executeCoachTurn({
        ...turnInput(
          "existing",
          seeded.version,
          "approve-noncurrent-adjustment",
          "unused",
        ),
        request: {
          profileId: "existing",
          expectedVersion: seeded.version,
          commandId: "approve-noncurrent-adjustment",
          input: {
            type: "interaction",
            interactionId: "different-adjustment-interaction",
            action: "approve_adjustment",
          },
        },
      }),
    ).rejects.toThrow("interaction is no longer active");

    const unchanged = await getProfile("existing");
    expect(unchanged.version).toBe(seeded.version);
    expect(unchanged.state.activePlan).toEqual(initial.state.activePlan);
    expect(unchanged.state.agentSession.pendingInteraction).toEqual(
      seeded.state.agentSession.pendingInteraction,
    );
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
    const invalidAdjustment = {
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
    agent.toolSequence = [
      invalidAdjustment,
      invalidAdjustment,
      invalidAdjustment,
      invalidAdjustment,
    ];

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
    expect(agent.toolResults).toHaveLength(3);
    expect(result.profile.state.agentSession.pendingInteraction).toMatchObject({
      type: "draft_failure_review",
      proposalKind: "adjustment",
      basePlanVersion: seeded.state.activePlan.version,
      attempts: [{ attempt: 1 }, { attempt: 2 }, { attempt: 3 }],
    });
    expect(result.profile.state.activePlan).toEqual(seeded.state.activePlan);

    agent.toolResults = [];
    agent.toolSequence = [invalidAdjustment];
    const retry = await executeCoachTurn(
      turnInput(
        "existing",
        result.profile.version,
        "retry-adjustment-with-different-mix",
        "Use a different mix of approved foods",
      ),
    );
    expect(agent.requiredFirstTools.at(-1)).toBe("submit_adjustment_proposal");
    expect(agent.toolResults).toHaveLength(1);
    expect(agent.toolResults[0]).toMatchObject({
      accepted: false,
      attempt: 1,
      attemptsRemaining: 2,
    });
    expect(retry.profile.state.activePlan).toEqual(seeded.state.activePlan);
  });

  it("uses the generic ranking clarification instead of a milk-specific branch", async () => {
    const initial = await getProfile("existing");
    agent.tool = {
      name: "search_foods",
      arguments: { normalizedEnglishQuery: "rice" },
    };

    await expect(
      executeCoachTurn(
        turnInput(
          "existing",
          initial.version,
          "agent-mismatched-food-query",
          "I want to add milk to my catalog",
        ),
      ),
    ).rejects.toThrow("Restate the food name");
    expect(foodSearch.searchSummaries).not.toHaveBeenCalled();

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
    expect(agent.requiredFirstTools.at(-1)).toBe("search_foods");
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

  it("preserves an unrelated workflow across a completed weight write", async () => {
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
    expect(interrupted.profile.state.agentSession.pendingInteraction).toEqual(
      foodQuestion,
    );
    expect(interrupted.profile.state.agentSession.pausedInteraction).toBeNull();

    expect(agent.systemPrompts.at(-1)).toContain("pendingInteraction");
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
      mutation: () => ({
        ...makeReadyState(),
        agentSession: {
          ...makeReadyState().agentSession,
          pendingInteraction: pending,
        },
      }),
    });
    agent.tool = {
      name: "select_food_candidate",
      arguments: { candidateId: candidates[0].id },
    };
    await expect(
      executeCoachTurn(
        turnInput(
          "new",
          seeded.version,
          "agent-select-wrong-candidate",
          "the fifth one",
        ),
      ),
    ).rejects.toThrow("Select one candidate from the current list");

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
                ? 195
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
    expect(drafted.profile.state.agentSession.planChange).toBeNull();
    expect(drafted.profile.state.agentSession.pendingInteraction).toEqual({
      id: drafted.profile.state.draft!.id,
      type: "draft_approval",
      proposalId: drafted.profile.state.draft!.id,
    });
    const persistedDraft = await getProfile("existing");
    expect(persistedDraft.state.draft).toEqual(drafted.profile.state.draft);
    expect(persistedDraft.state.agentSession.pendingInteraction).toEqual(
      drafted.profile.state.agentSession.pendingInteraction,
    );

    agent.tool = null;
    const modelCallsBeforeApproval = agent.requiredFirstTools.length;
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
    ).toBeCloseTo(
      activated.profile.state.measurements
        .slice(-7)
        .reduce((sum, measurement) => sum + measurement.weightKg, 0) / 7,
      8,
    );
    expect(agent.requiredFirstTools).toHaveLength(modelCallsBeforeApproval);
    expect(activated.assistantText).toBe(
      "The Draft was approved and is now your Active Plan.",
    );

    await expect(
      executeCoachTurn({
        ...turnInput(
          "existing",
          activated.profile.version,
          "existing-approve-ordinary-draft-again",
          "unused",
        ),
        request: {
          profileId: "existing",
          expectedVersion: activated.profile.version,
          commandId: "existing-approve-ordinary-draft-again",
          input: {
            type: "interaction",
            interactionId: drafted.profile.state.draft!.id,
            action: "approve_draft",
          },
        },
      }),
    ).rejects.toThrow("no longer awaiting review");
    const activatedOnce = await getProfile("existing");
    expect(activatedOnce.state.activePlan?.version).toBe(2);
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
    expect(agent.systemPrompts.at(-1)).toContain(
      '"portionRecalculation":"whole_draft"',
    );
    expect(agent.systemPrompts.at(-1)).toContain(
      "Recalculate portions across every meal in the complete Draft",
    );
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
          planChange: planChangeWorkflow({
            basePlanVersion: state.activePlan?.version ?? null,
            requiredCatalogFoodIds: ["tofu-firm"],
          }),
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
        agentSession: {
          ...state.agentSession,
          pendingInteraction: {
            id: staleDraft.id,
            type: "draft_approval" as const,
            proposalId: staleDraft.id,
          },
        },
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

  it("rejects Draft approval unless it names the current pending interaction", async () => {
    const initial = await getProfile("existing");
    if (!("measurements" in initial.state))
      throw new Error("Expected Existing state.");
    const draft = {
      schemaVersion: 1 as const,
      id: "stored-current-draft",
      basePlanVersion: initial.state.activePlan.version,
      reason: "modification" as const,
      summary: "A stored ordinary Draft.",
      plan: {
        ...initial.state.activePlan.plan,
        id: "stored-current-plan",
        version: initial.state.activePlan.version + 1,
      },
    };
    const seeded = await mutateProfile({
      profileId: "existing",
      expectedVersion: initial.version,
      commandId: "seed-current-draft-mismatch",
      mutation: (state) => ({
        ...state,
        draft,
        agentSession: {
          ...state.agentSession,
          pendingInteraction: {
            id: "different-current-interaction",
            type: "draft_approval" as const,
            proposalId: draft.id,
          },
        },
      }),
    });

    await expect(
      executeCoachTurn({
        ...turnInput(
          "existing",
          seeded.version,
          "approve-noncurrent-draft",
          "unused",
        ),
        request: {
          profileId: "existing",
          expectedVersion: seeded.version,
          commandId: "approve-noncurrent-draft",
          input: {
            type: "interaction",
            interactionId: draft.id,
            action: "approve_draft",
          },
        },
      }),
    ).rejects.toThrow("no longer awaiting review");

    const unchanged = await getProfile("existing");
    expect(unchanged.version).toBe(seeded.version);
    expect(unchanged.state.activePlan).toEqual(initial.state.activePlan);
    expect(unchanged.state.draft).toEqual(draft);
  });

  it("recalculates a stored Draft instead of trusting its validation result", async () => {
    const initial = await getProfile("existing");
    if (!("measurements" in initial.state))
      throw new Error("Expected Existing state.");
    const draft = {
      schemaVersion: 1 as const,
      id: "forged-validation-draft",
      basePlanVersion: initial.state.activePlan.version,
      reason: "modification" as const,
      summary: "A Draft with forged validation.",
      plan: {
        ...initial.state.activePlan.plan,
        id: "forged-validation-plan",
        version: initial.state.activePlan.version + 1,
        targetSnapshot: {
          ...initial.state.activePlan.plan.targetSnapshot,
          energyKcal: 9_999,
        },
        meals: initial.state.activePlan.plan.meals.map((meal, mealIndex) => ({
          ...meal,
          items: meal.items.map((item, itemIndex) => ({
            ...item,
            grams: mealIndex === 0 && itemIndex === 0 ? 1 : item.grams,
          })),
        })),
        validation: {
          ...initial.state.activePlan.plan.validation,
          valid: true,
          issues: [],
        },
      },
    };
    const seeded = await mutateProfile({
      profileId: "existing",
      expectedVersion: initial.version,
      commandId: "seed-forged-validation-draft",
      mutation: (state) => ({
        ...state,
        draft,
        agentSession: {
          ...state.agentSession,
          pendingInteraction: {
            id: draft.id,
            type: "draft_approval" as const,
            proposalId: draft.id,
          },
        },
      }),
    });

    await expect(
      executeCoachTurn({
        ...turnInput(
          "existing",
          seeded.version,
          "approve-forged-validation",
          "unused",
        ),
        request: {
          profileId: "existing",
          expectedVersion: seeded.version,
          commandId: "approve-forged-validation",
          input: {
            type: "interaction",
            interactionId: draft.id,
            action: "approve_draft",
          },
        },
      }),
    ).rejects.toThrow("stale or failed deterministic validation");

    const unchanged = await getProfile("existing");
    expect(unchanged.version).toBe(seeded.version);
    expect(unchanged.state.activePlan).toEqual(initial.state.activePlan);
    expect(unchanged.state.draft).toEqual(draft);
  });

  it("stores an explicit preference as reset-scoped structured data", async () => {
    const initial = await getProfile("new");
    const seeded = await mutateProfile({
      profileId: "new",
      expectedVersion: initial.version,
      commandId: "seed-preference-message",
      mutation: () => ({
        ...makeReadyState(),
        messages: [
          ...makeReadyState().messages,
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
    expect(agent.requiredFirstTools.at(-1)).toBe("remember_preference");
  });

  it("offers approved food alternatives without changing plan or profile state", async () => {
    const initial = await getProfile("existing");
    if (!("measurements" in initial.state))
      throw new Error("Expected Existing state.");
    const activeBefore = structuredClone(initial.state.activePlan);
    const approvedBefore = [...initial.state.approvedCatalogFoodIds];
    const preferencesBefore = structuredClone(
      initial.state.agentSession.preferences,
    );
    agent.responseText =
      "You could use potato, quinoa, sweet potato, pasta, or whole-wheat pita. Which option would you prefer?";

    const result = await executeCoachTurn(
      turnInput(
        "existing",
        initial.version,
        "offer-rice-alternatives",
        "i dont like rice. any other oprions for my meal plan?",
      ),
    );

    expect(agent.requiredFirstTools).toEqual([null]);
    expect(agent.allowedAfterCalls.every((tools) => tools.length === 0)).toBe(
      true,
    );
    expect(agent.systemPrompts.at(-1)).toContain(
      '"responseMode":"offer_approved_options_only"',
    );
    expect(agent.systemPrompts.at(-1)).toContain('"id":"quinoa-cooked"');
    expect(result.assistantText).toContain("quinoa");
    expect(result.assistantText).not.toContain(
      "I can help with nutrition, food, meal preparation",
    );
    if (!("measurements" in result.profile.state))
      throw new Error("Expected Existing state.");
    expect(result.profile.state.activePlan).toEqual(activeBefore);
    expect(result.profile.state.draft).toBeNull();
    expect(result.profile.state.approvedCatalogFoodIds).toEqual(approvedBefore);
    expect(result.profile.state.agentSession.preferences).toEqual(
      preferencesBefore,
    );
    expect(result.profile.state.agentSession.planChange).toMatchObject({
      scope: "food_replacement",
      excludedCatalogFoodIds: ["white-rice-cooked"],
      requiredCatalogFoodIds: [],
      selectedAlternativeFoodId: null,
    });
    const offeredIds =
      result.profile.state.agentSession.planChange?.offeredAlternativeFoodIds ??
      [];
    expect(offeredIds).toContain("potato-baked");
    expect(offeredIds).not.toContain("white-rice-cooked");
    expect(offeredIds.every((foodId) => approvedBefore.includes(foodId))).toBe(
      true,
    );
    expect(result.profile.state.agentSession.pendingInteraction).toMatchObject({
      type: "clarification",
      workflow: "draft",
      quickReplies: expect.arrayContaining(["Potato"]),
    });
  });

  it("does not invent or persist a replacement workflow when no approved alternative exists", async () => {
    const initial = await getProfile("new");
    const ready = makeReadyState();
    const seeded = await mutateProfile({
      profileId: "new",
      expectedVersion: initial.version,
      commandId: "seed-no-approved-alternative",
      mutation: () => ({
        ...ready,
        profile: {
          ...ready.profile,
          approvedCatalogFoodIds: ["white-rice-cooked"],
        },
      }),
    });
    agent.responseText =
      "There are no eligible approved alternatives yet. Add another carbohydrate to your approved foods, then I can try the replacement again.";

    const result = await executeCoachTurn(
      turnInput(
        "new",
        seeded.version,
        "no-approved-rice-alternative",
        "I do not like rice. What alternatives can I use?",
      ),
    );

    expect(agent.systemPrompts.at(-1)).toContain(
      '"responseMode":"no_approved_options"',
    );
    expect(result.profile.state.agentSession.planChange).toBeNull();
    expect(result.profile.state.agentSession.pendingInteraction).toBeNull();
    expect(result.profile.state.draft).toBeNull();
  });

  it("distinguishes a disliked food from an explicit instruction not to change a plan", async () => {
    const initial = await getProfile("existing");

    await executeCoachTurn(
      turnInput(
        "existing",
        initial.version,
        "create-plan-despite-dislike",
        "Please create a meal plan because I don't like rice.",
      ),
    );
    expect(agent.requiredFirstTools.at(-1)).toBe("submit_draft_proposal");

    const current = await getProfile("existing");
    await executeCoachTurn(
      turnInput(
        "existing",
        current.version,
        "decline-plan-change",
        "Do not change my meal plan.",
      ),
    );
    expect(agent.requiredFirstTools.at(-1)).toBeNull();
  });

  it("routes a whole-plan change through one Draft-only execution plan", async () => {
    const initial = await getProfile("existing");
    const activeBefore = structuredClone(
      "measurements" in initial.state ? initial.state.activePlan : null,
    );

    const result = await executeCoachTurn(
      turnInput(
        "existing",
        initial.version,
        "replace-whole-meal-plan",
        "I want to change the whole meal plan",
      ),
    );

    expect(agent.requiredFirstTools.at(-1)).toBe("submit_draft_proposal");
    expect(agent.allowedAfterCalls.at(-1)).toEqual(["submit_draft_proposal"]);
    expect(result.profile.state.activePlan).toEqual(activeBefore);
    expect(result.profile.state.agentSession.planChange).toMatchObject({
      mode: "replace_active",
      scope: "whole_plan",
      mustDiffer: true,
    });
  });

  it("does not authorize a Draft for a hypothetical plan question", async () => {
    const initial = await getProfile("existing");
    await executeCoachTurn(
      turnInput(
        "existing",
        initial.version,
        "hypothetical-plan-question",
        "What would happen if I changed my meal plan?",
      ),
    );

    expect(agent.requiredFirstTools.at(-1)).toBeNull();
    expect(agent.allowedAfterCalls.at(-1)).not.toContain(
      "submit_draft_proposal",
    );
  });

  it("rejects an unchanged proposal for a whole-plan change", async () => {
    const initial = await getProfile("existing");
    if (!("measurements" in initial.state))
      throw new Error("Expected Existing state.");
    agent.tool = {
      name: "submit_draft_proposal",
      arguments: {
        summary: "The same plan again.",
        meals: initial.state.activePlan.plan.meals.map((meal) => ({
          id: meal.id,
          items: meal.items.map(({ catalogFoodId, grams }) => ({
            catalogFoodId,
            grams,
          })),
        })),
      },
    };

    const result = await executeCoachTurn(
      turnInput(
        "existing",
        initial.version,
        "reject-unchanged-whole-plan",
        "I want to change the whole meal plan",
      ),
    );

    expect(agent.toolResults[0]).toMatchObject({
      accepted: false,
      issues: expect.arrayContaining([
        "The requested plan change must differ from the current plan.",
      ]),
    });
    expect(result.profile.state.draft).toBeNull();
    expect(result.profile.state.activePlan).toEqual(initial.state.activePlan);
  });

  it("allows a requested revision of the currently pending Draft", async () => {
    const initial = await getProfile("new");
    const pendingDraft = makeValidDraft("pending-revision");
    const seeded = await mutateProfile({
      profileId: "new",
      expectedVersion: initial.version,
      commandId: "seed-pending-draft-revision",
      mutation: () => {
        const ready = makeReadyState();
        return {
          ...ready,
          draft: pendingDraft,
          agentSession: {
            ...ready.agentSession,
            pendingInteraction: {
              id: pendingDraft.id,
              type: "draft_approval",
              proposalId: pendingDraft.id,
            },
          },
        };
      },
    });

    const result = await executeCoachTurn(
      turnInput(
        "new",
        seeded.version,
        "revise-pending-draft",
        "Please change the whole meal plan",
      ),
    );

    expect(agent.requiredFirstTools.at(-1)).toBe("submit_draft_proposal");
    expect(agent.allowedAfterCalls.at(-1)).toEqual(["submit_draft_proposal"]);
    expect(result.profile.state.draft).toEqual(pendingDraft);
    expect(result.profile.state.agentSession.planChange).toMatchObject({
      mode: "revise_pending",
      baseDraftId: pendingDraft.id,
      scope: "whole_plan",
    });
  });

  it("turns a selected offered alternative into a Draft while preserving the Active Plan", async () => {
    const initial = await getProfile("existing");
    if (!("measurements" in initial.state))
      throw new Error("Expected Existing state.");
    const activeBefore = structuredClone(initial.state.activePlan);
    const seeded = await mutateProfile({
      profileId: "existing",
      expectedVersion: initial.version,
      commandId: "seed-rice-alternative-conversation",
      mutation: (state) => ({
        ...state,
        agentSession: {
          ...state.agentSession,
          pendingInteraction: {
            id: "choose-rice-alternative",
            type: "clarification",
            workflow: "draft",
            prompt: "Which approved alternative would you like to use?",
            quickReplies: ["Potato", "Couscous"],
          },
          planChange: planChangeWorkflow({
            excludedCatalogFoodIds: ["white-rice-cooked"],
            scope: "food_replacement",
            offeredAlternativeFoodIds: ["potato-baked", "couscous-cooked"],
          }),
        },
        messages: [
          ...state.messages,
          {
            id: "rice-alternative-request",
            role: "user" as const,
            text: "i dont like rice. any other oprions for my meal plan?",
          },
          {
            id: "rice-alternative-offer",
            role: "assistant" as const,
            text: "You could use potato, quinoa, sweet potato, pasta, or whole-wheat pita. Which option would you prefer?",
          },
        ],
      }),
    });
    agent.tool = {
      name: "submit_draft_proposal",
      arguments: {
        summary: "Replaces white rice with potato.",
        meals: activeBefore.plan.meals.map((meal) => ({
          id: meal.id,
          items: meal.items.map((item) => ({
            catalogFoodId:
              item.catalogFoodId === "white-rice-cooked"
                ? "potato-baked"
                : item.catalogFoodId,
            grams:
              item.catalogFoodId === "white-rice-cooked" ? 490 : item.grams,
          })),
        })),
      },
    };

    const result = await executeCoachTurn(
      turnInput(
        "existing",
        seeded.version,
        "select-potato-alternative",
        "Potato, please.",
      ),
    );

    expect(agent.requiredFirstTools.at(-1)).toBe("submit_draft_proposal");
    expect(agent.toolResults[0]).toMatchObject({ accepted: true });
    if (!("measurements" in result.profile.state))
      throw new Error("Expected Existing state.");
    expect(result.profile.state.activePlan).toEqual(activeBefore);
    expect(result.profile.state.draft).not.toBeNull();
    expect(
      result.profile.state.draft?.plan.meals.flatMap((meal) =>
        meal.items.map((item) => item.catalogFoodId),
      ),
    ).not.toContain("white-rice-cooked");
    expect(
      result.profile.state.draft?.plan.meals.flatMap((meal) =>
        meal.items.map((item) => item.catalogFoodId),
      ),
    ).toContain("potato-baked");
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
        arguments: { catalogFoodId: "tofu-firm" },
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
        ? result.profile.state.approvedCatalogFoodIds
        : [],
    ).toContain("tofu-firm");
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
      repairGuidance: {
        requiredMealIdsInOrder: ["breakfast", "lunch", "snack", "dinner"],
        energyKcal: expect.objectContaining({
          action: expect.stringContaining("increase by at least"),
        }),
        proteinG: expect.objectContaining({
          action: expect.stringContaining("increase by at least"),
        }),
      },
    });
  });

  it("gives Arnold the exact generic IDs for a four-meal profile", async () => {
    const initial = await getProfile("new");
    const ready = makeReadyState();
    const seeded = await mutateProfile({
      profileId: "new",
      expectedVersion: initial.version,
      commandId: "seed-four-meal-profile",
      mutation: () => ({
        ...ready,
        profile: { ...ready.profile, mealPattern: "four_meals" },
      }),
    });

    await executeCoachTurn(
      turnInput(
        "new",
        seeded.version,
        "inspect-four-meal-context",
        "How would you structure my day?",
      ),
    );

    expect(agent.systemPrompts[0]).toContain(
      '"expectedMealIds":["meal_1","meal_2","meal_3","meal_4"]',
    );
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
          planChange: planChangeWorkflow({
            basePlanVersion,
            requiredCatalogFoodIds: ["white-rice-cooked"],
          }),
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
    expect(result.profile.state.agentSession.planChange).toEqual(
      planChangeWorkflow({ requiredCatalogFoodIds: ["white-rice-cooked"] }),
    );
  });

  it("starts a new Draft-attempt batch after the user chooses a different mix", async () => {
    const initial = await getProfile("new");
    const seeded = await mutateProfile({
      profileId: "new",
      expectedVersion: initial.version,
      commandId: "seed-retry-batch-profile",
      mutation: () => makeReadyState(),
    });
    const invalid = {
      name: "submit_draft_proposal",
      arguments: {
        summary: "Invalid rice-only Draft.",
        meals: ["breakfast", "lunch", "snack", "dinner"].map((id) => ({
          id,
          items: [{ catalogFoodId: "white-rice-cooked", grams: 300 }],
        })),
      },
    };
    agent.toolSequence = [invalid, invalid, invalid];
    const failed = await executeCoachTurn(
      turnInput(
        "new",
        seeded.version,
        "first-invalid-draft-batch",
        "Create a Draft.",
      ),
    );
    expect(failed.profile.state.agentSession.pendingInteraction?.type).toBe(
      "draft_failure_review",
    );

    agent.toolResults = [];
    agent.toolSequence = [invalid];
    const retried = await executeCoachTurn(
      turnInput(
        "new",
        failed.profile.version,
        "retry-with-different-mix",
        "different mix of approved foods",
      ),
    );

    expect(agent.requiredFirstTools.at(-1)).toBe("submit_draft_proposal");
    expect(agent.toolResults).toHaveLength(1);
    expect(agent.toolResults[0]).toMatchObject({ attempt: 1, accepted: false });
    expect(retried.profile.state.agentSession.planChange).toMatchObject({
      strategy: "different_approved_mix",
      attemptBatch: 2,
    });
    expect(retried.profile.state.draft).toBeNull();
  });
});
