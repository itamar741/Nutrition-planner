import { describe, expect, it } from "vitest";
import { existingProfileFoundation } from "@/data/demo-fixtures";
import { foodCatalog, foodCategoryOrder } from "@/data/food-catalog";
import { calculateTargets } from "@/domain/nutrition/calculations";
import {
  applyModificationToDraft,
  calculatePortionNutrients,
  repairCandidateNutrition,
  revalidatePlan,
  validateAndBuildPlan,
  validateFoodSelections,
} from "@/domain/plan/validation";
import type { DraftCandidate, DraftProposal } from "@/domain/plan/types";
import type { StructuredProfile } from "@/domain/profile/types";

const allFoodIds = foodCatalog.map((food) => food.id);

function readyProfile(): StructuredProfile {
  return {
    ...existingProfileFoundation,
    foodPreferencesComplete: true,
    approvedCatalogFoodIds: allFoodIds,
  };
}

function validMaintenanceCandidate(): DraftCandidate {
  return {
    summary: "A four-part repeatable maintenance day.",
    meals: [
      {
        id: "breakfast",
        items: [
          { catalogFoodId: "rolled-oats-dry", grams: 100, alternatives: [] },
          {
            catalogFoodId: "greek-yogurt-nonfat",
            grams: 300,
            alternatives: [],
          },
          { catalogFoodId: "banana-raw", grams: 115, alternatives: [] },
        ],
      },
      {
        id: "lunch",
        items: [
          {
            catalogFoodId: "chicken-breast-roasted",
            grams: 250,
            alternatives: [],
          },
          {
            catalogFoodId: "white-rice-cooked",
            grams: 350,
            alternatives: [],
          },
          { catalogFoodId: "broccoli-raw", grams: 150, alternatives: [] },
          { catalogFoodId: "olive-oil", grams: 15, alternatives: [] },
        ],
      },
      {
        id: "snack",
        items: [
          { catalogFoodId: "banana-raw", grams: 115, alternatives: [] },
          { catalogFoodId: "avocado-raw", grams: 100, alternatives: [] },
        ],
      },
      {
        id: "dinner",
        items: [
          {
            catalogFoodId: "white-rice-cooked",
            grams: 350,
            alternatives: [],
          },
          {
            catalogFoodId: "sweet-potato-baked",
            grams: 400,
            alternatives: [],
          },
          { catalogFoodId: "broccoli-raw", grams: 150, alternatives: [] },
          { catalogFoodId: "olive-oil", grams: 20, alternatives: [] },
        ],
      },
    ],
  };
}

function buildValidDraft(): DraftProposal {
  const profile = readyProfile();
  const targets = calculateTargets(profile);
  if (!targets) throw new Error("Expected targets");
  const plan = validateAndBuildPlan({
    candidate: validMaintenanceCandidate(),
    profile,
    targets,
    planId: "plan-1",
    version: 1,
  });
  return {
    schemaVersion: 1,
    id: "proposal-1",
    basePlanVersion: null,
    reason: "initial",
    summary: "Initial Draft",
    plan,
  };
}

describe("closed food catalog", () => {
  it("contains one reviewed source of truth across all five categories", () => {
    expect(foodCatalog).toHaveLength(16);
    expect(new Set(foodCatalog.map((food) => food.id)).size).toBe(16);
    expect(new Set(foodCatalog.map((food) => food.source.provider))).toEqual(
      new Set(["USDA FoodData Central"]),
    );
    expect(new Set(foodCatalog.map((food) => food.category))).toEqual(
      new Set(foodCategoryOrder),
    );
    expect(foodCatalog.every((food) => food.kosherCatalogApproved)).toBe(true);
  });

  it("calculates a portion from stored per-100 g values", () => {
    const rice = foodCatalog.find((food) => food.id === "white-rice-cooked");
    if (!rice) throw new Error("Missing rice fixture");
    expect(calculatePortionNutrients(rice, 158)).toEqual({
      energyKcal: 205.4,
      proteinG: 4.2502,
      carbohydrateG: 44.556,
      fatG: 0.44240000000000007,
      fiberG: 0.6320000000000001,
    });
  });

  it("requires every category and rejects unknown or duplicate IDs", () => {
    const incomplete = validateFoodSelections([
      "rolled-oats-dry",
      "chicken-breast-roasted",
      "olive-oil",
      "broccoli-raw",
    ]);
    expect(incomplete.valid).toBe(false);
    expect(incomplete.issues).toContain("Select at least one food in fruit.");

    const invalid = validateFoodSelections([
      ...allFoodIds,
      "not-in-catalog",
      "rolled-oats-dry",
    ]);
    expect(invalid.valid).toBe(false);
    expect(invalid.issues.join(" ")).toMatch(/duplicate|Unknown/);
  });
});

