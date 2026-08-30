import { getNextTurn } from "@/domain/profile/onboarding";
import { calculateTargets } from "@/domain/nutrition/calculations";
import { validateAndBuildPlan } from "@/domain/plan/validation";
import type { ActivePlan, DraftCandidate } from "@/domain/plan/types";
import type { DemoProfileId, StructuredProfile } from "@/domain/profile/types";
import type { DemoState } from "@/store/demo-reducer";

export const demoProfileNames: Record<DemoProfileId, string> = {
  new: "New Demo Profile",
  existing: "Existing Demo Profile",
};

export const emptyProfile: StructuredProfile = {
  schemaVersion: 1,
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
  foodPreferencesComplete: false,
  approvedCatalogFoodIds: [],
};

export const existingProfileFoundation: StructuredProfile = {
  schemaVersion: 1,
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
  eatingRoutine: "Breakfast, lunch, afternoon snack, and dinner.",
  mealPattern: "three_meals_one_snack",
  foodPreferencesComplete: false,
  approvedCatalogFoodIds: [],
};

export const existingApprovedFoodIds = [
  "rolled-oats-dry",
  "white-rice-cooked",
  "sweet-potato-baked",
  "potato-baked",
  "pasta-cooked",
  "quinoa-cooked",
  "whole-wheat-pita",
  "chicken-breast-roasted",
  "salmon-atlantic-cooked",
  "tofu-firm",
  "greek-yogurt-nonfat",
  "olive-oil",
  "avocado-raw",
  "almonds-roasted",
  "walnuts-english",
  "tahini-raw",
  "peanut-butter-natural",
  "broccoli-raw",
  "carrots-raw",
  "spinach-raw",
  "red-bell-pepper-raw",
  "cucumber-raw",
  "tomato-raw",
  "banana-raw",
  "apple-fuji-raw",
  "blueberries-raw",
  "peach-raw",
  "strawberries-raw",
  "date-medjool",
  "pear-raw",
] as const;

export const existingReadyProfile: StructuredProfile = {
  ...existingProfileFoundation,
  foodPreferencesComplete: true,
  approvedCatalogFoodIds: [...existingApprovedFoodIds],
};

export const existingWeightHistory = Array.from({ length: 35 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 6, 27 + index));
  return {
    date: date.toISOString().slice(0, 10),
    weightKg: 80 + index * 0.0571428571,
  };
});

const existingCandidate: DraftCandidate = {
  summary: "A repeatable maintenance day built from the approved catalog.",
  meals: [
    {
      id: "breakfast",
      items: [
        { catalogFoodId: "rolled-oats-dry", grams: 100, alternatives: [] },
        { catalogFoodId: "greek-yogurt-nonfat", grams: 300, alternatives: [] },
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
        { catalogFoodId: "white-rice-cooked", grams: 350, alternatives: [] },
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
        { catalogFoodId: "white-rice-cooked", grams: 350, alternatives: [] },
        { catalogFoodId: "sweet-potato-baked", grams: 400, alternatives: [] },
        { catalogFoodId: "broccoli-raw", grams: 150, alternatives: [] },
        { catalogFoodId: "olive-oil", grams: 20, alternatives: [] },
      ],
    },
  ],
};

export function createExistingActivePlan(): ActivePlan {
  const targets = calculateTargets(existingReadyProfile);
  if (!targets) throw new Error("Existing fixture targets are incomplete");
  const plan = validateAndBuildPlan({
    candidate: existingCandidate,
    profile: existingReadyProfile,
    targets,
    planId: "existing-active-plan",
    version: 1,
  });
  if (!plan.validation.valid) throw new Error(plan.validation.issues.join(" "));
  return {
    schemaVersion: 1,
    version: 1,
    activatedAt: "2026-08-30T08:00:00.000Z",
    plan,
  };
}

export function createNewDemoState(): DemoState {
  const activeTurn = getNextTurn(emptyProfile);
  return {
    schemaVersion: 2,
    profileId: "new",
    profile: structuredClone(emptyProfile),
    messages: [
      {
        id: "new-welcome",
        role: "assistant",
        text: `Welcome. I’ll build this one step at a time. ${activeTurn.prompt}`,
      },
    ],
    activeTurn,
    targets: null,
    draft: null,
    activePlan: null,
    status: "idle",
    pendingCommand: null,
    pendingOperation: null,
    processedCommandIds: [],
    error: null,
  };
}
