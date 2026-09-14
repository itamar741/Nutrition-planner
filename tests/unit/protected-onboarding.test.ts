import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeCoachTurn } from "@/application/coach-turn";
import {
  getProfile,
  resetMemoryPersistenceForTests,
} from "@/persistence/repository";
import type { DemoState } from "@/store/demo-reducer";

const extractOnboardingFacts = vi.hoisted(() => vi.fn());
const interpretTurnDecision = vi.hoisted(() => vi.fn());
const allowedToolSnapshots = vi.hoisted(() => [] as string[][]);

vi.mock("@/ai/onboarding", () => ({ extractOnboardingFacts }));
vi.mock("@/ai/turn-decision", () => ({ interpretTurnDecision }));
vi.mock("@/ai/coach-agent", () => ({
  buildArnoldSystemPrompt: () => "ARNOLD",
  runCoachAgent: async (input: {
    getAllowedTools: () => string[];
    onText: (value: string) => void;
  }) => {
    allowedToolSnapshots.push(input.getAllowedTools());
    input.onText("Please continue onboarding.");
    return {
      text: "Please continue onboarding.",
      toolCall: null,
      toolResult: null,
    };
  },
}));

beforeEach(() => {
  delete process.env.DATABASE_URL;
  resetMemoryPersistenceForTests();
  allowedToolSnapshots.length = 0;
  interpretTurnDecision.mockReset().mockResolvedValue({
    intent: "onboarding_answer",
    speechAct: "answer",
    foodNames: [],
    candidateOrdinal: null,
    referenceScope: "explicit_current",
    planChangeStrategy: null,
    evidence: "I am 30",
  });
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
    expect(interpretTurnDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        onboardingRequired: true,
        onboardingTurn: expect.objectContaining({ id: "collect-basics" }),
      }),
    );
    expect(extractOnboardingFacts).toHaveBeenCalledWith(
      expect.objectContaining({ allowCorrections: true }),
    );
  });

  it.each([
    {
      name: "hypothetical fact",
      text: "What would happen if I were 30?",
      decision: {
        intent: "onboarding_answer",
        speechAct: "hypothetical",
        evidence: "if I were 30",
      },
    },
    {
      name: "negated fact",
      text: "Do not set my age to 30",
      decision: {
        intent: "onboarding_answer",
        speechAct: "negated",
        evidence: "Do not set my age to 30",
      },
    },
    {
      name: "nutrition question",
      text: "What is protein?",
      decision: {
        intent: "nutrition_question",
        speechAct: "question",
        evidence: "What is protein?",
      },
    },
    {
      name: "premature plan request",
      text: "Create my meal plan",
      decision: {
        intent: "plan_create",
        speechAct: "request",
        evidence: "Create my meal plan",
      },
    },
    {
      name: "unsupported request",
      text: "Write a JavaScript loop",
      decision: {
        intent: "unsupported",
        speechAct: "request",
        evidence: "Write a JavaScript loop",
      },
    },
  ])(
    "does not extract or expose tools for a $name",
    async ({ text, decision }) => {
      interpretTurnDecision.mockResolvedValue({
        foodNames: [],
        planChangeStrategy: null,
        ...decision,
      });
      const before = await getProfile<DemoState>("new");

      const result = await executeCoachTurn({
        request: {
          profileId: "new",
          expectedVersion: before.version,
          commandId: `protected-${decision.intent}-${decision.speechAct}`,
          input: { type: "text", text },
        },
        rateIdentity: { sessionHash: "session", ipHash: "ip" },
        turnId: `protected-${decision.intent}-${decision.speechAct}`,
        leaseToken: null,
        onStatus: vi.fn(),
        onText: vi.fn(),
      });

      expect(extractOnboardingFacts).not.toHaveBeenCalled();
      expect(allowedToolSnapshots).toEqual([[]]);
      expect(result.profile.state).toMatchObject({
        profile: before.state.profile,
        activeTurn: before.state.activeTurn,
      });
      expect(result.profile.state.agentSession.planChange).toBeNull();
    },
  );

  it("persists an explicit correction while onboarding is still incomplete", async () => {
    const before = await getProfile<DemoState>("new");
    extractOnboardingFacts.mockResolvedValue({
      patch: { age: 31 },
      acknowledgement: "Corrected your age.",
    });
    interpretTurnDecision.mockResolvedValue({
      intent: "onboarding_answer",
      speechAct: "answer",
      foodNames: [],
      candidateOrdinal: null,
      referenceScope: "explicit_current",
      planChangeStrategy: null,
      evidence: "Actually, I am 31",
    });

    const result = await executeCoachTurn({
      request: {
        profileId: "new",
        expectedVersion: before.version,
        commandId: "protected-onboarding-correction",
        input: { type: "text", text: "Actually, I am 31" },
      },
      rateIdentity: { sessionHash: "session", ipHash: "ip" },
      turnId: "protected-onboarding-correction",
      leaseToken: null,
      onStatus: vi.fn(),
      onText: vi.fn(),
    });

    expect("profile" in result.profile.state).toBe(true);
    if (!("profile" in result.profile.state)) return;
    expect(result.profile.state.profile.age).toBe(31);
  });

  it("replaces the onboarding weight measurement when current weight is corrected", async () => {
    const before = await getProfile<DemoState>("new");
    extractOnboardingFacts.mockResolvedValueOnce({
      patch: { currentWeightKg: 80 },
      acknowledgement: "Recorded your weight.",
    });
    const recorded = await executeCoachTurn({
      request: {
        profileId: "new",
        expectedVersion: before.version,
        commandId: "protected-onboarding-weight",
        input: { type: "text", text: "I weigh 80 kg" },
      },
      rateIdentity: { sessionHash: "session", ipHash: "ip" },
      turnId: "protected-onboarding-weight",
      leaseToken: null,
      onStatus: vi.fn(),
      onText: vi.fn(),
    });
    extractOnboardingFacts.mockResolvedValueOnce({
      patch: { currentWeightKg: 78 },
      acknowledgement: "Corrected your weight.",
    });
    interpretTurnDecision.mockResolvedValueOnce({
      intent: "onboarding_answer",
      speechAct: "answer",
      foodNames: [],
      candidateOrdinal: null,
      referenceScope: "explicit_current",
      planChangeStrategy: null,
      evidence: "Actually, I weigh 78 kg",
    });
    const corrected = await executeCoachTurn({
      request: {
        profileId: "new",
        expectedVersion: recorded.profile.version,
        commandId: "protected-onboarding-weight-correction",
        input: { type: "text", text: "Actually, I weigh 78 kg" },
      },
      rateIdentity: { sessionHash: "session", ipHash: "ip" },
      turnId: "protected-onboarding-weight-correction",
      leaseToken: null,
      onStatus: vi.fn(),
      onText: vi.fn(),
    });

    expect("profile" in corrected.profile.state).toBe(true);
    if (!("profile" in corrected.profile.state)) return;
    expect(corrected.profile.state.profile.currentWeightKg).toBe(78);
    expect(corrected.profile.state.weightMeasurements).toHaveLength(1);
    expect(corrected.profile.state.weightMeasurements[0]?.weightKg).toBe(78);
  });
});
