import { z } from "zod";
import { structuredProfileSchema } from "@/domain/profile/schemas";
import {
  activePlanSchema,
  draftCandidateSchema,
  draftModificationOperationSchema,
  draftProposalSchema,
} from "@/domain/plan/schemas";

export const draftRequestSchema = z
  .object({
    commandId: z.string().min(8).max(100),
    message: z.string().trim().max(1_000).optional(),
    profile: structuredProfileSchema,
  })
  .strict();

export const draftSuccessSchema = z
  .object({
    ok: z.literal(true),
    commandId: z.string(),
    draft: draftProposalSchema,
  })
  .strict();

export const planFailureSchema = z
  .object({
    ok: z.literal(false),
    commandId: z.string().nullable(),
    code: z.enum([
      "invalid_request",
      "not_configured",
      "model_failure",
      "validation_failure",
    ]),
    message: z.string(),
  })
  .strict();

export const draftModificationRequestSchema = z
  .object({
    commandId: z.string().min(8).max(100),
    message: z.string().trim().min(1).max(1_000),
    profile: structuredProfileSchema,
    draft: draftProposalSchema,
  })
  .strict();

export const draftModificationSuccessSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      ok: z.literal(true),
      commandId: z.string(),
      outcome: z.literal("modified"),
      draft: draftProposalSchema,
      message: z.string(),
    })
    .strict(),
  z
    .object({
      ok: z.literal(true),
      commandId: z.string(),
      outcome: z.literal("unsupported"),
      message: z.string(),
    })
    .strict(),
]);

export type DraftRequest = z.infer<typeof draftRequestSchema>;
export type DraftCandidateModel = z.infer<typeof draftCandidateSchema>;
export type DraftModificationRequest = z.infer<
  typeof draftModificationRequestSchema
>;
export type DraftModificationModel = z.infer<
  typeof draftModificationOperationSchema
>;

export const adjustmentRequestSchema = z
  .object({
    commandId: z.string().min(8).max(100),
    feedback: z.string().trim().min(1).max(1_000).optional(),
    profile: structuredProfileSchema,
    activePlan: activePlanSchema,
    direction: z.enum(["increase", "decrease"]),
    adjustmentKcal: z.number().int().min(100).max(200),
  })
  .strict();

export const adjustmentSuccessSchema = z
  .object({
    ok: z.literal(true),
    commandId: z.string(),
    draft: draftProposalSchema,
  })
  .strict();

export type AdjustmentRequest = z.infer<typeof adjustmentRequestSchema>;

const planMealIds = [
  "breakfast",
  "lunch",
  "snack",
  "dinner",
  "meal_1",
  "meal_2",
  "meal_3",
  "meal_4",
] as const;

const catalogPortionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["catalogFoodId", "grams"],
  properties: {
    catalogFoodId: { type: "string", minLength: 1, maxLength: 80 },
    grams: { type: "integer", minimum: 1, maximum: 1_000 },
  },
} as const;

export const draftCandidateJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "meals"],
  properties: {
    summary: { type: "string", minLength: 1, maxLength: 240 },
    meals: {
      type: "array",
      minItems: 3,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "items"],
        properties: {
          id: { type: "string", enum: planMealIds },
          items: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["catalogFoodId", "grams", "alternatives"],
              properties: {
                catalogFoodId: {
                  type: "string",
                  minLength: 1,
                  maxLength: 80,
                },
                grams: { type: "integer", minimum: 1, maximum: 1_000 },
                alternatives: {
                  type: "array",
                  maxItems: 2,
                  items: catalogPortionJsonSchema,
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

export const draftModificationJsonSchema = {
  anyOf: [
    {
      type: "object",
      additionalProperties: false,
      required: [
        "type",
        "mealId",
        "itemId",
        "catalogFoodId",
        "grams",
        "explanation",
      ],
      properties: {
        type: { const: "replace_food" },
        mealId: { type: "string", enum: planMealIds },
        itemId: { type: "string", minLength: 1 },
        catalogFoodId: { type: "string", minLength: 1 },
        grams: { type: "integer", minimum: 1, maximum: 1_000 },
        explanation: { type: "string", minLength: 1, maxLength: 240 },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "mealId", "itemId", "grams", "explanation"],
      properties: {
        type: { const: "change_portion" },
        mealId: { type: "string", enum: planMealIds },
        itemId: { type: "string", minLength: 1 },
        grams: { type: "integer", minimum: 1, maximum: 1_000 },
        explanation: { type: "string", minLength: 1, maxLength: 240 },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "explanation"],
      properties: {
        type: { const: "unsupported" },
        explanation: { type: "string", minLength: 1, maxLength: 240 },
      },
    },
  ],
} as const;
