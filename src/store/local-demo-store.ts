import {
  assistantTurnSchema,
  nutritionTargetsSchema,
  structuredProfileSchema,
} from "@/domain/profile/schemas";
import { activePlanSchema, draftProposalSchema } from "@/domain/plan/schemas";
import { z } from "zod";

export const persistedStateSchema = z
  .object({
    schemaVersion: z.literal(2),
    profileId: z.literal("new"),
    profile: structuredProfileSchema,
    messages: z.array(
      z
        .object({
          id: z.string(),
          role: z.enum(["assistant", "user"]),
          text: z.string(),
        })
        .strict(),
    ),
    activeTurn: assistantTurnSchema,
    targets: nutritionTargetsSchema.nullable(),
    draft: draftProposalSchema.nullable(),
    activePlan: activePlanSchema.nullable(),
    status: z.enum(["idle", "processing", "failed"]),
    pendingCommand: z
      .object({ id: z.string(), message: z.string() })
      .strict()
      .nullable(),
    pendingOperation: z
      .enum(["onboarding", "draft", "modification"])
      .nullable(),
    processedCommandIds: z.array(z.string()),
    error: z.string().nullable(),
  })
  .strict();
