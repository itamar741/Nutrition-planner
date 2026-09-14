import { describe, expect, it } from "vitest";
import { emptyProfile } from "@/data/demo-fixtures";
import {
  applyFactPatch,
  applyOnboardingFactPatch,
  getChecklist,
  getMissingFactKeys,
  getNextTurn,
} from "@/domain/profile/onboarding";

describe("adaptive onboarding domain", () => {
  it("AI-01 applies several supported facts from one patch", () => {
    const profile = applyFactPatch(emptyProfile, {
      age: 30,
      equationSex: "male",
      heightCm: 180,
      currentWeightKg: 80,
    });

    expect(profile).toMatchObject({
      age: 30,
      equationSex: "male",
      heightCm: 180,
      currentWeightKg: 80,
    });
    expect(
      getChecklist(profile).find((item) => item.key === "basics")?.complete,
    ).toBe(true);
  });

  it("AI-02 asks only for a still-missing field", () => {
    const profile = applyFactPatch(emptyProfile, {
      age: 30,
      equationSex: "male",
      heightCm: 180,
      currentWeightKg: 80,
    });
    const turn = getNextTurn(profile);

    expect(getMissingFactKeys(profile)).not.toContain("age");
    expect(turn.type).toBe("closed_question");
    expect(turn.id).toBe("choose-goal");
  });

  it("does not overwrite a previously confirmed fact", () => {
    const profile = applyFactPatch(emptyProfile, { age: 30 });
    const unchanged = applyFactPatch(profile, { age: 42, heightCm: 175 });

    expect(unchanged.age).toBe(30);
    expect(unchanged.heightCm).toBe(175);
  });

  it("allows an explicit correction through the onboarding-only transition", () => {
    const profile = applyFactPatch(emptyProfile, { age: 30 });
    const corrected = applyOnboardingFactPatch(profile, { age: 31 });

    expect(corrected.age).toBe(31);
  });

  it("AI-05 reaches only the dedicated Food Grid turn after all profile facts", () => {
    const profile = applyFactPatch(emptyProfile, {
      age: 30,
      equationSex: "male",
      heightCm: 180,
      currentWeightKg: 80,
      goal: "maintenance",
      dailyRoutine: "mostly_seated",
      exerciseType: "resistance",
      exerciseFrequencyPerWeek: 3,
      exerciseSessionMinutes: 60,
      exerciseIntensity: "moderate",
      eatingRoutine: "Breakfast, lunch, snack, and dinner.",
      mealPattern: "three_meals_one_snack",
    });

    expect(getNextTurn(profile)).toMatchObject({
      type: "food_grid",
      id: "select-foods",
    });
  });

  it("accepts no exercise as a complete zero-volume exercise routine", () => {
    const profile = applyFactPatch(emptyProfile, {
      exerciseType: "none",
      exerciseFrequencyPerWeek: 0,
      exerciseSessionMinutes: 0,
      exerciseIntensity: "moderate",
    });

    expect(profile).toMatchObject({
      exerciseType: "none",
      exerciseFrequencyPerWeek: 0,
      exerciseSessionMinutes: 0,
    });
    expect(
      getChecklist(profile).find((item) => item.key === "exercise")?.complete,
    ).toBe(true);
  });

  it("rejects unsupported patch fields and invalid values", () => {
    expect(() =>
      applyFactPatch(emptyProfile, { age: 12 } as { age: number }),
    ).toThrow();
    expect(() =>
      applyFactPatch(emptyProfile, { allergy: "peanuts" } as never),
    ).toThrow();
  });
});
