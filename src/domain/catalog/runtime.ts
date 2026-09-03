import { z } from "zod";
import type { CatalogFood } from "./types";

export const foodPreparationSchema = z.enum(["cooked", "raw", "packaged"]);

export const foodLookupToolArgumentsSchema = z
  .object({
    normalizedEnglishQuery: z
      .string()
      .trim()
      .min(2)
      .max(120)
      .regex(/^[A-Za-z0-9\s,'()\-/]+$/),
    preparation: foodPreparationSchema,
  })
  .strict();

export type FoodLookupToolArguments = z.infer<
  typeof foodLookupToolArgumentsSchema
>;

export const foodSearchCandidateSchema = z
  .object({
    id: z.string().uuid(),
    fdcId: z.number().int().positive(),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(300),
    dataType: z.enum(["Foundation", "SR Legacy"]),
    verification: z.enum(["detail", "search_summary"]),
    release: z.string().trim().min(1).max(80),
    retrievedAt: z.string().datetime(),
    energyNutrientId: z.union([
      z.literal(1008),
      z.literal(2047),
      z.literal(2048),
    ]),
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
        label: z.string().trim().min(1).max(80),
        grams: z.number().positive().max(1_000),
      })
      .strict(),
  })
  .strict();

export type FoodSearchCandidate = z.infer<typeof foodSearchCandidateSchema>;

export const foodLookupContextSchema = z.enum([
  "general",
  "onboarding",
  "draft_creation",
  "draft_modification",
  "adjustment",
]);

export type FoodLookupContext = z.infer<typeof foodLookupContextSchema>;

export interface FoodApprovalCandidate {
  id: string;
  lookupId: string;
  food: CatalogFood;
  sourceLabel:
    | "USDA FoodData Central verified"
    | "USDA FoodData Central search data"
    | "AI estimate · USDA not verified";
}

export const catalogFoodJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "displayName",
    "preparation",
    "category",
    "mealClassification",
    "displayPortionLabel",
    "displayPortionGrams",
    "energyKcal",
    "proteinG",
    "carbohydrateG",
    "fatG",
    "fiberG",
  ],
  properties: {
    displayName: { type: "string", minLength: 1, maxLength: 120 },
    preparation: { type: "string", minLength: 1, maxLength: 120 },
    category: {
      type: "string",
      enum: ["carbohydrate", "protein", "fat", "vegetable", "fruit"],
    },
    mealClassification: {
      type: "string",
      enum: ["neutral", "meat", "dairy"],
    },
    displayPortionLabel: { type: "string", minLength: 1, maxLength: 80 },
    displayPortionGrams: { type: "number", exclusiveMinimum: 0, maximum: 1000 },
    energyKcal: { type: "number", minimum: 0, maximum: 1000 },
    proteinG: { type: "number", minimum: 0, maximum: 100 },
    carbohydrateG: { type: "number", minimum: 0, maximum: 100 },
    fatG: { type: "number", minimum: 0, maximum: 100 },
    fiberG: {
      anyOf: [{ type: "number", minimum: 0, maximum: 100 }, { type: "null" }],
    },
  },
} as const;

export const estimatedFoodSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120),
    preparation: z.string().trim().min(1).max(120),
    category: z.enum(["carbohydrate", "protein", "fat", "vegetable", "fruit"]),
    mealClassification: z.enum(["neutral", "meat", "dairy"]),
    displayPortionLabel: z.string().trim().min(1).max(80),
    displayPortionGrams: z.number().positive().max(1_000),
    energyKcal: z.number().nonnegative().max(1_000),
    proteinG: z.number().nonnegative().max(100),
    carbohydrateG: z.number().nonnegative().max(100),
    fatG: z.number().nonnegative().max(100),
    fiberG: z.number().nonnegative().max(100).nullable(),
  })
  .strict();

export type EstimatedFood = z.infer<typeof estimatedFoodSchema>;
