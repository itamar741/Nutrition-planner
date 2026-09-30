import {
  assistantTurnSchema,
  nutritionTargetsSchema,
  structuredProfileSchema,
} from "@/domain/profile/schemas";
import { activePlanSchema, draftProposalSchema } from "@/domain/plan/schemas";
import { z } from "zod";
import {
  agentSessionSchema,
  projectedConversationMessageSchema,
} from "@/domain/agent/types";
import { upgradePersistedStateV4 } from "./state-schema";

export const persistedStateSchema = z.preprocess(
  upgradePersistedStateV4,
  z
    .object({
      schemaVersion: z.literal(4),
      profileId: z.literal("new"),
      profile: structuredProfileSchema,
      messages: z.array(projectedConversationMessageSchema),
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
      agentSession: agentSessionSchema,
      weightMeasurements: z
        .array(
          z
            .object({
              id: z.string().min(1),
              date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
              weightKg: z.number().positive().max(500),
              commandId: z.string().min(1),
            })
            .strict(),
        )
        .default([]),
    })
    .strict(),
);
