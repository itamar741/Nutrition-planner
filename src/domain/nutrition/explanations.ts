import {
  GOAL_ENERGY_MULTIPLIERS,
  GOAL_PROTEIN_TARGET_MULTIPLIERS,
  getEerEquation,
  getExerciseScore,
  getModerateEquivalentMinutes,
  getRoutineScore,
  roundTo25HalfUp,
} from "@/domain/nutrition/calculations";
import type {
  Goal,
  NutritionTargets,
  StructuredProfile,
} from "@/domain/profile/types";

export interface ExplanationSource {
  id: string;
  label: string;
  url: string;
}

export const NUTRITION_EXPLANATION_SOURCES = {
  eer: {
    id: "national-academies-eer",
    label: "National Academies · Dietary Reference Intakes for Energy, 2023",
    url: "https://www.ncbi.nlm.nih.gov/books/NBK591034/",
  },
  pal: {
    id: "national-academies-pal",
    label: "National Academies · Selecting a physical activity level",
    url: "https://www.ncbi.nlm.nih.gov/books/NBK591020/",
  },
  activity: {
    id: "physical-activity-guidelines",
    label: "Physical Activity Guidelines for Americans",
    url: "https://stacks.cdc.gov/view/cdc/121857",
  },
  protein: {
    id: "issn-protein",
    label: "ISSN · Protein intake and exercise",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5477153/",
  },
  fatLoss: {
    id: "issn-body-composition",
    label: "ISSN · Diets and body composition",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5470183/",
  },
  muscleGain: {
    id: "off-season-bodybuilding",
    label: "Iraki et al. · Off-season nutrition review",
    url: "https://pubmed.ncbi.nlm.nih.gov/31247944/",
  },
  macroRanges: {
    id: "national-academies-amdr",
    label: "National Academies · Macronutrient distribution ranges",
    url: "https://www.ncbi.nlm.nih.gov/books/NBK208874/",
  },
  fiber: {
    id: "dietary-fiber-dri",
    label: "Dietary fiber DRI summary",
    url: "https://pubmed.ncbi.nlm.nih.gov/18953766/",
  },
  weightEvidence: {
    id: "weight-evidence-window",
    label: "Hall and Chow · Evidence from longitudinal weight measurements",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC3127505/",
  },
  weightVariability: {
    id: "weight-day-variability",
    label: "Research on day-to-day body-weight variability",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10653631/",
  },
} as const satisfies Record<string, ExplanationSource>;

const goalLabels: Record<Goal, string> = {
  fat_loss: "Fat Loss",
  maintenance: "Maintenance",
  muscle_gain: "Muscle Gain",
};

const routineLabels: Record<
  NonNullable<StructuredProfile["dailyRoutine"]>,
  string
> = {
  mostly_seated: "mostly seated",
  mixed_or_on_feet: "mixed or on your feet",
  physically_demanding: "physically demanding",
};

const palLabels: Record<NutritionTargets["palCategory"], string> = {
  inactive: "Inactive",
  low_active: "Low active",
  active: "Active",
  very_active: "Very active",
};

export interface NutritionExplanation {
  goal: Goal;
  goalLabel: string;
  rawEerKcal: number;
  baseGoalTargetKcal: number;
  currentTargetKcal: number;
  approvedAdjustmentKcal: number;
  activity: {
    routineLabel: string;
    routineScore: number;
    moderateEquivalentMinutes: number;
    exerciseScore: number;
    totalScore: number;
    palCategory: NutritionTargets["palCategory"];
    palLabel: string;
  };
  energyFormula: string;
  goalFormula: string;
  goalAdjustmentPercent: number;
  nutrientTargets: Array<{
    key: "protein" | "carbohydrate" | "fat" | "fiber";
    label: string;
    value: number;
    minimum: boolean;
    formula: string;
  }>;
  adjustmentNote: string | null;
  energySources: ExplanationSource[];
  goalSources: ExplanationSource[];
  nutrientSources: ExplanationSource[];
}

function formatFormulaNumber(value: number, digits = 2) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    useGrouping: false,
  }).format(value);
}

function signedTerm(coefficient: number, value: number) {
  const sign = coefficient < 0 ? "−" : "+";
  return `${sign} (${formatFormulaNumber(Math.abs(coefficient))} × ${formatFormulaNumber(value)})`;
}

function goalSources(goal: Goal): ExplanationSource[] {
  if (goal === "fat_loss") {
    return [
      NUTRITION_EXPLANATION_SOURCES.fatLoss,
      NUTRITION_EXPLANATION_SOURCES.pal,
    ];
  }
  if (goal === "muscle_gain") {
    return [
      NUTRITION_EXPLANATION_SOURCES.muscleGain,
      NUTRITION_EXPLANATION_SOURCES.pal,
    ];
  }
  return [NUTRITION_EXPLANATION_SOURCES.pal];
}