describe("deterministic Draft validation", () => {
  it("accepts a catalog-backed maintenance Draft within every range", () => {
    const draft = buildValidDraft();
    expect(draft.plan.validation.valid).toBe(true);
    expect(draft.plan.validation.issues).toEqual([]);
    expect(draft.plan.validation.totals.energyKcal).toBeGreaterThan(2_800);
    expect(draft.plan.validation.totals.energyKcal).toBeLessThan(3_100);
    expect(draft.plan.validation.totals.fiberG).toBeGreaterThanOrEqual(
      draft.plan.targetSnapshot.fiberMinimumG,
    );
  });

  it("repairs an under-filled model candidate without leaving catalog bounds", () => {
    const profile = readyProfile();
    const targets = calculateTargets(profile);
    if (!targets) throw new Error("Expected targets");
    const candidate = validMaintenanceCandidate();
    candidate.meals[3].items.push({
      catalogFoodId: "white-rice-cooked",
      grams: 50,
      alternatives: [],
    });
    candidate.meals.forEach((meal) =>
      meal.items.forEach((item) => {
        const food = foodCatalog.find(
          (catalogFood) => catalogFood.id === item.catalogFoodId,
        );
        if (!food) throw new Error("Missing food fixture");
        item.grams = food.practicalGrams.min;
        item.alternatives = [{ catalogFoodId: "banana-raw", grams: 115 }];
      }),
    );

    const repaired = repairCandidateNutrition({
      candidate,
      profile,
      targets,
    });
    expect(repaired).not.toBeNull();
    if (!repaired) return;
    const plan = validateAndBuildPlan({
      candidate: repaired,
      profile,
      targets,
      planId: "repaired-plan",
      version: 1,
    });
    expect(plan.validation.valid).toBe(true);
    expect(
      repaired.meals
        .flatMap((meal) => meal.items)
        .every((item) => item.alternatives.length === 0),
    ).toBe(true);
  });

  it("applies the documented acceptance ranges for all three fixed goals", () => {
    const maintenanceCandidate = validMaintenanceCandidate();
    const fatLossCandidate = structuredClone(maintenanceCandidate);
    const fatLossGrams = [
      [85, 250, 95],
      [205, 290, 125, 15],
      [95, 85],
      [290, 330, 125, 15],
    ];
    fatLossCandidate.meals.forEach((meal, mealIndex) =>
      meal.items.forEach((item, itemIndex) => {
        item.grams = fatLossGrams[mealIndex][itemIndex];
      }),
    );

    const muscleGainCandidate = structuredClone(maintenanceCandidate);
    muscleGainCandidate.meals[2].items.push({
      catalogFoodId: "apple-fuji-raw",
      grams: 80,
      alternatives: [],
    });
    muscleGainCandidate.meals[3].items[3].grams = 40;

    for (const [goal, candidate] of [
      ["fat_loss", fatLossCandidate],
      ["maintenance", maintenanceCandidate],
      ["muscle_gain", muscleGainCandidate],
    ] as const) {
      const profile = { ...readyProfile(), goal };
      const targets = calculateTargets(profile);
      if (!targets) throw new Error("Expected targets");
      const plan = validateAndBuildPlan({
        candidate,
        profile,
        targets,
        planId: `plan-${goal}`,
        version: 1,
      });
      expect(plan.validation.issues, goal).toEqual([]);
      expect(plan.validation.valid, goal).toBe(true);
    }
  });

  it("rejects unapproved and invented foods without assigning nutrition", () => {
    const profile = {
      ...readyProfile(),
      approvedCatalogFoodIds: allFoodIds.filter(
        (id) => id !== "chicken-breast-roasted",
      ),
    };
    const targets = calculateTargets(profile);
    if (!targets) throw new Error("Expected targets");
    const candidate = validMaintenanceCandidate();
    candidate.meals[0].items.push({
      catalogFoodId: "invented-food",
      grams: 100,
      alternatives: [],
    });
    const plan = validateAndBuildPlan({
      candidate,
      profile,
      targets,
      planId: "invalid-plan",
      version: 1,
    });
    expect(plan.validation.valid).toBe(false);
    expect(plan.validation.issues.join(" ")).toMatch(
      /not approved|Unknown catalog food/,
    );
  });

  it("rejects a meal that combines meat and dairy", () => {
    const profile = readyProfile();
    const targets = calculateTargets(profile);
    if (!targets) throw new Error("Expected targets");
    const candidate = validMaintenanceCandidate();
    candidate.meals[1].items.push({
      catalogFoodId: "greek-yogurt-nonfat",
      grams: 100,
      alternatives: [],
    });
    const plan = validateAndBuildPlan({
      candidate,
      profile,
      targets,
      planId: "mixed-plan",
      version: 1,
    });
    expect(plan.validation.valid).toBe(false);
    expect(plan.validation.issues).toContain(
      "Lunch cannot combine meat and dairy.",
    );
  });

  it("rejects an invalid alternative even when the default day passes", () => {
    const profile = readyProfile();
    const targets = calculateTargets(profile);
    if (!targets) throw new Error("Expected targets");
    const candidate = validMaintenanceCandidate();
    candidate.meals[1].items[0].alternatives = [
      { catalogFoodId: "greek-yogurt-nonfat", grams: 80 },
    ];
    const plan = validateAndBuildPlan({
      candidate,
      profile,
      targets,
      planId: "bad-alternative",
      version: 1,
    });
    expect(plan.validation.valid).toBe(false);
    expect(plan.validation.issues.join(" ")).toMatch(/Alternative.*invalid/);
  });

  it("keeps modifications as Drafts and revalidates the whole day", () => {
    const profile = readyProfile();
    const initial = buildValidDraft();
    const next = applyModificationToDraft({
      draft: initial,
      operation: {
        type: "change_portion",
        mealId: "lunch",
        itemId: "lunch-item-2",
        grams: 355,
        explanation: "A slightly larger rice portion.",
      },
      profile,
      proposalId: "proposal-2",
    });
    expect(next.reason).toBe("modification");
    expect(next.id).toBe("proposal-2");
    expect(next.plan.version).toBe(2);
    expect(next.plan.validation.valid).toBe(true);
    expect(initial.plan.meals[1].items[1].grams).toBe(350);
    expect(revalidatePlan(next.plan, profile).validation.valid).toBe(true);
  });
});
