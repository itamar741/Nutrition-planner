import { z } from "zod";
import { activePlanSchema } from "@/domain/plan/schemas";
import type { ActivePlan } from "@/domain/plan/types";
import type { WeightMeasurement } from "@/domain/weight/trend";
import {
  agentSessionSchema,
  type AgentSessionState,
} from "@/domain/agent/types";

export interface ExistingChatMessage {
  id: string;
  role: "assistant" | "user";
  text: string;
}

export interface ExistingDemoState {
  schemaVersion: 1;
  activePlan: ActivePlan;
  measurements: WeightMeasurement[];
  messages: ExistingChatMessage[];
  approvedCatalogFoodIds: string[];
  agentSession: AgentSessionState;
}

export const existingStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    activePlan: activePlanSchema,
    measurements: z.array(
      z
        .object({
          id: z.string().min(1),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          weightKg: z.number().positive().max(500),
          commandId: z.string().min(1),
        })
        .strict(),
    ),
    messages: z.array(
      z
        .object({
          id: z.string().min(1),
          role: z.enum(["assistant", "user"]),
          text: z.string().min(1).max(1_000),
        })
        .strict(),
    ),
    approvedCatalogFoodIds: z.array(z.string().min(1).max(100)),
    agentSession: agentSessionSchema,
  })
  .strict();
