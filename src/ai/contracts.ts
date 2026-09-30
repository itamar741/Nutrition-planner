import { z } from "zod";
import {
  dailyRoutineSchema,
  equationSexSchema,
  exerciseIntensitySchema,
  exerciseTypeSchema,
  goalSchema,
  mealPatternSchema,
} from "@/domain/profile/schemas";

export const onboardingRequestSchema = z
  .object({
    profileId: z.literal("new"),
    expectedVersion: z.number().int().positive(),
    commandId: z.string().min(8).max(100),
    message: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const modelFactExtractionSchema = z
  .object({
    facts: z
      .object({
        age: z.number().int().min(18).max(120).nullable(),
        equationSex: equationSexSchema.nullable(),
        heightCm: z.number().min(100).max(260).nullable(),
        currentWeightKg: z.number().min(30).max(400).nullable(),
        goal: goalSchema.nullable(),
        dailyRoutine: dailyRoutineSchema.nullable(),
        exerciseType: exerciseTypeSchema.nullable(),
        exerciseFrequencyPerWeek: z.number().int().min(0).max(14).nullable(),
        exerciseSessionMinutes: z.number().int().min(0).max(300).nullable(),
        exerciseIntensity: z
          .union([exerciseIntensitySchema, z.literal("none")])
          .nullable(),
        eatingRoutine: z.string().trim().min(2).max(500).nullable(),
        mealPattern: mealPatternSchema.nullable(),
      })
      .strict(),
    acknowledgement: z.string().trim().min(1).max(180),
  })
  .strict();

export const onboardingSuccessSchema = z
  .object({
    ok: z.literal(true),
    commandId: z.string(),
    profile: z
      .object({
        profileId: z.literal("new"),
        version: z.number().int().positive(),
        state: z.unknown(),
      })
      .strict(),
  })
  .strict();

export const onboardingFailureSchema = z
  .object({
    ok: z.literal(false),
    commandId: z.string().nullable(),
    code: z.enum(["invalid_request", "not_configured", "model_failure"]),
    message: z.string(),
  })
  .strict();

export type OnboardingRequest = z.infer<typeof onboardingRequestSchema>;
export type ModelFactExtraction = z.infer<typeof modelFactExtractionSchema>;
export type OnboardingSuccess = z.infer<typeof onboardingSuccessSchema>;
export type OnboardingFailure = z.infer<typeof onboardingFailureSchema>;

export const modelFactExtractionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["facts", "acknowledgement"],
  properties: {
    facts: {
      type: "object",
      additionalProperties: false,
      required: [
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
      ],
      properties: {
        age: { type: ["integer", "null"], minimum: 18, maximum: 120 },
        equationSex: {
          type: ["string", "null"],
          enum: ["male", "female", null],
        },
        heightCm: { type: ["number", "null"], minimum: 100, maximum: 260 },
        currentWeightKg: {
          type: ["number", "null"],
          minimum: 30,
          maximum: 400,
        },
        goal: {
          type: ["string", "null"],
          enum: ["fat_loss", "maintenance", "muscle_gain", null],
        },
        dailyRoutine: {
          type: ["string", "null"],
          enum: [
            "mostly_seated",
            "mixed_or_on_feet",
            "physically_demanding",
            null,
          ],
        },
        exerciseType: {
          type: ["string", "null"],
          enum: ["none", "resistance", "cardio", "mixed", null],
        },
        exerciseFrequencyPerWeek: {
          type: ["integer", "null"],
          minimum: 0,
          maximum: 14,
        },
        exerciseSessionMinutes: {
          type: ["integer", "null"],
          minimum: 0,
          maximum: 300,
        },
        exerciseIntensity: {
          type: ["string", "null"],
          enum: ["none", "moderate", "vigorous", null],
        },
        eatingRoutine: { type: ["string", "null"], maxLength: 500 },
        mealPattern: {
          type: ["string", "null"],
          enum: ["three_meals", "three_meals_one_snack", "four_meals", null],
        },
      },
    },
    acknowledgement: { type: "string", minLength: 1, maxLength: 180 },
  },
} as const;
