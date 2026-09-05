import { beforeEach, describe, expect, it } from "vitest";
import type { CatalogFood } from "@/domain/catalog/types";
import {
  StaleProfileError,
  ActiveAgentTurnError,
  assertNoActiveAgentTurn,
  approveCatalogFood,
  getProfile,
  listCatalogFoods,
  mutateProfile,
  recordAndCheckRateLimit,
  recordAndCheckAgentRateLimit,
  reserveAgentTurn,
  finishAgentTurn,
  listConversationMessages,
  listConversationActivities,
  appendConversationActivity,
  updateAssistantMessage,
  resetMemoryPersistenceForTests,
  resetProfile,
} from "@/persistence/repository";
import type { DemoState } from "@/store/demo-reducer";
import type { ExistingDemoState } from "@/store/existing-demo-store";

const runtimeFood: CatalogFood = {
  schemaVersion: 1,
  id: "runtime-test-rice",
  displayName: "Test rice",
  preparation: "cooked",
  category: "carbohydrate",
  mealClassification: "neutral",
  kosherCatalogApproved: false,
  kosherReview: "not_checked",
  source: {
    provider: "Fuder",
    url: "https://www.fuder.co.il/foods/test-rice/",
    retrievedAt: "2026-09-01T12:00:00.000Z",
    verification: "fuder_verified",
  },
  nutrientsPer100g: {
    energyKcal: 130,
    proteinG: 2.7,
    carbohydrateG: 28,
    fatG: 0.3,
    fiberG: null,
  },
  displayPortion: { label: "100 g cooked", grams: 100 },
  practicalGrams: { min: 50, max: 500, step: 25 },
  runtimeApproval: {
    approvedAt: "2026-09-01T12:00:00.000Z",
    approvedByProfileId: "new",
  },
};

beforeEach(() => {
  delete process.env.DATABASE_URL;
  resetMemoryPersistenceForTests();
});

describe("versioned demo persistence", () => {
  it("isolates profile changes and rejects stale versions", async () => {
    const existingBefore = await getProfile<ExistingDemoState>("existing");
    const fresh = await getProfile<DemoState>("new");
    const changed = await mutateProfile<DemoState>({
      profileId: "new",
      expectedVersion: fresh.version,
      commandId: "profile-isolation-command",
      mutation: (state) => ({ ...state, error: "changed only in Fresh" }),
    });

    expect(changed.version).toBe(2);
    expect((await getProfile<ExistingDemoState>("existing")).state).toEqual(
      existingBefore.state,
    );
    await expect(
      mutateProfile<DemoState>({
        profileId: "new",
        expectedVersion: 1,
        commandId: "stale-profile-command",
        mutation: (state) => state,
      }),
    ).rejects.toBeInstanceOf(StaleProfileError);
  });

  it("returns the original result when a command is repeated", async () => {
    const first = await mutateProfile<DemoState>({
      profileId: "new",
      expectedVersion: 1,
      commandId: "idempotent-command",
      mutation: (state) => ({ ...state, error: "once" }),
    });
    const duplicate = await mutateProfile<DemoState>({
      profileId: "new",
      expectedVersion: 1,
      commandId: "idempotent-command",
      mutation: (state) => ({ ...state, error: "twice" }),
    });

    expect(duplicate).toEqual(first);
    expect((await getProfile<DemoState>("new")).version).toBe(2);
    expect((await getProfile<DemoState>("new")).state.error).toBe("once");
  });

  it("keeps runtime foods central while resetting only the requesting demo", async () => {
    const existingBefore = await getProfile<ExistingDemoState>("existing");
    const approved = await approveCatalogFood({
      food: runtimeFood,
      sourceIdentifier: `fuder:${runtimeFood.source.provider === "Fuder" ? runtimeFood.source.url : ""}`,
      profileId: "new",
      expectedVersion: 1,
      commandId: "approve-runtime-food",
    });

    expect("profile" in approved.profile.state).toBe(true);
    if (!("profile" in approved.profile.state)) {
      throw new Error("Expected the Fresh profile state.");
    }
    expect(approved.profile.state.profile.approvedCatalogFoodIds).toContain(
      runtimeFood.id,
    );
    expect(
      (await getProfile<ExistingDemoState>("existing")).state
        .approvedCatalogFoodIds,
    ).not.toContain(runtimeFood.id);

    await resetProfile({
      profileId: "new",
      expectedVersion: approved.profile.version,
      commandId: "reset-fresh-demo",
    });

    expect(
      (await getProfile<DemoState>("new")).state.profile.approvedCatalogFoodIds,
    ).not.toContain(runtimeFood.id);
    expect(
      (await listCatalogFoods()).some((food) => food.id === runtimeFood.id),
    ).toBe(true);
    expect((await getProfile<ExistingDemoState>("existing")).state).toEqual(
      existingBefore.state,
    );
  });

  it("does not insert a catalog record when approval has a stale version", async () => {
    await mutateProfile<DemoState>({
      profileId: "new",
      expectedVersion: 1,
      commandId: "advance-version-command",
      mutation: (state) => state,
    });
    await expect(
      approveCatalogFood({
        food: runtimeFood,
        sourceIdentifier: "fuder:stale-test",
        profileId: "new",
        expectedVersion: 1,
        commandId: "stale-approval-command",
      }),
    ).rejects.toBeInstanceOf(StaleProfileError);
    expect(
      (await listCatalogFoods()).some((food) => food.id === runtimeFood.id),
    ).toBe(false);
  });

  it("deduplicates a source identifier even if a later model changes the name", async () => {
    await approveCatalogFood({
      food: runtimeFood,
      sourceIdentifier: "fuder:stable-source-record",
      profileId: "new",
      expectedVersion: 1,
      commandId: "first-source-approval",
    });
    const duplicate = await approveCatalogFood({
      food: {
        ...runtimeFood,
        id: "runtime-renamed-rice",
        displayName: "Renamed rice result",
      },
      sourceIdentifier: "fuder:stable-source-record",
      profileId: "existing",
      expectedVersion: 1,
      commandId: "second-source-approval",
    });

    expect(duplicate.food.id).toBe(runtimeFood.id);
    expect("profile" in duplicate.profile.state).toBe(false);
    if ("profile" in duplicate.profile.state) return;
    expect(duplicate.profile.state.approvedCatalogFoodIds).toContain(
      runtimeFood.id,
    );
    expect(
      (await listCatalogFoods()).filter(
        (food) =>
          food.id === runtimeFood.id || food.id === "runtime-renamed-rice",
      ),
    ).toHaveLength(1);
  });
});

