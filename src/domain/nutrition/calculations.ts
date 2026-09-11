import type {
  DailyRoutine,
  ExerciseIntensity,
  ExerciseType,
  NutritionTargets,
  StructuredProfile,
} from "@/domain/profile/types";
import { isProfileReady } from "@/domain/profile/onboarding";

export type PalCategory = NutritionTargets["palCategory"];

export interface EerEquation {
  constant: number;
  ageFactor: number;
  heightFactor: number;
  weightFactor: number;
  growthAllowance: number;
}

const adolescentEerEquations = {
  male: {
    inactive: [-447.51, 3.68, 13.01, 13.15],
    low_active: [19.12, 3.68, 8.62, 20.28],
    active: [-388.19, 3.68, 12.66, 20.46],
    very_active: [-671.75, 3.68, 15.38, 23.25],
  },
  female: {
    inactive: [55.59, -22.25, 8.43, 17.07],
    low_active: [-297.54, -22.25, 12.77, 14.73],
    active: [-189.55, -22.25, 11.74, 18.34],
    very_active: [-709.59, -22.25, 18.22, 14.25],
  },
} as const;

const adultEerEquations = {
  male: {
    inactive: [753.07, -10.83, 6.5, 14.1],
    low_active: [581.47, -10.83, 8.3, 14.94],
    active: [1004.82, -10.83, 6.52, 15.91],
    very_active: [-517.88, -10.83, 15.61, 19.11],
  },
  female: {
    inactive: [584.9, -7.01, 5.72, 11.71],
    low_active: [575.77, -7.01, 6.6, 12.14],
    active: [710.25, -7.01, 6.54, 12.34],
    very_active: [511.83, -7.01, 9.07, 12.56],
  },
} as const;

export const GOAL_ENERGY_MULTIPLIERS = {
  fat_loss: 0.85,
  maintenance: 1,
  muscle_gain: 1.1,
} as const;

export const GOAL_PROTEIN_TARGET_MULTIPLIERS = {
  fat_loss: 1.8,
  maintenance: 1.6,
  muscle_gain: 1.6,
} as const;

export function roundTo25HalfUp(value: number): number {
  return Math.floor(value / 25 + 0.5) * 25;
}

export function getModerateEquivalentMinutes(input: {
  exerciseType: ExerciseType;
  frequencyPerWeek: number;
  sessionMinutes: number;
  intensity: ExerciseIntensity;
}): number {
  if (input.exerciseType === "none") return 0;

  const weeklyMinutes = input.frequencyPerWeek * input.sessionMinutes;

  if (input.exerciseType === "resistance") {
    return weeklyMinutes;
  }

  if (input.exerciseType === "cardio") {
    return weeklyMinutes * (input.intensity === "vigorous" ? 2 : 1);
  }

  const resistanceMinutes = weeklyMinutes / 2;
  const cardioMinutes = weeklyMinutes / 2;
  return (
    resistanceMinutes + cardioMinutes * (input.intensity === "vigorous" ? 2 : 1)
  );
}

export function getRoutineScore(dailyRoutine: DailyRoutine): number {
  return {
    mostly_seated: 0,
    mixed_or_on_feet: 1,
    physically_demanding: 2,
  }[dailyRoutine];
}

export function getExerciseScore(moderateEquivalentMinutes: number): number {
  return moderateEquivalentMinutes < 150
    ? 0
    : moderateEquivalentMinutes < 300
      ? 1
      : 2;
}

export function mapPalCategory(
  dailyRoutine: DailyRoutine,
  moderateEquivalentMinutes: number,
): PalCategory {
  const routineScore = getRoutineScore(dailyRoutine);
  const exerciseScore = getExerciseScore(moderateEquivalentMinutes);
  const score = routineScore + exerciseScore;

  if (score === 0) return "inactive";
  if (score === 1) return "low_active";
  if (score <= 3) return "active";
  return "very_active";
}

export function getEerEquation(input: {
  age: number;
  equationSex: "male" | "female";
  palCategory: PalCategory;
}): EerEquation {
  const { age, equationSex, palCategory } = input;
  const values =
    age < 19
      ? adolescentEerEquations[equationSex][palCategory]
      : adultEerEquations[equationSex][palCategory];
  const [constant, ageFactor, heightFactor, weightFactor] = values;
  return {
    constant,
    ageFactor,
    heightFactor,
    weightFactor,
    growthAllowance: age < 19 ? 20 : 0,
  };
}

export function calculateRawEer(input: {
  age: number;
  equationSex: "male" | "female";
  heightCm: number;
  weightKg: number;
  palCategory: PalCategory;
}): number {
  const {
    age,
    equationSex,
    heightCm: height,
    weightKg: weight,
    palCategory,
  } = input;

  if (age < 18 || age > 120 || height <= 0 || weight <= 0) {
    throw new Error("Valid adult EER inputs are required.");
  }

  const { constant, ageFactor, heightFactor, weightFactor, growthAllowance } =
    getEerEquation({ age, equationSex, palCategory });
  return (
    constant +
    ageFactor * age +
    heightFactor * height +
    weightFactor * weight +
    growthAllowance
  );
}

export function calculateTargets(
  profile: StructuredProfile,
): NutritionTargets | null {
  if (!isProfileReady(profile)) return null;

  const {
    age,
    equationSex,
    heightCm,
    currentWeightKg,
    goal,
    dailyRoutine,
    exerciseType,
    exerciseFrequencyPerWeek,
    exerciseSessionMinutes,
    exerciseIntensity,
  } = profile;

  if (
    age === null ||
    equationSex === null ||
    heightCm === null ||
    currentWeightKg === null ||
    goal === null ||
    dailyRoutine === null ||
    exerciseType === null ||
    exerciseFrequencyPerWeek === null ||
    exerciseSessionMinutes === null ||
    exerciseIntensity === null
  ) {
    return null;
  }

  const moderateEquivalentMinutes = getModerateEquivalentMinutes({
    exerciseType,
    frequencyPerWeek: exerciseFrequencyPerWeek,
    sessionMinutes: exerciseSessionMinutes,
    intensity: exerciseIntensity,
  });
  const palCategory = mapPalCategory(dailyRoutine, moderateEquivalentMinutes);
  const rawEerKcal = calculateRawEer({
    age,
    equationSex,
    heightCm,
    weightKg: currentWeightKg,
    palCategory,
  });
  const goalMultiplier = GOAL_ENERGY_MULTIPLIERS[goal];
  const energyKcal = roundTo25HalfUp(rawEerKcal * goalMultiplier);
  const proteinTargetG =
    GOAL_PROTEIN_TARGET_MULTIPLIERS[goal] * currentWeightKg;
  const fatTargetG = (0.25 * energyKcal) / 9;
  const carbohydrateTargetG =
    (energyKcal - proteinTargetG * 4 - fatTargetG * 9) / 4;
  const fiberMinimumG = (14 * energyKcal) / 1000;

  return {
    palCategory,
    rawEerKcal,
    energyKcal,
    proteinTargetG,
    fatTargetG,
    carbohydrateTargetG,
    fiberMinimumG,
  };
}
