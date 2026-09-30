import { describe, expect, it } from "vitest";
import { upgradePersistedStateV4 } from "@/store/state-schema";

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
