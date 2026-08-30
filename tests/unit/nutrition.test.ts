import { describe, expect, it } from "vitest";
import { existingProfileFoundation } from "@/data/demo-fixtures";
import {
  calculateRawEer,
  calculateTargets,
  mapPalCategory,
  roundTo25HalfUp,
} from "@/domain/nutrition/calculations";

describe("deterministic nutrition foundation", () => {
  it("VT-01 reproduces the shared raw EER fixture", () => {
    const rawEer = calculateRawEer({
      age: 30,
      equationSex: "male",
      heightCm: 180,
      weightKg: 80,
      palCategory: "low_active",
    });

    expect(rawEer).toBeCloseTo(2945.77, 2);
  });

  it("VT-02 applies each goal multiplier and half-up 25 kcal rounding", () => {
    const ready = {
      ...existingProfileFoundation,
      foodPreferencesComplete: true,
    };

    expect(
      calculateTargets({ ...ready, goal: "maintenance" })?.energyKcal,
    ).toBe(2950);
    expect(calculateTargets({ ...ready, goal: "fat_loss" })?.energyKcal).toBe(
      2500,
    );
    expect(
      calculateTargets({ ...ready, goal: "muscle_gain" })?.energyKcal,
    ).toBe(3250);
    expect(roundTo25HalfUp(2512.5)).toBe(2525);
  });

  it("VT-03 uses the adolescent equation at 18 and adult equation at 19", () => {
    const age18 = calculateRawEer({
      age: 18,
      equationSex: "male",
      heightCm: 180,
      weightKg: 80,
      palCategory: "inactive",
    });
    const expectedAge18 = -447.51 + 3.68 * 18 + 13.01 * 180 + 13.15 * 80 + 20;
    const age19 = calculateRawEer({
      age: 19,
      equationSex: "male",
      heightCm: 180,
      weightKg: 80,
      palCategory: "inactive",
    });
    const expectedAge19 = 753.07 - 10.83 * 19 + 6.5 * 180 + 14.1 * 80;

    expect(age18).toBeCloseTo(expectedAge18, 8);
    expect(age19).toBeCloseTo(expectedAge19, 8);
    expect(age18).not.toBeCloseTo(age19, 2);
  });

  it("VT-04 maps every PAL score boundary deterministically", () => {
    expect(mapPalCategory("mostly_seated", 149)).toBe("inactive");
    expect(mapPalCategory("mostly_seated", 150)).toBe("low_active");
    expect(mapPalCategory("mixed_or_on_feet", 150)).toBe("active");
    expect(mapPalCategory("physically_demanding", 0)).toBe("active");
    expect(mapPalCategory("physically_demanding", 300)).toBe("very_active");
  });

  it("VT-05 creates no targets when a required input or food completion is missing", () => {
    expect(calculateTargets(existingProfileFoundation)).toBeNull();
    expect(
      calculateTargets({
        ...existingProfileFoundation,
        foodPreferencesComplete: true,
        heightCm: null,
      }),
    ).toBeNull();
    expect(() =>
      calculateRawEer({
        age: 17,
        equationSex: "female",
        heightCm: 170,
        weightKg: 65,
        palCategory: "active",
      }),
    ).toThrow("Valid adult EER inputs are required");
  });
});
