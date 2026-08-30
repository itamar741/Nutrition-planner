import {
  foodCatalog,
  foodCatalogById,
  foodCategoryOrder,
} from "@/data/food-catalog";
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
    fiberG: food.nutrientsPer100g.fiberG * factor,
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

export function validateFoodSelections(ids: string[]): {
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
    const food = foodCatalogById.get(id);
    if (!food || !food.kosherCatalogApproved) {
      issues.push(`Unknown or unavailable catalog food: ${id}.`);
    }
  }

  for (const category of foodCategoryOrder) {
    const hasCategory = uniqueIds.some(
      (id) => foodCatalogById.get(id)?.category === category,
    );
    if (!hasCategory) {
      issues.push(`Select at least one food in ${category}.`);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    orderedIds: foodCatalog
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
  if (grams % food.practicalGrams.step !== 0) {
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

function nutritionIssues(
  totals: NutrientAmounts,
  profile: StructuredProfile,
  targets: NutritionTargets,
): string[] {
  if (profile.age === null || profile.currentWeightKg === null) {
    return ["A complete age and current weight are required."];
  }

  const issues: string[] = [];
  const percentages = macroPercentages(totals);
  const energyMinimum = targets.energyKcal * 0.95;
  const energyMaximum = targets.energyKcal * 1.05;
  const proteinMinimumMultiplier = profile.goal === "maintenance" ? 1.4 : 1.6;
  const proteinMinimum = proteinMinimumMultiplier * profile.currentWeightKg;
  const proteinMaximum = 2 * profile.currentWeightKg;
  const proteinPercentageMaximum = profile.age === 18 ? 30 : 35;
  const fatPercentageMinimum = profile.age === 18 ? 25 : 20;

  if (totals.energyKcal < energyMinimum || totals.energyKcal > energyMaximum) {
    issues.push(`Energy must be within ±5% of ${targets.energyKcal} kcal.`);
  }
  if (totals.proteinG < proteinMinimum || totals.proteinG > proteinMaximum) {
    issues.push(
      `Protein must be between ${proteinMinimum.toFixed(1)} g and ${proteinMaximum.toFixed(1)} g.`,
    );
  }
  if (
    percentages.protein < 10 ||
    percentages.protein > proteinPercentageMaximum
  ) {
    issues.push("Protein is outside the age-appropriate AMDR.");
  }
  if (percentages.carbohydrate < 45 || percentages.carbohydrate > 65) {
    issues.push("Carbohydrate is outside the 45–65% AMDR.");
  }
  if (percentages.fat < fatPercentageMinimum || percentages.fat > 35) {
    issues.push("Fat is outside the age-appropriate AMDR.");
  }
  if (totals.fiberG < targets.fiberMinimumG) {
    issues.push(
      `Fiber must be at least ${targets.fiberMinimumG.toFixed(1)} g.`,
    );
  }
  return issues;
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

function calculateMealTotals(meals: PlanMeal[]): NutrientAmounts {
  return meals.reduce((dayTotal, meal) => {
    const mealTotal = meal.items.reduce((itemTotal, item) => {
      const food = foodCatalogById.get(item.catalogFoodId);
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
}): MealPlan {
  const { candidate, profile, targets, planId, version } = input;
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
    const items = meal.items.map((item, itemIndex) => {
      const itemId = `${meal.id}-item-${itemIndex + 1}`;
      const food = foodCatalogById.get(item.catalogFoodId);
      if (!food || !food.kosherCatalogApproved) {
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
        const alternativeFood = foodCatalogById.get(alternative.catalogFoodId);
        if (!alternativeFood || !alternativeFood.kosherCatalogApproved) {
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

  const totals = calculateMealTotals(meals);
  const baseNutritionIssues = nutritionIssues(totals, profile, targets);
  const alternativeIssues: string[] = [];

  for (const meal of meals) {
    for (const item of meal.items) {
      const defaultFood = foodCatalogById.get(item.catalogFoodId);
      if (!defaultFood) continue;
      const defaultNutrients = calculatePortionNutrients(
        defaultFood,
        item.grams,
      );
      for (const alternative of item.alternatives) {
        const alternativeFood = foodCatalogById.get(alternative.catalogFoodId);
        if (!alternativeFood) continue;
        const variantTotals = addNutrients(
          subtractNutrients(totals, defaultNutrients),
          calculatePortionNutrients(alternativeFood, alternative.grams),
        );
        const otherMealFoods = meal.items
          .filter((candidateItem) => candidateItem.id !== item.id)
          .map((candidateItem) =>
            foodCatalogById.get(candidateItem.catalogFoodId),
          )
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

function isNutritionIssue(issue: string) {
  return (
    issue.startsWith("Energy must") ||
    issue.startsWith("Protein must") ||
    issue.startsWith("Protein is") ||
    issue.startsWith("Carbohydrate is") ||
    issue.startsWith("Fat is") ||
    issue.startsWith("Fiber must") ||
    issue.startsWith("Alternative ")
  );
}

/**
 * Repairs a structurally valid but under-filled model candidate using only
 * approved catalog foods. This is a bounded deterministic safety net after
 * the model and its single repair attempt both miss the nutrition targets.
 */
export function repairCandidateNutrition(input: {
  candidate: DraftCandidate;
  profile: StructuredProfile;
  targets: NutritionTargets;
}): DraftCandidate | null {
  const candidate: DraftCandidate = {
    summary: input.candidate.summary,
    meals: input.candidate.meals.map((meal) => ({
      id: meal.id,
      items: meal.items.map((item) => ({
        ...item,
        alternatives: [],
        grams: item.grams,
      })),
    })),
  };

  for (const meal of candidate.meals) {
    for (const item of meal.items) {
      const food = foodCatalogById.get(item.catalogFoodId);
      if (!food || !input.profile.approvedCatalogFoodIds.includes(food.id)) {
        return null;
      }
      const { min, max, step } = food.practicalGrams;
      const bounded = Math.min(max, Math.max(min, item.grams));
      item.grams = min + Math.floor((bounded - min) / step) * step;
    }
  }

  const planFor = () =>
    validateAndBuildPlan({
      candidate,
      profile: input.profile,
      targets: input.targets,
      planId: "deterministic-repair",
      version: 1,
    });

  for (let iteration = 0; iteration < 800; iteration += 1) {
    const plan = planFor();
    if (plan.validation.valid) return candidate;
    if (!plan.validation.issues.every(isNutritionIssue)) return null;

    const proteinMinimum =
      (input.profile.goal === "maintenance" ? 1.4 : 1.6) *
      (input.profile.currentWeightKg ?? 0);
    const energyLow =
      plan.validation.totals.energyKcal < input.targets.energyKcal * 0.95;
    const proteinLow = plan.validation.totals.proteinG < proteinMinimum;
    const fiberLow =
      plan.validation.totals.fiberG < input.targets.fiberMinimumG;
    const percentages = plan.validation.macroPercentages;
    const proteinHigh =
      percentages.protein > (input.profile.age === 18 ? 30 : 35);
    const carbohydrateLow = percentages.carbohydrate < 45;
    const carbohydrateHigh = percentages.carbohydrate > 65;
    const fatLow = percentages.fat < (input.profile.age === 18 ? 25 : 20);
    const fatHigh = percentages.fat > 35;

    const refs = candidate.meals.flatMap((meal) =>
      meal.items.flatMap((item) => {
        const food = foodCatalogById.get(item.catalogFoodId);
        return food ? [{ item, food }] : [];
      }),
    );
    const eligible = refs.filter(
      ({ item, food }) =>
        item.grams + food.practicalGrams.step <= food.practicalGrams.max,
    );
    if (eligible.length === 0) return null;

    let ranked = eligible;
    if (proteinLow) {
      ranked = [...eligible].sort(
        (left, right) =>
          right.food.nutrientsPer100g.proteinG -
          left.food.nutrientsPer100g.proteinG,
      );
    } else if (fiberLow) {
      ranked = [...eligible].sort(
        (left, right) =>
          right.food.nutrientsPer100g.fiberG -
          left.food.nutrientsPer100g.fiberG,
      );
    } else if (
      energyLow ||
      proteinHigh ||
      carbohydrateLow ||
      carbohydrateHigh ||
      fatLow ||
      fatHigh
    ) {
      const preferredCategory =
        fatLow || carbohydrateHigh
          ? "fat"
          : carbohydrateLow || fatHigh || proteinHigh
            ? "carbohydrate"
            : null;
      ranked = [...eligible].sort((left, right) => {
        const leftPreferred = preferredCategory === left.food.category ? 1 : 0;
        const rightPreferred =
          preferredCategory === right.food.category ? 1 : 0;
        if (leftPreferred !== rightPreferred)
          return rightPreferred - leftPreferred;
        return (
          right.food.nutrientsPer100g.energyKcal -
          left.food.nutrientsPer100g.energyKcal
        );
      });
    } else return null;

    const selected = ranked[0];
    selected.item.grams += selected.food.practicalGrams.step;
  }

  return null;
}

export function revalidatePlan(
  plan: MealPlan,
  profile: StructuredProfile,
): MealPlan {
  return validateAndBuildPlan({
    candidate: candidateFromPlan(plan),
    profile,
    targets: plan.targetSnapshot,
    planId: plan.id,
    version: plan.version,
  });
}

export function applyModificationToDraft(input: {
  draft: DraftProposal;
  operation: Exclude<DraftModificationOperation, { type: "unsupported" }>;
  profile: StructuredProfile;
  proposalId: string;
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
