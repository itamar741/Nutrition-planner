import { describe, expect, it } from "vitest";
import { submitOnboardingFacts } from "@/application/coach-tools/onboarding";
import { modelFactExtractionSchema } from "@/ai/contracts";
import { createNewDemoState, emptyProfile } from "@/data/demo-fixtures";
import { getNextTurn } from "@/domain/profile/onboarding";

function exerciseStepState() {
  const profile = {
    ...emptyProfile,
    age: 30,
    equationSex: "male" as const,
    heightCm: 180,
    currentWeightKg: 80,
    goal: "maintenance" as const,
    dailyRoutine: "mostly_seated" as const,
  };
  return {
    ...createNewDemoState(),
    profile,
    activeTurn: getNextTurn(profile),
  };
}

function submit(facts: Record<string, unknown>) {
  return submitOnboardingFacts({
    state: exerciseStepState(),
    facts,
    acknowledgement: "Noted your exercise routine.",
    supportingMessageId: "user-no-exercise",
    currentMessageId: "user-no-exercise",
    currentDate: "2026-09-30",
    commandId: "no-exercise-command",
  });
}

describe("onboarding exercise tool", () => {
  it("accepts none only as a temporary extraction-boundary intensity", () => {
    const extraction = modelFactExtractionSchema.parse({
      facts: {
        age: null,
        equationSex: null,
        heightCm: null,
        currentWeightKg: null,
        goal: null,
        dailyRoutine: null,
        exerciseType: "none",
        exerciseFrequencyPerWeek: 0,
        exerciseSessionMinutes: 0,
        exerciseIntensity: "none",
        eatingRoutine: null,
        mealPattern: null,
      },
      acknowledgement: "Got it — no exercise.",
    });

    expect(extraction.facts.exerciseIntensity).toBe("none");
  });

  it.each([null, "none"])(
    "normalizes no exercise with %s intensity and advances the step",
    (exerciseIntensity) => {
      const handled = submit({
        exerciseType: "none",
        exerciseFrequencyPerWeek: null,
        exerciseSessionMinutes: null,
        exerciseIntensity,
      });

      expect(handled.result).toMatchObject({
        status: "completed",
        code: "onboarding_facts_applied",
        nextTurn: { id: "collect-eating-routine" },
      });
      expect("profile" in handled.state && handled.state.profile).toMatchObject(
        {
          exerciseType: "none",
          exerciseFrequencyPerWeek: 0,
          exerciseSessionMinutes: 0,
          exerciseIntensity: null,
        },
      );
    },
  );

  it("persists an active-routine partial answer and reports the missing fields", () => {
    const handled = submit({
      exerciseType: "cardio",
      exerciseFrequencyPerWeek: 3,
      exerciseSessionMinutes: null,
      exerciseIntensity: null,
    });

    expect(handled.result).toMatchObject({
      status: "needs_user_action",
      code: "onboarding_step_incomplete",
      remainingFields: ["exerciseSessionMinutes", "exerciseIntensity"],
      nextTurn: { id: "collect-exercise" },
    });
    expect("profile" in handled.state && handled.state.profile).toMatchObject({
      exerciseType: "cardio",
      exerciseFrequencyPerWeek: 3,
      exerciseSessionMinutes: null,
      exerciseIntensity: null,
    });
  });
});
