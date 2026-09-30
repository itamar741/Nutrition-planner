import { describe, expect, it } from "vitest";
import {
  upgradePersistedStateV4,
  upgradePersistedStateV5,
} from "@/store/state-schema";
import { createNewDemoState } from "@/data/demo-fixtures";

const attempt = {
  attempt: 1,
  summary: "Rejected Draft",
  meals: [],
  totals: {},
  checks: [],
  issues: ["Energy was high."],
};

describe("persisted state schema v4 upgrade", () => {
  it("recovers rejected Draft attempts from a v3 failure review", () => {
    const upgraded = upgradePersistedStateV4({
      schemaVersion: 3,
      agentSession: {
        planChange: { id: "plan-change" },
        pendingInteraction: {
          type: "draft_failure_review",
          attempts: [attempt],
        },
      },
    }) as {
      schemaVersion: number;
      agentSession: { planChange: { rejectedDraftAttempts: unknown[] } };
    };

    expect(upgraded.schemaVersion).toBe(4);
    expect(upgraded.agentSession.planChange.rejectedDraftAttempts).toEqual([
      attempt,
    ]);
  });

  it("initializes an empty attempt history when v3 has no review", () => {
    const upgraded = upgradePersistedStateV4({
      schemaVersion: 3,
      agentSession: {
        planChange: { id: "plan-change" },
        pendingInteraction: null,
      },
    }) as {
      agentSession: { planChange: { rejectedDraftAttempts: unknown[] } };
    };

    expect(upgraded.agentSession.planChange.rejectedDraftAttempts).toEqual([]);
  });
});

describe("persisted state schema v5 upgrade", () => {
  it("recovers a Fresh profile stuck on no exercise without losing state", () => {
    const current = createNewDemoState();
    const messages = [
      ...current.messages,
      { id: "user-no-exercise", role: "user" as const, text: "no exercise" },
    ];
    const upgraded = upgradePersistedStateV5({
      ...current,
      schemaVersion: 4,
      messages,
      profile: {
        ...current.profile,
        age: 30,
        equationSex: "male",
        heightCm: 180,
        currentWeightKg: 80,
        goal: "maintenance",
        dailyRoutine: "mostly_seated",
        exerciseType: "none",
        exerciseFrequencyPerWeek: 0,
        exerciseSessionMinutes: 0,
        exerciseIntensity: null,
      },
      activeTurn: {
        type: "open_question",
        id: "collect-exercise",
        field: "multiple",
        prompt: "Describe your exercise.",
      },
    }) as ReturnType<typeof createNewDemoState>;

    expect(upgraded.schemaVersion).toBe(5);
    expect(upgraded.profile).toMatchObject({
      exerciseType: "none",
      exerciseFrequencyPerWeek: 0,
      exerciseSessionMinutes: 0,
      exerciseIntensity: null,
    });
    expect(upgraded.activeTurn.id).toBe("collect-eating-routine");
    expect(upgraded.messages).toEqual(messages);
    expect(upgraded.agentSession).toEqual(current.agentSession);
  });
});
