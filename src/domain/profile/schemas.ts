import { z } from "zod";

export const goalSchema = z.enum(["fat_loss", "maintenance", "muscle_gain"]);
export const equationSexSchema = z.enum(["male", "female"]);
export const dailyRoutineSchema = z.enum([
  "mostly_seated",
  "mixed_or_on_feet",
  "physically_demanding",
]);
export const exerciseTypeSchema = z.enum([
  "none",
  "resistance",
  "cardio",
  "mixed",
]);
export const exerciseIntensitySchema = z.enum(["moderate", "vigorous"]);
export const mealPatternSchema = z.enum([
  "three_meals",
  "three_meals_one_snack",
  "four_meals",
]);

export const structuredProfileSchema = z
  .object({
    schemaVersion: z.literal(1),
    age: z.number().int().min(18).max(120).nullable(),
    equationSex: equationSexSchema.nullable(),
    heightCm: z.number().min(100).max(260).nullable(),
    currentWeightKg: z.number().min(30).max(400).nullable(),
    goal: goalSchema.nullable(),
    dailyRoutine: dailyRoutineSchema.nullable(),
    exerciseType: exerciseTypeSchema.nullable(),
    exerciseFrequencyPerWeek: z.number().int().min(0).max(14).nullable(),
    exerciseSessionMinutes: z.number().int().min(0).max(300).nullable(),
    exerciseIntensity: exerciseIntensitySchema.nullable(),
    eatingRoutine: z.string().trim().min(2).max(500).nullable(),
    mealPattern: mealPatternSchema.nullable(),
    foodPreferencesComplete: z.boolean(),
    approvedCatalogFoodIds: z.array(z.string().min(1)).max(100),
  })
  .strict();

export const profileFactPatchSchema = z
  .object({
    age: z.number().int().min(18).max(120).optional(),
    equationSex: equationSexSchema.optional(),
    heightCm: z.number().min(100).max(260).optional(),
    currentWeightKg: z.number().min(30).max(400).optional(),
    goal: goalSchema.optional(),
    dailyRoutine: dailyRoutineSchema.optional(),
    exerciseType: exerciseTypeSchema.optional(),
    exerciseFrequencyPerWeek: z.number().int().min(0).max(14).optional(),
    exerciseSessionMinutes: z.number().int().min(0).max(300).optional(),
    exerciseIntensity: exerciseIntensitySchema.optional(),
    eatingRoutine: z.string().trim().min(2).max(500).optional(),
    mealPattern: mealPatternSchema.optional(),
  })
  .strict();

const quickReplyOptionSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    patch: profileFactPatchSchema,
  })
  .strict();

export const assistantTurnSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("message"),
      id: z.string().min(1),
      prompt: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("open_question"),
      id: z.string().min(1),
      prompt: z.string().min(1),
      field: z.union([
        z.literal("multiple"),
        z.enum([
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
        ]),
      ]),
    })
    .strict(),
  z
    .object({
      type: z.literal("closed_question"),
      id: z.string().min(1),
      prompt: z.string().min(1),
      field: z.enum([
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
      ]),
      options: z.array(quickReplyOptionSchema).min(1).max(6),
    })
    .strict(),
  z
    .object({
      type: z.literal("food_grid"),
      id: z.string().min(1),
      prompt: z.string().min(1),
    })
    .strict(),
]);

export const nutritionTargetsSchema = z
  .object({
    palCategory: z.enum(["inactive", "low_active", "active", "very_active"]),
    rawEerKcal: z.number(),
    energyKcal: z.number(),
    proteinTargetG: z.number(),
    fatTargetG: z.number(),
    carbohydrateTargetG: z.number(),
    fiberMinimumG: z.number(),
  })
  .strict();
