export const PROFILE_SCHEMA_VERSION = 1 as const;

export type DemoProfileId = "new" | "existing";
export type Goal = "fat_loss" | "maintenance" | "muscle_gain";
export type EquationSex = "male" | "female";
export type DailyRoutine =
  "mostly_seated" | "mixed_or_on_feet" | "physically_demanding";
export type ExerciseType = "none" | "resistance" | "cardio" | "mixed";
export type ExerciseIntensity = "moderate" | "vigorous";
export type MealPattern =
  "three_meals" | "three_meals_one_snack" | "four_meals";

export interface StructuredProfile {
  schemaVersion: typeof PROFILE_SCHEMA_VERSION;
  age: number | null;
  equationSex: EquationSex | null;
  heightCm: number | null;
  currentWeightKg: number | null;
  goal: Goal | null;
  dailyRoutine: DailyRoutine | null;
  exerciseType: ExerciseType | null;
  exerciseFrequencyPerWeek: number | null;
  exerciseSessionMinutes: number | null;
  exerciseIntensity: ExerciseIntensity | null;
  eatingRoutine: string | null;
  mealPattern: MealPattern | null;
  foodPreferencesComplete: boolean;
  approvedCatalogFoodIds: string[];
}

export type ProfileFactKey = Exclude<
  keyof StructuredProfile,
  "schemaVersion" | "foodPreferencesComplete" | "approvedCatalogFoodIds"
>;

export interface ProfileFactPatch {
  age?: number;
  equationSex?: EquationSex;
  heightCm?: number;
  currentWeightKg?: number;
  goal?: Goal;
  dailyRoutine?: DailyRoutine;
  exerciseType?: ExerciseType;
  exerciseFrequencyPerWeek?: number;
  exerciseSessionMinutes?: number;
  exerciseIntensity?: ExerciseIntensity;
  eatingRoutine?: string;
  mealPattern?: MealPattern;
}

export type ChecklistKey =
  | "basics"
  | "goal"
  | "dailyRoutine"
  | "exercise"
  | "eatingRoutine"
  | "mealPattern"
  | "foodPreferences";

export interface ChecklistItem {
  key: ChecklistKey;
  label: string;
  complete: boolean;
}

export interface QuickReplyOption {
  id: string;
  label: string;
  patch: ProfileFactPatch;
}

export type AssistantTurn =
  | {
      type: "message";
      id: string;
      prompt: string;
    }
  | {
      type: "open_question";
      id: string;
      prompt: string;
      field: ProfileFactKey | "multiple";
    }
  | {
      type: "closed_question";
      id: string;
      prompt: string;
      field: ProfileFactKey;
      options: QuickReplyOption[];
    }
  | {
      type: "food_grid";
      id: string;
      prompt: string;
    };

export interface NutritionTargets {
  palCategory: "inactive" | "low_active" | "active" | "very_active";
  rawEerKcal: number;
  energyKcal: number;
  proteinTargetG: number;
  fatTargetG: number;
  carbohydrateTargetG: number;
  fiberMinimumG: number;
}
