import { foodCategoryOrder } from "@/data/food-catalog";
import {
  baselineCatalogSnapshot,
  type CatalogSnapshot,
} from "@/domain/catalog/snapshot";
import type { CatalogFood, NutrientAmounts } from "@/domain/catalog/types";
import type {
  MealPattern,
  NutritionTargets,
  StructuredProfile,
} from "@/domain/profile/types";
import type {
  DraftCandidate,
  DraftModificationOperation,
  DraftProposal,
  MealPlan,
  PlanMeal,
  PlanMealId,
  PlanValidationResult,
} from "./types";

const zeroNutrients = (): NutrientAmounts => ({
  energyKcal: 0,
  proteinG: 0,
  carbohydrateG: 0,
  fatG: 0,
  fiberG: 0,
});

const NUMERIC_TOLERANCE = 1e-9;

function isBelow(value: number, minimum: number) {
  return value < minimum - NUMERIC_TOLERANCE;
}

function isAbove(value: number, maximum: number) {
  return value > maximum + NUMERIC_TOLERANCE;
}

function isWithin(value: number, minimum: number, maximum: number) {
  return !isBelow(value, minimum) && !isAbove(value, maximum);
}

function isCatalogFoodAvailable(food: CatalogFood | undefined) {
  return Boolean(
    food && (food.kosherCatalogApproved || food.kosherReview === "not_checked"),
  );
}

const mealPatternIds: Record<MealPattern, PlanMealId[]> = {
  three_meals: ["breakfast", "lunch", "dinner"],
  three_meals_one_snack: ["breakfast", "lunch", "snack", "dinner"],
  four_meals: ["meal_1", "meal_2", "meal_3", "meal_4"],
};

const mealNames: Record<PlanMealId, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  snack: "Snack",
  dinner: "Dinner",
  meal_1: "Meal 1",
  meal_2: "Meal 2",
  meal_3: "Meal 3",
  meal_4: "Meal 4",
};

export function getExpectedMealIds(pattern: MealPattern): PlanMealId[] {
  return [...mealPatternIds[pattern]];
}

export function getMealName(id: PlanMealId): string {
  return mealNames[id];
}

export function calculatePortionNutrients(
  food: CatalogFood,
  grams: number,
): NutrientAmounts {
  const factor = grams / 100;
  return {
    energyKcal: food.nutrientsPer100g.energyKcal * factor,
    proteinG: food.nutrientsPer100g.proteinG * factor,
    carbohydrateG: food.nutrientsPer100g.carbohydrateG * factor,
    fatG: food.nutrientsPer100g.fatG * factor,
    fiberG: (food.nutrientsPer100g.fiberG ?? 0) * factor,
  };
}

function addNutrients(
  left: NutrientAmounts,
  right: NutrientAmounts,
): NutrientAmounts {
  return {
    energyKcal: left.energyKcal + right.energyKcal,
    proteinG: left.proteinG + right.proteinG,
    carbohydrateG: left.carbohydrateG + right.carbohydrateG,
    fatG: left.fatG + right.fatG,
    fiberG: left.fiberG + right.fiberG,
  };
}

function subtractNutrients(
  left: NutrientAmounts,
  right: NutrientAmounts,
): NutrientAmounts {
  return {
    energyKcal: left.energyKcal - right.energyKcal,
    proteinG: left.proteinG - right.proteinG,
    carbohydrateG: left.carbohydrateG - right.carbohydrateG,
    fatG: left.fatG - right.fatG,
    fiberG: left.fiberG - right.fiberG,
  };
}

