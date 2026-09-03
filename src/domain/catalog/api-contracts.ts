import { z } from "zod";
import { foodLookupContextSchema } from "./runtime";

export const foodLookupRequestSchema = z
  .object({
    profileId: z.enum(["new", "existing"]),
    query: z.string().trim().min(2).max(120),
    context: foodLookupContextSchema,
  })
  .strict();

export const candidateDetailRequestSchema = z
  .object({
    profileId: z.enum(["new", "existing"]),
    candidateId: z.string().uuid(),
  })
  .strict();

export const candidateDecisionRequestSchema = z
  .object({
    profileId: z.enum(["new", "existing"]),
    candidateId: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
    commandId: z.string().min(8).max(100),
  })
  .strict();

export const candidateRejectRequestSchema = z
  .object({
    profileId: z.enum(["new", "existing"]),
    candidateId: z.string().uuid(),
  })
  .strict();

export const estimateRequestSchema = z
  .object({
    profileId: z.enum(["new", "existing"]),
    lookupId: z.string().uuid(),
  })
  .strict();