export function buildNutritionExplanation(
  profile: StructuredProfile,
  targetSnapshot: NutritionTargets,
): NutritionExplanation | null {
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
  const routineScore = getRoutineScore(dailyRoutine);
  const exerciseScore = getExerciseScore(moderateEquivalentMinutes);
  const equation = getEerEquation({
    age,
    equationSex,
    palCategory: targetSnapshot.palCategory,
  });
  const growthTerm = equation.growthAllowance
    ? ` + ${formatFormulaNumber(equation.growthAllowance)}`
    : "";
  const energyFormula = `${formatFormulaNumber(equation.constant)} ${signedTerm(equation.ageFactor, age)} ${signedTerm(equation.heightFactor, heightCm)} ${signedTerm(equation.weightFactor, currentWeightKg)}${growthTerm} = ${formatFormulaNumber(targetSnapshot.rawEerKcal)} kcal/day`;
  const multiplier = GOAL_ENERGY_MULTIPLIERS[goal];
  const baseGoalTargetKcal = roundTo25HalfUp(
    targetSnapshot.rawEerKcal * multiplier,
  );
  const approvedAdjustmentKcal = targetSnapshot.energyKcal - baseGoalTargetKcal;
  const proteinMultiplier = GOAL_PROTEIN_TARGET_MULTIPLIERS[goal];
  const fatBasisKcal = (targetSnapshot.fatTargetG * 9) / 0.25;
  const fiberBasisKcal = (targetSnapshot.fiberMinimumG * 1000) / 14;

  return {
    goal,
    goalLabel: goalLabels[goal],
    rawEerKcal: targetSnapshot.rawEerKcal,
    baseGoalTargetKcal,
    currentTargetKcal: targetSnapshot.energyKcal,
    approvedAdjustmentKcal,
    activity: {
      routineLabel: routineLabels[dailyRoutine],
      routineScore,
      moderateEquivalentMinutes,
      exerciseScore,
      totalScore: routineScore + exerciseScore,
      palCategory: targetSnapshot.palCategory,
      palLabel: palLabels[targetSnapshot.palCategory],
    },
    energyFormula,
    goalFormula: `round to nearest 25 (${formatFormulaNumber(targetSnapshot.rawEerKcal)} × ${formatFormulaNumber(multiplier)}) = ${formatFormulaNumber(baseGoalTargetKcal)} kcal/day`,
    goalAdjustmentPercent: Math.round((multiplier - 1) * 100),
    nutrientTargets: [
      {
        key: "protein",
        label: "Protein",
        value: targetSnapshot.proteinTargetG,
        minimum: false,
        formula: `${formatFormulaNumber(proteinMultiplier)} g × ${formatFormulaNumber(currentWeightKg)} kg = ${formatFormulaNumber(targetSnapshot.proteinTargetG)} g/day`,
      },
      {
        key: "carbohydrate",
        label: "Carbohydrate",
        value: targetSnapshot.carbohydrateTargetG,
        minimum: false,
        formula: `(${formatFormulaNumber(targetSnapshot.energyKcal)} − protein kcal − planned fat kcal) ÷ 4 = ${formatFormulaNumber(targetSnapshot.carbohydrateTargetG)} g/day`,
      },
      {
        key: "fat",
        label: "Fat",
        value: targetSnapshot.fatTargetG,
        minimum: false,
        formula: `(25% × ${formatFormulaNumber(fatBasisKcal)} kcal) ÷ 9 = ${formatFormulaNumber(targetSnapshot.fatTargetG)} g/day`,
      },
      {
        key: "fiber",
        label: "Fiber minimum",
        value: targetSnapshot.fiberMinimumG,
        minimum: true,
        formula: `14 g × ${formatFormulaNumber(fiberBasisKcal)} kcal ÷ 1,000 = ${formatFormulaNumber(targetSnapshot.fiberMinimumG)} g/day`,
      },
    ],
    adjustmentNote:
      approvedAdjustmentKcal === 0
        ? null
        : `The Active Plan includes an approved ${approvedAdjustmentKcal > 0 ? "increase" : "decrease"} of ${formatFormulaNumber(Math.abs(approvedAdjustmentKcal))} kcal/day. Protein, fat, and fiber remain anchored to the approved baseline; carbohydrate absorbs the energy difference.`,
    energySources: [
      NUTRITION_EXPLANATION_SOURCES.eer,
      NUTRITION_EXPLANATION_SOURCES.pal,
      NUTRITION_EXPLANATION_SOURCES.activity,
    ],
    goalSources: goalSources(goal),
    nutrientSources: [
      NUTRITION_EXPLANATION_SOURCES.protein,
      NUTRITION_EXPLANATION_SOURCES.macroRanges,
      NUTRITION_EXPLANATION_SOURCES.fiber,
    ],
  };
}