export function validateFoodSelections(
  ids: string[],
  catalog: CatalogSnapshot = baselineCatalogSnapshot,
): {
  valid: boolean;
  issues: string[];
  orderedIds: string[];
} {
  const issues: string[] = [];
  const uniqueIds = [...new Set(ids)];

  if (uniqueIds.length !== ids.length) {
    issues.push("Food selections contain duplicate catalog IDs.");
  }

  for (const id of uniqueIds) {
    const food = catalog.byId.get(id);
    if (!food || !isCatalogFoodAvailable(food)) {
      issues.push(`Unknown or unavailable catalog food: ${id}.`);
    }
  }

  for (const category of foodCategoryOrder) {
    const hasCategory = uniqueIds.some(
      (id) => catalog.byId.get(id)?.category === category,
    );
    if (!hasCategory) {
      issues.push(`Select at least one food in ${category}.`);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    orderedIds: catalog.foods
      .filter((food) => uniqueIds.includes(food.id))
      .map((food) => food.id),
  };
}

function validatePortion(food: CatalogFood, grams: number): string[] {
  const issues: string[] = [];
  if (!Number.isInteger(grams) || !Number.isFinite(grams)) {
    issues.push(`${food.displayName} must use whole grams.`);
    return issues;
  }
  if (grams < food.practicalGrams.min || grams > food.practicalGrams.max) {
    issues.push(
      `${food.displayName} must be between ${food.practicalGrams.min} g and ${food.practicalGrams.max} g.`,
    );
  }
  if ((grams - food.practicalGrams.min) % food.practicalGrams.step !== 0) {
    issues.push(
      `${food.displayName} must use ${food.practicalGrams.step} g steps.`,
    );
  }
  return issues;
}

function macroPercentages(totals: NutrientAmounts) {
  const proteinEnergy = totals.proteinG * 4;
  const carbohydrateEnergy = totals.carbohydrateG * 4;
  const fatEnergy = totals.fatG * 9;
  const macroEnergy = proteinEnergy + carbohydrateEnergy + fatEnergy;
  if (macroEnergy <= 0) return { protein: 0, carbohydrate: 0, fat: 0 };
  return {
    protein: (proteinEnergy / macroEnergy) * 100,
    carbohydrate: (carbohydrateEnergy / macroEnergy) * 100,
    fat: (fatEnergy / macroEnergy) * 100,
  };
}

export interface PlanNutritionRanges {
  energyKcal: { minimum: number; maximum: number };
  proteinG: { minimum: number; maximum: number };
  proteinPercent: { minimum: number; maximum: number };
  carbohydratePercent: { minimum: number; maximum: number };
  fatPercent: { minimum: number; maximum: number };
  fiberMinimumG: number;
}

export function getPlanNutritionRanges(
  profile: StructuredProfile,
  targets: NutritionTargets,
): PlanNutritionRanges | null {
  if (profile.age === null || profile.currentWeightKg === null) return null;
  const proteinMinimumMultiplier = profile.goal === "maintenance" ? 1.4 : 1.6;
  return {
    energyKcal: {
      minimum: targets.energyKcal * 0.95,
      maximum: targets.energyKcal * 1.05,
    },
    proteinG: {
      minimum: proteinMinimumMultiplier * profile.currentWeightKg,
      maximum: 2 * profile.currentWeightKg,
    },
    proteinPercent: { minimum: 10, maximum: profile.age === 18 ? 30 : 35 },
    carbohydratePercent: { minimum: 45, maximum: 65 },
    fatPercent: { minimum: profile.age === 18 ? 25 : 20, maximum: 35 },
    fiberMinimumG: targets.fiberMinimumG,
  };
}

function nutritionIssues(
  totals: NutrientAmounts,
  profile: StructuredProfile,
  targets: NutritionTargets,
): string[] {
  const ranges = getPlanNutritionRanges(profile, targets);
  if (!ranges) {
    return ["A complete age and current weight are required."];
  }

  const issues: string[] = [];
  const percentages = macroPercentages(totals);

  if (
    !isWithin(
      totals.energyKcal,
      ranges.energyKcal.minimum,
      ranges.energyKcal.maximum,
    )
  ) {
    issues.push(`Energy must be within ±5% of ${targets.energyKcal} kcal.`);
  }
  if (
    !isWithin(totals.proteinG, ranges.proteinG.minimum, ranges.proteinG.maximum)
  ) {
    issues.push(
      `Protein must be between ${ranges.proteinG.minimum.toFixed(1)} g and ${ranges.proteinG.maximum.toFixed(1)} g.`,
    );
  }
  if (
    !isWithin(
      percentages.protein,
      ranges.proteinPercent.minimum,
      ranges.proteinPercent.maximum,
    )
  ) {
    issues.push("Protein is outside the age-appropriate AMDR.");
  }
  if (
    !isWithin(
      percentages.carbohydrate,
      ranges.carbohydratePercent.minimum,
      ranges.carbohydratePercent.maximum,
    )
  ) {
    issues.push("Carbohydrate is outside the 45–65% AMDR.");
  }
  if (
    !isWithin(
      percentages.fat,
      ranges.fatPercent.minimum,
      ranges.fatPercent.maximum,
    )
  ) {
    issues.push("Fat is outside the age-appropriate AMDR.");
  }
  if (isBelow(totals.fiberG, ranges.fiberMinimumG)) {
    issues.push(`Fiber must be at least ${ranges.fiberMinimumG.toFixed(1)} g.`);
  }
  return issues;
}

export interface PlanValidationExplanationCheck {
  key: "energy" | "protein" | "macros" | "fiber" | "plan_rules";
  label: string;
  actual: string;
  expected: string;
  passed: boolean;
}

function isDirectNutritionIssue(issue: string) {
  return [
    "Energy must ",
    "Protein must ",
    "Protein is outside ",
    "Carbohydrate is outside ",
    "Fat is outside ",
    "Fiber must ",
  ].some((prefix) => issue.startsWith(prefix));
}

export function buildPlanValidationExplanation(
  profile: StructuredProfile,
  plan: MealPlan,
): PlanValidationExplanationCheck[] {
  const ranges = getPlanNutritionRanges(profile, plan.targetSnapshot);
  if (!ranges) return [];
  const { totals, macroPercentages: percentages } = plan.validation;
  const energyPassed = isWithin(
    totals.energyKcal,
    ranges.energyKcal.minimum,
    ranges.energyKcal.maximum,
  );
  const proteinPassed =
    isWithin(
      totals.proteinG,
      ranges.proteinG.minimum,
      ranges.proteinG.maximum,
    ) &&
    isWithin(
      percentages.protein,
      ranges.proteinPercent.minimum,
      ranges.proteinPercent.maximum,
    );
  const macrosPassed =
    isWithin(
      percentages.carbohydrate,
      ranges.carbohydratePercent.minimum,
      ranges.carbohydratePercent.maximum,
    ) &&
    isWithin(
      percentages.fat,
      ranges.fatPercent.minimum,
      ranges.fatPercent.maximum,
    );
  const planRulesPassed = plan.validation.issues
    .map((issue) => issue.trim())
    .filter(Boolean)
    .every(isDirectNutritionIssue);

  return [
    {
      key: "energy",
      label: "Energy",
      actual: `${totals.energyKcal.toFixed(0)} kcal`,
      expected: `${ranges.energyKcal.minimum.toFixed(0)}–${ranges.energyKcal.maximum.toFixed(0)} kcal (±5%)`,
      passed: energyPassed,
    },
    {
      key: "protein",
      label: "Protein",
      actual: `${totals.proteinG.toFixed(1)} g · ${percentages.protein.toFixed(1)}%`,
      expected: `${ranges.proteinG.minimum.toFixed(1)}–${ranges.proteinG.maximum.toFixed(1)} g and ${ranges.proteinPercent.minimum}–${ranges.proteinPercent.maximum}%`,
      passed: proteinPassed,
    },
    {
      key: "macros",
      label: "Carbohydrate & fat",
      actual: `${percentages.carbohydrate.toFixed(1)}% carbohydrate · ${percentages.fat.toFixed(1)}% fat`,
      expected: `${ranges.carbohydratePercent.minimum}–${ranges.carbohydratePercent.maximum}% carbohydrate · ${ranges.fatPercent.minimum}–${ranges.fatPercent.maximum}% fat`,
      passed: macrosPassed,
    },
    {
      key: "fiber",
      label: "Fiber",
      actual: `${totals.fiberG.toFixed(1)} g`,
      expected: `At least ${ranges.fiberMinimumG.toFixed(1)} g`,
      passed: !isBelow(totals.fiberG, ranges.fiberMinimumG),
    },
    {
      key: "plan_rules",
      label: "Plan rules",
      actual: planRulesPassed ? "All passed" : "Needs revision",
      expected:
        "Approved foods, practical portions, meal pattern and composition",
      passed: planRulesPassed,
    },
  ];
}

function mealCompositionIssues(
  mealId: PlanMealId,
  foods: CatalogFood[],
): string[] {
  const classes = new Set(foods.map((food) => food.mealClassification));
  return classes.has("meat") && classes.has("dairy")
    ? [`${getMealName(mealId)} cannot combine meat and dairy.`]
    : [];
}

function calculateMealTotals(
  meals: PlanMeal[],
  catalog: CatalogSnapshot,
): NutrientAmounts {
  return meals.reduce((dayTotal, meal) => {
    const mealTotal = meal.items.reduce((itemTotal, item) => {
      const food = catalog.byId.get(item.catalogFoodId);
      return food
        ? addNutrients(itemTotal, calculatePortionNutrients(food, item.grams))
        : itemTotal;
    }, zeroNutrients());
    return addNutrients(dayTotal, mealTotal);
  }, zeroNutrients());
}

export function validateAndBuildPlan(input: {
  candidate: DraftCandidate;
  profile: StructuredProfile;
  targets: NutritionTargets;
  planId: string;
  version: number;
  catalog?: CatalogSnapshot;
}): MealPlan {
  const {
    candidate,
    profile,
    targets,
    planId,
    version,
    catalog = baselineCatalogSnapshot,
  } = input;
  const structuralIssues: string[] = [];
  const allowedIds = new Set(profile.approvedCatalogFoodIds);
  const expectedIds = profile.mealPattern
    ? getExpectedMealIds(profile.mealPattern)
    : [];
  const candidateIds = candidate.meals.map((meal) => meal.id);

  if (!profile.goal || !profile.mealPattern) {
    structuralIssues.push("A complete goal and meal pattern are required.");
  }
  if (
    candidateIds.length !== expectedIds.length ||
    candidateIds.some((id, index) => id !== expectedIds[index])
  ) {
    structuralIssues.push(
      "The Draft does not match the accepted meal pattern.",
    );
  }
  if (new Set(candidateIds).size !== candidateIds.length) {
    structuralIssues.push("The Draft contains duplicate meals.");
  }

  const meals: PlanMeal[] = candidate.meals.map((meal) => {
    const resolvedFoods: CatalogFood[] = [];
    const itemFoodIds = meal.items.map((item) => item.catalogFoodId);
    if (new Set(itemFoodIds).size !== itemFoodIds.length) {
      structuralIssues.push(
        `${getMealName(meal.id)} contains the same food more than once.`,
      );
    }
    const items = meal.items.map((item, itemIndex) => {
      const itemId = `${meal.id}-item-${itemIndex + 1}`;
      const food = catalog.byId.get(item.catalogFoodId);
      if (!food || !isCatalogFoodAvailable(food)) {
        structuralIssues.push(`Unknown catalog food: ${item.catalogFoodId}.`);
      } else {
        resolvedFoods.push(food);
        if (!allowedIds.has(food.id)) {
          structuralIssues.push(
            `${food.displayName} was not approved in the Food Grid.`,
          );
        }
        structuralIssues.push(...validatePortion(food, item.grams));
      }

      const seenAlternativeIds = new Set<string>();
      const alternatives = item.alternatives.map((alternative, index) => {
        const alternativeFood = catalog.byId.get(alternative.catalogFoodId);
        if (!alternativeFood || !isCatalogFoodAvailable(alternativeFood)) {
          structuralIssues.push(
            `Unknown catalog alternative: ${alternative.catalogFoodId}.`,
          );
        } else {
          if (!allowedIds.has(alternativeFood.id)) {
            structuralIssues.push(
              `${alternativeFood.displayName} was not approved in the Food Grid.`,
            );
          }
          if (alternativeFood.id === item.catalogFoodId) {
            structuralIssues.push(
              "An alternative must differ from the default food.",
            );
          }
          if (seenAlternativeIds.has(alternativeFood.id)) {
            structuralIssues.push("Alternative foods must be unique.");
          }
          seenAlternativeIds.add(alternativeFood.id);
          structuralIssues.push(
            ...validatePortion(alternativeFood, alternative.grams),
          );
        }
        return {
          id: `${itemId}-alternative-${index + 1}`,
          catalogFoodId: alternative.catalogFoodId,
          grams: alternative.grams,
        };
      });

      return {
        id: itemId,
        catalogFoodId: item.catalogFoodId,
        grams: item.grams,
        alternatives,
      };
    });

    structuralIssues.push(...mealCompositionIssues(meal.id, resolvedFoods));
    return {
      id: meal.id,
      name: getMealName(meal.id),
      items,
    };
  });

  const totals = calculateMealTotals(meals, catalog);
  const baseNutritionIssues = nutritionIssues(totals, profile, targets);
  const alternativeIssues: string[] = [];

  for (const meal of meals) {
    for (const item of meal.items) {
      const defaultFood = catalog.byId.get(item.catalogFoodId);
      if (!defaultFood) continue;
      const defaultNutrients = calculatePortionNutrients(
        defaultFood,
        item.grams,
      );
      for (const alternative of item.alternatives) {
        const alternativeFood = catalog.byId.get(alternative.catalogFoodId);
        if (!alternativeFood) continue;
        const variantTotals = addNutrients(
          subtractNutrients(totals, defaultNutrients),
          calculatePortionNutrients(alternativeFood, alternative.grams),
        );
        const otherMealFoods = meal.items
          .filter((candidateItem) => candidateItem.id !== item.id)
          .map((candidateItem) => catalog.byId.get(candidateItem.catalogFoodId))
          .filter((food): food is CatalogFood => Boolean(food));
        const variantIssues = [
          ...mealCompositionIssues(meal.id, [
            ...otherMealFoods,
            alternativeFood,
          ]),
          ...nutritionIssues(variantTotals, profile, targets),
        ];
        if (variantIssues.length > 0) {
          alternativeIssues.push(
            `Alternative ${alternativeFood.displayName} for ${getMealName(meal.id)} is invalid: ${variantIssues.join(" ")}`,
          );
        }
      }
    }
  }

  const issues = [
    ...structuralIssues,
    ...baseNutritionIssues,
    ...alternativeIssues,
  ];
  const validation: PlanValidationResult = {
    valid: issues.length === 0,
    issues,
    totals,
    macroPercentages: macroPercentages(totals),
  };

  return {
    schemaVersion: 1,
    id: planId,
    version,
    goal: profile.goal ?? "maintenance",
    mealPattern: profile.mealPattern ?? "three_meals",
    targetSnapshot: targets,
    meals,
    validation,
  };
}

export function candidateFromPlan(plan: MealPlan): DraftCandidate {
  return {
    summary: "Revalidated plan",
    meals: plan.meals.map((meal) => ({
      id: meal.id,
      items: meal.items.map((item) => ({
        catalogFoodId: item.catalogFoodId,
        grams: item.grams,
        alternatives: item.alternatives.map((alternative) => ({
          catalogFoodId: alternative.catalogFoodId,
          grams: alternative.grams,
        })),
      })),
    })),
  };
}

export function revalidatePlan(
  plan: MealPlan,
  profile: StructuredProfile,
  catalog: CatalogSnapshot = baselineCatalogSnapshot,
): MealPlan {
  return validateAndBuildPlan({
    candidate: candidateFromPlan(plan),
    profile,
    targets: plan.targetSnapshot,
    planId: plan.id,
    version: plan.version,
    catalog,
  });
}

export function applyModificationToDraft(input: {
  draft: DraftProposal;
  operation: Exclude<DraftModificationOperation, { type: "unsupported" }>;
  profile: StructuredProfile;
  proposalId: string;
  catalog?: CatalogSnapshot;
}): DraftProposal {
  const { draft, operation, profile, proposalId } = input;
  const candidate = candidateFromPlan(draft.plan);
  const meal = candidate.meals.find((entry) => entry.id === operation.mealId);
  const storedMeal = draft.plan.meals.find(
    (entry) => entry.id === operation.mealId,
  );
  const itemIndex = storedMeal?.items.findIndex(
    (item) => item.id === operation.itemId,
  );
  if (!meal || !storedMeal || itemIndex === undefined || itemIndex < 0) {
    throw new Error("The requested Draft item no longer exists.");
  }

  if (operation.type === "replace_food") {
    meal.items[itemIndex] = {
      catalogFoodId: operation.catalogFoodId,
      grams: operation.grams,
      alternatives: [],
    };
  } else {
    meal.items[itemIndex] = {
      ...meal.items[itemIndex],
      grams: operation.grams,
    };
  }

  const plan = validateAndBuildPlan({
    candidate,
    profile,
    targets: draft.plan.targetSnapshot,
    planId: `${draft.plan.id}-v${draft.plan.version + 1}`,
    version: draft.plan.version + 1,
    catalog: input.catalog,
  });
  return {
    schemaVersion: 1,
    id: proposalId,
    basePlanVersion: draft.basePlanVersion,
    reason: "modification",
    summary: operation.explanation,
    plan,
  };
}
