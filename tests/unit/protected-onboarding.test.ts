import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeCoachTurn } from "@/application/coach-turn";
import {
  getProfile,
  mutateProfile,
  resetMemoryPersistenceForTests,
} from "@/persistence/repository";
import type { DemoState } from "@/store/demo-reducer";
import { getNextTurn } from "@/domain/profile/onboarding";

const allowedToolSnapshots = vi.hoisted(() => [] as string[][]);
const onboardingTool = vi.hoisted(() => ({
  arguments: null as Record<string, unknown> | null,
}));

vi.mock("@/ai/coach-agent", () => ({
  coachToolNames: [
    "submit_onboarding_facts",
    "remember_preference",
    "remove_approved_food",
    "inspect_food_availability",
    "record_weight",
    "edit_weight",
    "delete_weight",
    "search_foods",
    "select_food_candidate",
    "offer_approved_food_alternatives",
    "begin_plan_change",
    "submit_draft_proposal",
    "submit_adjustment_proposal",
    "answer_user",
    "ask_clarification",
    "decline_out_of_scope",
  ],
  buildArnoldSystemPrompt: () => "ARNOLD",
  runCoachAgent: async (input: {
    getAllowedTools: () => string[];
    onText: (value: string) => void;
    onTool: (
      call: {
        name: "submit_onboarding_facts";
        callId: string;
        arguments: Record<string, unknown>;
      },
      sequence: number,
    ) => Promise<Record<string, unknown>>;
  }) => {
    allowedToolSnapshots.push(input.getAllowedTools());
    const result = onboardingTool.arguments
      ? await input.onTool(
          {
            name: "submit_onboarding_facts",
            callId: "onboarding-call",
            arguments: onboardingTool.arguments,
          },
          1,
        )
      : null;
    const acknowledgement =
      result && typeof result.acknowledgement === "string"
        ? result.acknowledgement
        : "Please continue onboarding.";
    input.onText(acknowledgement);
    return {
      text: acknowledgement,
      toolCall: null,
      toolResult: null,
    };
  },
}));

beforeEach(() => {
  delete process.env.DATABASE_URL;
  resetMemoryPersistenceForTests();
  allowedToolSnapshots.length = 0;
  onboardingTool.arguments = onboardingArguments(
    { age: 30 },
    {
      acknowledgement: "Noted your age.",
    },
  );
});

function onboardingArguments(
  facts: Record<string, unknown>,
  options: { acknowledgement: string; messageId?: string },
) {
  return {
    facts: {
      age: null,
      equationSex: null,
      heightCm: null,
      currentWeightKg: null,
      goal: null,
      dailyRoutine: null,
      exerciseType: null,
      exerciseFrequencyPerWeek: null,
      exerciseSessionMinutes: null,
      exerciseIntensity: null,
      eatingRoutine: null,
      mealPattern: null,
      ...facts,
    },
    acknowledgement: options.acknowledgement,
    supportingMessageId: options.messageId ?? "user-protected-onboarding-age",
  };
}

describe("protected onboarding", () => {
  it("advances no exercise to the eating-routine question", async () => {
    const initial = await getProfile<DemoState>("new");
    const seeded = await mutateProfile<DemoState>({
      profileId: "new",
      expectedVersion: initial.version,
      commandId: "seed-exercise-step",
      mutation: (state) => {
        const profile = {
          ...state.profile,
          age: 30,
          equationSex: "male" as const,
          heightCm: 180,
          currentWeightKg: 80,
          goal: "maintenance" as const,
          dailyRoutine: "mostly_seated" as const,
        };
        return { ...state, profile, activeTurn: getNextTurn(profile) };
      },
    });
    onboardingTool.arguments = onboardingArguments(
      {
        exerciseType: "none",
        exerciseFrequencyPerWeek: 0,
        exerciseSessionMinutes: 0,
        exerciseIntensity: "none",
      },
      {
        acknowledgement: "Got it — no exercise.",
        messageId: "user-protected-no-exercise",
      },
    );

    const result = await executeCoachTurn({
      request: {
        profileId: "new",
        expectedVersion: seeded.version,
        commandId: "protected-no-exercise",
        input: { type: "text", text: "no exercise" },
      },
      rateIdentity: { sessionHash: "session", ipHash: "ip" },
      turnId: "protected-no-exercise",
      leaseToken: null,
      onStatus: vi.fn(),
      onText: vi.fn(),
    });

    expect("profile" in result.profile.state).toBe(true);
    if (!("profile" in result.profile.state)) return;
    expect(result.profile.state.profile).toMatchObject({
      exerciseType: "none",
      exerciseFrequencyPerWeek: 0,
      exerciseSessionMinutes: 0,
      exerciseIntensity: null,
    });
    expect(result.profile.state.activeTurn.id).toBe("collect-eating-routine");
  });

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
    expect(allowedToolSnapshots[0]).toContain("submit_onboarding_facts");
  });

  it.each([
    {
      name: "hypothetical fact",
      key: "hypothetical-fact",
      text: "What would happen if I were 30?",
    },
    {
      name: "negated fact",
      key: "negated-fact",
      text: "Do not set my age to 30",
    },
    {
      name: "nutrition question",
      key: "nutrition-question",
      text: "What is protein?",
    },
    {
      name: "premature plan request",
      key: "premature-plan-request",
      text: "Create my meal plan",
    },
    {
      name: "unsupported request",
      key: "unsupported-request",
      text: "Write a JavaScript loop",
    },
  ])(
    "does not mutate onboarding when Arnold calls no skill for a $name",
    async ({ text, key }) => {
      onboardingTool.arguments = null;
      const before = await getProfile<DemoState>("new");

      const result = await executeCoachTurn({
        request: {
          profileId: "new",
          expectedVersion: before.version,
          commandId: `protected-${key}`,
          input: { type: "text", text },
        },
        rateIdentity: { sessionHash: "session", ipHash: "ip" },
        turnId: `protected-${key}`,
        leaseToken: null,
        onStatus: vi.fn(),
        onText: vi.fn(),
      });

      expect(allowedToolSnapshots[0]).toContain("submit_onboarding_facts");
      expect(result.profile.state).toMatchObject({
        profile: before.state.profile,
        activeTurn: before.state.activeTurn,
      });
      expect(result.profile.state.agentSession.planChange).toBeNull();
    },
  );

  it("persists an explicit correction while onboarding is still incomplete", async () => {
    const before = await getProfile<DemoState>("new");
    onboardingTool.arguments = onboardingArguments(
      { age: 31 },
      {
        acknowledgement: "Corrected your age.",
        messageId: "user-protected-onboarding-correction",
      },
    );

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
    onboardingTool.arguments = onboardingArguments(
      { currentWeightKg: 80 },
      {
        acknowledgement: "Recorded your weight.",
        messageId: "user-protected-onboarding-weight",
      },
    );
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
    onboardingTool.arguments = onboardingArguments(
      { currentWeightKg: 78 },
      {
        acknowledgement: "Corrected your weight.",
        messageId: "user-protected-onboarding-weight-correction",
      },
    );
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
