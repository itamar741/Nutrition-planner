import { getNextTurn } from "@/domain/profile/onboarding";
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
