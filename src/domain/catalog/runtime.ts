import { z } from "zod";
import type { CatalogFood } from "./types";

export const foodPreparationSchema = z.enum(["cooked", "raw", "packaged"]);

export const foodLookupToolArgumentsSchema = z
  .object({
    query: z.string().trim().min(2).max(120),
    preparation: foodPreparationSchema,
    brand: z.string().trim().min(1).max(80).nullable(),
    servingHint: z.string().trim().min(1).max(80).nullable(),
  })
  .strict();

export type FoodLookupToolArguments = z.infer<
  typeof foodLookupToolArgumentsSchema
>;

export const foodSearchCandidateSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(300),
    sourceUrl: z.string().url(),
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
  sourceLabel: "Fuder verified" | "AI estimate · Fuder not verified";
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
