import { z } from "zod";
import { draftProposalSchema } from "@/domain/plan/schemas";
import {
  assistantTurnSchema,
  nutritionTargetsSchema,
  profileFactPatchSchema,
  structuredProfileSchema,
} from "@/domain/profile/schemas";

const commandSchema = z
  .object({ id: z.string().min(8).max(100), message: z.string().max(1_000) })
  .strict();
const commandIdSchema = z.string().min(8).max(100);
const chatMessageSchema = z
  .object({
    id: z.string().min(1).max(200),
    role: z.enum(["assistant", "user"]),
    text: z.string().min(1).max(1_000),
  })
  .strict();

export const newDemoCloudActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start_open"), command: commandSchema }).strict(),
  z
    .object({ type: z.literal("retry_open"), commandId: commandIdSchema })
    .strict(),
  z
    .object({
      type: z.literal("complete_open"),
      commandId: commandIdSchema,
      profile: structuredProfileSchema,
      activeTurn: assistantTurnSchema,
      acknowledgement: z.string().max(500),
      targets: nutritionTargetsSchema.nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("fail_open"),
      commandId: commandIdSchema,
      message: z.string().max(1_000),
    })
    .strict(),
  z
    .object({
      type: z.literal("apply_closed"),
      commandId: commandIdSchema,
      label: z.string().max(200),
      patch: profileFactPatchSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("apply_food_selection"),
      commandId: commandIdSchema,
      ids: z.array(z.string().max(100)).max(200),
    })
    .strict(),
  z
    .object({
      type: z.literal("record_weight"),
      commandId: commandIdSchema,
      measurement: z
        .object({
          id: z.string().min(1),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          weightKg: z.number().positive().max(500),
          commandId: commandIdSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("edit_weight"),
      commandId: commandIdSchema,
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      weightKg: z.number().positive().max(500),
    })
    .strict(),
  z
    .object({
      type: z.literal("delete_weight"),
      commandId: commandIdSchema,
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .strict(),
  z
    .object({
      type: z.literal("start_plan"),
      command: commandSchema,
      operation: z.enum(["draft", "modification"]),
    })
    .strict(),
  z
    .object({ type: z.literal("retry_plan"), commandId: commandIdSchema })
    .strict(),
  z
    .object({
      type: z.literal("complete_draft"),
      commandId: commandIdSchema,
      draft: draftProposalSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("complete_modification"),
      commandId: commandIdSchema,
      draft: draftProposalSchema,
      message: z.string().max(1_000),
    })
    .strict(),
  z
    .object({
      type: z.literal("complete_unsupported"),
      commandId: commandIdSchema,
      message: z.string().max(1_000),
    })
    .strict(),
  z
    .object({
      type: z.literal("fail_plan"),
      commandId: commandIdSchema,
      message: z.string().max(1_000),
    })
    .strict(),
  z
    .object({
      type: z.literal("reject_draft"),
      commandId: commandIdSchema,
      proposalId: z.string().max(200),
    })
    .strict(),
  z
    .object({
      type: z.literal("activate_draft"),
      commandId: commandIdSchema,
      proposalId: z.string().max(200),
      activatedAt: z.string().datetime(),
    })
    .strict(),
]);

export const existingDemoCloudActionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("add_messages"),
      commandId: commandIdSchema,
      messages: z.array(chatMessageSchema).min(1).max(4),
    })
    .strict(),
  z
    .object({
      type: z.literal("record_weight"),
      commandId: commandIdSchema,
      measurement: z
        .object({
          id: z.string().min(1),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          weightKg: z.number().positive().max(500),
          commandId: commandIdSchema,
        })
        .strict(),
      messages: z.array(chatMessageSchema).max(3),
    })
    .strict(),
  z
    .object({
      type: z.literal("edit_weight"),
      commandId: commandIdSchema,
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      weightKg: z.number().positive().max(500),
      messages: z.array(chatMessageSchema).max(3),
    })
    .strict(),
  z
    .object({
      type: z.literal("delete_weight"),
      commandId: commandIdSchema,
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      messages: z.array(chatMessageSchema).max(3),
    })
    .strict(),
  z
    .object({
      type: z.literal("approve_adjustment"),
      commandId: commandIdSchema,
      draft: draftProposalSchema,
      activatedAt: z.string().datetime(),
      messages: z.array(chatMessageSchema).max(3),
    })
    .strict(),
]);
