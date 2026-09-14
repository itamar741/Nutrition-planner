import { z } from "zod";

const commandIdSchema = z.string().min(8).max(100);

export const newDemoCloudActionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("apply_closed"),
      optionId: z.string().min(1).max(100),
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
]);

export const existingDemoCloudActionSchema = z.discriminatedUnion("type", [
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
]);

export type NewDemoCloudAction = z.infer<typeof newDemoCloudActionSchema>;
export type ExistingDemoCloudAction = z.infer<
  typeof existingDemoCloudActionSchema
>;
