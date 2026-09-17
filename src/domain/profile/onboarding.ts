import { profileFactPatchSchema, structuredProfileSchema } from "./schemas";
import type {
  AssistantTurn,
  ChecklistItem,
  ProfileFactKey,
  ProfileFactPatch,
  StructuredProfile,
} from "./types";

const requiredFactKeys: ProfileFactKey[] = [
  "age",
  "equationSex",
  "heightCm",
  "currentWeightKg",
  "goal",
  "dailyRoutine",
  "exerciseType",
  "exerciseFrequencyPerWeek",
  "exerciseSessionMinutes",
  "exerciseIntensity",
  "eatingRoutine",
  "mealPattern",
];

export function getOnboardingFactKeys(): ProfileFactKey[] {
  return [...requiredFactKeys];
}

const basicsKeys: ProfileFactKey[] = [
  "age",
  "equationSex",
  "heightCm",
  "currentWeightKg",
];

const exerciseKeys: ProfileFactKey[] = [
  "exerciseType",
  "exerciseFrequencyPerWeek",
  "exerciseSessionMinutes",
  "exerciseIntensity",
];

function allPresent(profile: StructuredProfile, keys: ProfileFactKey[]) {
  return keys.every((key) => profile[key] !== null);
}

export function getChecklist(profile: StructuredProfile): ChecklistItem[] {
  return [
    {
      key: "basics",
      label: "Body basics",
      complete: allPresent(profile, basicsKeys),
    },
    { key: "goal", label: "Nutrition goal", complete: profile.goal !== null },
    {
      key: "dailyRoutine",
      label: "Daily movement",
      complete: profile.dailyRoutine !== null,
    },
    {
      key: "exercise",
      label: "Exercise routine",
      complete: allPresent(profile, exerciseKeys),
    },
    {
      key: "eatingRoutine",
      label: "Eating routine",
      complete: profile.eatingRoutine !== null,
    },
    {
      key: "mealPattern",
      label: "Meal pattern",
      complete: profile.mealPattern !== null,
    },
    {
      key: "foodPreferences",
      label: "Food preferences",
      complete: profile.foodPreferencesComplete,
    },
  ];
}

export function getMissingFactKeys(
  profile: StructuredProfile,
): ProfileFactKey[] {
  return requiredFactKeys.filter((key) => profile[key] === null);
}

export function isProfileReady(profile: StructuredProfile): boolean {
  return (
    getMissingFactKeys(profile).length === 0 && profile.foodPreferencesComplete
  );
}

export function applyFactPatch(
  profile: StructuredProfile,
  patch: ProfileFactPatch,
  allowedKeys: ProfileFactKey[] = getMissingFactKeys(profile),
): StructuredProfile {
  const validatedPatch = profileFactPatchSchema.parse(patch);
  const allowed = new Set(allowedKeys);
  const next = { ...profile };

  for (const [key, value] of Object.entries(validatedPatch) as [
    ProfileFactKey,
    StructuredProfile[ProfileFactKey],
  ][]) {
    if (allowed.has(key) && profile[key] === null) {
      Object.assign(next, { [key]: value });
    }
  }

  return structuredProfileSchema.parse(next);
}

export function applyOnboardingFactPatch(
  profile: StructuredProfile,
  patch: ProfileFactPatch,
): StructuredProfile {
  const validatedPatch = profileFactPatchSchema.parse(patch);
  const next = { ...profile };

  for (const [key, value] of Object.entries(validatedPatch) as [
    ProfileFactKey,
    StructuredProfile[ProfileFactKey],
  ][]) {
    if (requiredFactKeys.includes(key)) Object.assign(next, { [key]: value });
  }

  return structuredProfileSchema.parse(next);
}

function readableMissingBasics(profile: StructuredProfile) {
  const labels: Partial<Record<ProfileFactKey, string>> = {
    age: "age",
    equationSex: "male or female for the energy equation",
    heightCm: "height in centimeters",
    currentWeightKg: "current weight in kilograms",
  };

  return basicsKeys
    .filter((key) => profile[key] === null)
    .map((key) => labels[key])
    .join(", ");
}

export function getNextTurn(profile: StructuredProfile): AssistantTurn {
  if (!allPresent(profile, basicsKeys)) {
    return {
      type: "open_question",
      id: "collect-basics",
      field: "multiple",
      prompt: `Let's start with the basics. Tell me your ${readableMissingBasics(profile)}. You can include everything in one message.`,
    };
  }

  if (profile.goal === null) {
    return {
      type: "closed_question",
      id: "choose-goal",
      field: "goal",
      prompt: "Which nutrition goal should this fixed plan support?",
      options: [
        { id: "goal-fat-loss", label: "Fat Loss", patch: { goal: "fat_loss" } },
        {
          id: "goal-maintenance",
          label: "Maintenance",
          patch: { goal: "maintenance" },
        },
        {
          id: "goal-muscle-gain",
          label: "Muscle Gain",
          patch: { goal: "muscle_gain" },
        },
      ],
    };
  }

  if (profile.dailyRoutine === null) {
    return {
      type: "closed_question",
      id: "choose-routine",
      field: "dailyRoutine",
      prompt: "What best describes your usual day outside exercise?",
      options: [
        {
          id: "routine-seated",
          label: "Mostly seated",
          patch: { dailyRoutine: "mostly_seated" },
        },
        {
          id: "routine-mixed",
          label: "Mixed / on my feet",
          patch: { dailyRoutine: "mixed_or_on_feet" },
        },
        {
          id: "routine-demanding",
          label: "Physically demanding",
          patch: { dailyRoutine: "physically_demanding" },
        },
      ],
    };
  }

  if (!allPresent(profile, exerciseKeys)) {
    return {
      type: "open_question",
      id: "collect-exercise",
      field: "multiple",
      prompt:
        "Describe your exercise: resistance, cardio, or mixed; sessions per week; minutes per session; and whether the effort is moderate or vigorous. If you do not exercise, say no exercise.",
    };
  }

  if (profile.eatingRoutine === null) {
    return {
      type: "open_question",
      id: "collect-eating-routine",
      field: "eatingRoutine",
      prompt:
        "Walk me through when you normally eat on a typical day. A short description is enough.",
    };
  }

  if (profile.mealPattern === null) {
    return {
      type: "closed_question",
      id: "choose-meal-pattern",
      field: "mealPattern",
      prompt: "Which repeatable daily meal pattern feels most practical?",
      options: [
        {
          id: "pattern-three-snack",
          label: "3 meals + 1 snack",
          patch: { mealPattern: "three_meals_one_snack" },
        },
        {
          id: "pattern-three",
          label: "3 meals",
          patch: { mealPattern: "three_meals" },
        },
        {
          id: "pattern-four",
          label: "4 meals",
          patch: { mealPattern: "four_meals" },
        },
      ],
    };
  }

  if (!profile.foodPreferencesComplete) {
    return {
      type: "food_grid",
      id: "select-foods",
      prompt:
        "Your profile details are complete. Food selection is the next dedicated step.",
    };
  }

  return {
    type: "message",
    id: "profile-ready",
    prompt: "Your nutrition profile is ready for target calculation.",
  };
}
