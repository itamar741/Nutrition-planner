import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeCoachTurn } from "@/application/coach-turn";
import {
  getProfile,
  resetMemoryPersistenceForTests,
} from "@/persistence/repository";
import type { DemoState } from "@/store/demo-reducer";

const extractOnboardingFacts = vi.hoisted(() => vi.fn());

vi.mock("@/ai/onboarding", () => ({ extractOnboardingFacts }));

beforeEach(() => {
  delete process.env.DATABASE_URL;
  resetMemoryPersistenceForTests();
  extractOnboardingFacts.mockReset().mockResolvedValue({
    patch: { age: 30 },
    acknowledgement: "Noted your age.",
  });
});

describe("protected onboarding", () => {
  it("persists extracted facts through the unified coach turn", async () => {
    const before = await getProfile<DemoState>("new");
    const onText = vi.fn();
    const result = await executeCoachTurn({
      request: {
        profileId: "new",
        expectedVersion: before.version,
        commandId: "protected-onboarding-age",
        input: { type: "text", text: "I am 30." },
      },
      rateIdentity: { sessionHash: "session", ipHash: "ip" },
      turnId: "protected-onboarding-age",
      leaseToken: null,
      onStatus: vi.fn(),
      onText,
    });

    expect("profile" in result.profile.state).toBe(true);
    if (!("profile" in result.profile.state)) return;
    expect(result.profile.version).toBe(before.version + 1);
    expect(result.profile.state.profile.age).toBe(30);
    expect(result.profile.state.processedCommandIds).toContain(
      "protected-onboarding-age",
    );
    expect(onText).toHaveBeenCalledWith(
      expect.stringContaining("Noted your age."),
    );
  });
});
