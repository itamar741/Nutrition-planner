import type { NutrientAmounts } from "@/domain/catalog/types";
import type {
  Goal,
  MealPattern,
  NutritionTargets,
} from "@/domain/profile/types";

export type PlanMealId =
  | "breakfast"
  | "lunch"
  | "snack"
  | "dinner"
  | "meal_1"
  | "meal_2"
  | "meal_3"
  | "meal_4";

export interface PlanAlternative {
  id: string;
  catalogFoodId: string;
  grams: number;
}

export interface MealPlanItem {
  id: string;
  catalogFoodId: string;
  grams: number;
  alternatives: PlanAlternative[];
}

export interface PlanMeal {
  id: PlanMealId;
  name: string;
  items: MealPlanItem[];
}

export interface PlanValidationResult {
  valid: boolean;
  issues: string[];
  totals: NutrientAmounts;
  macroPercentages: {
    protein: number;
    carbohydrate: number;
    fat: number;
  };
}

export interface MealPlan {
  schemaVersion: 1;
  id: string;
  version: number;
  goal: Goal;
  mealPattern: MealPattern;
  targetSnapshot: NutritionTargets;
  meals: PlanMeal[];
  validation: PlanValidationResult;
}

export interface DraftProposal {
  schemaVersion: 1;
  id: string;
  basePlanVersion: number | null;
  reason: "initial" | "modification";
  summary: string;
  plan: MealPlan;
}

export interface ActivePlan {
  schemaVersion: 1;
  version: number;
  activatedAt: string;
  maintenanceReferenceWeightKg: number | null;
  plan: MealPlan;
}

export interface DraftCandidateItem {
  catalogFoodId: string;
  grams: number;
  alternatives: Array<{
    catalogFoodId: string;
    grams: number;
  }>;
}

export interface DraftCandidate {
  summary: string;
  meals: Array<{
    id: PlanMealId;
    items: DraftCandidateItem[];
  }>;
}

export interface ReplaceFoodOperation {
  type: "replace_food";
  mealId: PlanMealId;
  itemId: string;
  catalogFoodId: string;
  grams: number;
  explanation: string;
}

export interface ChangePortionOperation {
  type: "change_portion";
  mealId: PlanMealId;
  itemId: string;
  grams: number;
  explanation: string;
}

export interface UnsupportedModification {
  type: "unsupported";
  explanation: string;
}

export type DraftModificationOperation =
  ReplaceFoodOperation | ChangePortionOperation | UnsupportedModification;
