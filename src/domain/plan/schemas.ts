import { z } from "zod";
import { nutritionTargetsSchema } from "@/domain/profile/schemas";
import { goalSchema, mealPatternSchema } from "@/domain/profile/schemas";

export const planMealIdSchema = z.enum([
  "breakfast",
  "lunch",
  "snack",
  "dinner",
  "meal_1",
  "meal_2",
  "meal_3",
  "meal_4",
]);

const candidateAlternativeSchema = z
  .object({
    catalogFoodId: z.string().min(1).max(80),
    grams: z.number().int().positive().max(1_000),
  })
  .strict();

const candidateItemSchema = z
  .object({
    catalogFoodId: z.string().min(1).max(80),
    grams: z.number().int().positive().max(1_000),
    alternatives: z.array(candidateAlternativeSchema).max(2),
  })
  .strict();

export const draftCandidateSchema = z
  .object({
    summary: z.string().trim().min(1).max(240),
    meals: z
      .array(
        z
          .object({
            id: planMealIdSchema,
            items: z.array(candidateItemSchema).min(1).max(8),
          })
          .strict(),
      )
      .min(3)
      .max(4),
  })
  .strict();

const nutrientAmountsSchema = z
  .object({
    energyKcal: z.number().nonnegative(),
    proteinG: z.number().nonnegative(),
    carbohydrateG: z.number().nonnegative(),
    fatG: z.number().nonnegative(),
    fiberG: z.number().nonnegative(),
  })
  .strict();

const planValidationResultSchema = z
  .object({
    valid: z.boolean(),
    issues: z.array(z.string()),
    totals: nutrientAmountsSchema,
    macroPercentages: z
      .object({
        protein: z.number().nonnegative(),
        carbohydrate: z.number().nonnegative(),
        fat: z.number().nonnegative(),
      })
      .strict(),
  })
  .strict();

const planAlternativeSchema = candidateAlternativeSchema.extend({
  id: z.string().min(1),
});

const mealPlanItemSchema = z
  .object({
    id: z.string().min(1),
    catalogFoodId: z.string().min(1),
    grams: z.number().int().positive(),
    alternatives: z.array(planAlternativeSchema).max(2),
  })
  .strict();

export const mealPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    version: z.number().int().positive(),
    goal: goalSchema,
    mealPattern: mealPatternSchema,
    targetSnapshot: nutritionTargetsSchema,
    meals: z.array(
      z
        .object({
          id: planMealIdSchema,
          name: z.string().min(1),
          items: z.array(mealPlanItemSchema).min(1).max(8),
        })
        .strict(),
    ),
    validation: planValidationResultSchema,
  })
  .strict();

export const draftProposalSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    basePlanVersion: z.number().int().positive().nullable(),
    reason: z.enum(["initial", "modification"]),
    summary: z.string().min(1).max(240),
    plan: mealPlanSchema,
  })
  .strict();

export const activePlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    version: z.number().int().positive(),
    activatedAt: z.string().datetime(),
    plan: mealPlanSchema,
  })
  .strict();

export const draftModificationOperationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("replace_food"),
      mealId: planMealIdSchema,
      itemId: z.string().min(1),
      catalogFoodId: z.string().min(1),
      grams: z.number().int().positive().max(1_000),
      explanation: z.string().trim().min(1).max(240),
    })
    .strict(),
  z
    .object({
      type: z.literal("change_portion"),
      mealId: planMealIdSchema,
      itemId: z.string().min(1),
      grams: z.number().int().positive().max(1_000),
      explanation: z.string().trim().min(1).max(240),
    })
    .strict(),
  z
    .object({
      type: z.literal("unsupported"),
      explanation: z.string().trim().min(1).max(240),
    })
    .strict(),
]);

export { nutritionTargetsSchema };