describe("persistent lookup limits", () => {
  it("allows ten hourly requests and keeps the limit after a profile reset", async () => {
    const identity = { sessionHash: "session-a", ipHash: "ip-a" };
    for (let index = 0; index < 10; index += 1) {
      await expect(recordAndCheckRateLimit(identity)).resolves.toBe(true);
    }
    await expect(recordAndCheckRateLimit(identity)).resolves.toBe(false);
    await resetProfile({
      profileId: "new",
      expectedVersion: 1,
      commandId: "reset-does-not-clear-rate-limit",
    });
    await expect(recordAndCheckRateLimit(identity)).resolves.toBe(false);
  });
});

describe("persisted agent turns", () => {
  it("deduplicates completed commands and blocks a concurrent turn", async () => {
    const first = await reserveAgentTurn({
      profileId: "new",
      expectedVersion: 1,
      commandId: "agent-command-one",
      request: { input: "hello" },
    });
    expect(first.outcome).toBe("reserved");
    await expect(
      reserveAgentTurn({
        profileId: "new",
        expectedVersion: 1,
        commandId: "agent-command-two",
        request: { input: "concurrent" },
      }),
    ).rejects.toBeInstanceOf(ActiveAgentTurnError);
    await finishAgentTurn({
      profileId: "new",
      commandId: "agent-command-one",
      status: "completed",
      result: { answer: "done" },
    });
    const duplicate = await reserveAgentTurn({
      profileId: "new",
      expectedVersion: 1,
      commandId: "agent-command-one",
      request: { input: "hello" },
    });
    expect(duplicate.outcome).toBe("duplicate");
    expect(duplicate.turn.result).toEqual({ answer: "done" });
  });

  it("clears profile-scoped turns on reset while preserving agent rate limits", async () => {
    const identity = { sessionHash: "agent-session", ipHash: "agent-ip" };
    await reserveAgentTurn({
      profileId: "new",
      expectedVersion: 1,
      commandId: "agent-before-reset",
      request: { input: "hello" },
    });
    await finishAgentTurn({
      profileId: "new",
      commandId: "agent-before-reset",
      status: "completed",
      result: { answer: "done" },
    });
    for (let index = 0; index < 30; index += 1) {
      await expect(recordAndCheckAgentRateLimit(identity)).resolves.toBe(true);
    }
    await resetProfile({
      profileId: "new",
      expectedVersion: 1,
      commandId: "reset-agent-state",
    });
    await expect(recordAndCheckAgentRateLimit(identity)).resolves.toBe(false);
    await expect(
      reserveAgentTurn({
        profileId: "new",
        expectedVersion: 2,
        commandId: "agent-before-reset",
        request: { input: "new turn after reset" },
      }),
    ).resolves.toMatchObject({ outcome: "reserved" });
  });

  it("persists user, partial, failed, and retry assistant output without duplicating the user", async () => {
    const request = { input: { type: "text", text: "Please help" } };
    const first = await reserveAgentTurn({
      profileId: "new",
      expectedVersion: 1,
      commandId: "durable-stream-command",
      request,
      userMessage: {
        id: "user-durable-stream-command",
        content: "Please help",
      },
    });
    await updateAssistantMessage({
      profileId: "new",
      messageId: first.assistantMessageId,
      content: "Partial Arnold output",
      status: "partial",
    });
    await finishAgentTurn({
      profileId: "new",
      commandId: "durable-stream-command",
      status: "failed",
      failureCode: "stream_disconnected",
    });
    await updateAssistantMessage({
      profileId: "new",
      messageId: first.assistantMessageId,
      content: "Partial Arnold output",
      status: "failed",
    });

    const retry = await reserveAgentTurn({
      profileId: "new",
      expectedVersion: 1,
      commandId: "durable-stream-command",
      request,
      userMessage: {
        id: "user-durable-stream-command",
        content: "Please help",
      },
    });
    expect(retry.outcome).toBe("resumed");
    await updateAssistantMessage({
      profileId: "new",
      messageId: retry.assistantMessageId,
      content: "Final Arnold output",
      status: "final",
    });

    const messages = await listConversationMessages("new");
    expect(
      messages.filter(
        (message) => message.id === "user-durable-stream-command",
      ),
    ).toHaveLength(1);
    expect(
      messages.filter((message) => message.turnId === "durable-stream-command"),
    ).toEqual([
      expect.objectContaining({ role: "user", status: "final" }),
      expect.objectContaining({ role: "assistant", status: "failed" }),
      expect.objectContaining({
        role: "assistant",
        status: "final",
        content: "Final Arnold output",
      }),
    ]);
  });

  it("resumes the same failed command after its profile version advances", async () => {
    const originalRequest = {
      profileId: "new",
      expectedVersion: 1,
      commandId: "resume-after-version-command",
      input: { type: "text", text: "Remember dinner" },
    };
    await reserveAgentTurn({
      profileId: "new",
      expectedVersion: 1,
      commandId: originalRequest.commandId,
      request: originalRequest,
      userMessage: {
        id: "user-resume-after-version-command",
        content: "Remember dinner",
      },
    });
    await finishAgentTurn({
      profileId: "new",
      commandId: originalRequest.commandId,
      status: "failed",
      failureCode: "provider_failed",
    });
    await mutateProfile<DemoState>({
      profileId: "new",
      expectedVersion: 1,
      commandId: "advance-before-agent-retry",
      mutation: (state) => state,
    });

    await expect(
      reserveAgentTurn({
        profileId: "new",
        expectedVersion: 2,
        commandId: originalRequest.commandId,
        request: { ...originalRequest, expectedVersion: 2 },
        userMessage: {
          id: "user-resume-after-version-command",
          content: "Remember dinner",
        },
      }),
    ).resolves.toMatchObject({ outcome: "resumed" });
    expect(
      (await listConversationMessages("new")).filter(
        (message) => message.id === "user-resume-after-version-command",
      ),
    ).toHaveLength(1);
  });

  it("blocks ordinary profile writes while an agent turn is active", async () => {
    await reserveAgentTurn({
      profileId: "existing",
      expectedVersion: 1,
      commandId: "active-turn-write-lock",
      request: { input: "review" },
    });
    await expect(assertNoActiveAgentTurn("existing")).rejects.toBeInstanceOf(
      ActiveAgentTurnError,
    );
  });

  it("stores activity separately from messages and clears it on profile reset", async () => {
    await appendConversationActivity({
      profileId: "new",
      id: "activity-thinking-test",
      turnId: "activity-turn-test",
      kind: "thinking",
      label: "Thinking",
    });
    expect(await listConversationActivities("new")).toEqual([
      expect.objectContaining({ kind: "thinking", label: "Thinking" }),
    ]);
    expect(
      (await listConversationMessages("new")).some(
        (message) => message.content === "Thinking",
      ),
    ).toBe(false);

    await resetProfile({
      profileId: "new",
      expectedVersion: 1,
      commandId: "reset-clears-activity-events",
    });
    expect(await listConversationActivities("new")).toEqual([]);
  });
});
