import { z } from "zod";

const sourceSchema = z.discriminatedUnion("provider", [
  z
    .object({
      provider: z.literal("USDA FoodData Central"),
      fdcId: z.number().int().positive(),
      dataset: z.enum(["Foundation Foods", "SR Legacy"]),
      release: z.string().min(1),
      retrievedAt: z.string().min(1),
      energyNutrient: z.enum(["Energy", "Energy (Atwater Specific Factors)"]),
    })
    .strict(),
  z
    .object({
      provider: z.literal("FoodsDictionary"),
      url: z.string().url(),
      retrievedAt: z.string().min(1),
    })
    .strict(),
  z
    .object({
      provider: z.literal("Fuder"),
      url: z.string().url(),
      retrievedAt: z.string().datetime(),
      verification: z.literal("fuder_verified"),
    })
    .strict(),
  z
    .object({
      provider: z.literal("AI estimate"),
      retrievedAt: z.string().datetime(),
      verification: z.literal("ai_estimate"),
      sourceUnavailableReason: z.string().min(1).max(300),
    })
    .strict(),
]);

export const catalogFoodSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1).max(100),
    displayName: z.string().trim().min(1).max(120),
    preparation: z.string().trim().min(1).max(120),
    brand: z.string().trim().min(1).max(80).optional(),
    category: z.enum(["carbohydrate", "protein", "fat", "vegetable", "fruit"]),
    mealClassification: z.enum(["neutral", "meat", "dairy"]),
    kosherCatalogApproved: z.boolean(),
    kosherReview: z.enum(["reviewed", "not_checked"]).optional(),
    source: sourceSchema,
    nutrientsPer100g: z
      .object({
        energyKcal: z.number().nonnegative().max(1_000),
        proteinG: z.number().nonnegative().max(100),
        carbohydrateG: z.number().nonnegative().max(100),
        fatG: z.number().nonnegative().max(100),
        fiberG: z.number().nonnegative().max(100).nullable(),
      })
      .strict(),
    displayPortion: z
      .object({
        label: z.string().min(1).max(80),
        grams: z.number().positive().max(1_000),
      })
      .strict(),
    practicalGrams: z
      .object({
        min: z.number().positive().max(1_000),
        max: z.number().positive().max(2_000),
        step: z.number().positive().max(100),
      })
      .strict(),
    runtimeApproval: z
      .object({
        approvedAt: z.string().datetime(),
        approvedByProfileId: z.enum(["new", "existing"]),
      })
      .strict()
      .optional(),
  })
  .strict();
