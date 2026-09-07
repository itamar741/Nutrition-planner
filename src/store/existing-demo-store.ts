import { z } from "zod";
import { activePlanSchema, draftProposalSchema } from "@/domain/plan/schemas";
import type { ActivePlan, DraftProposal } from "@/domain/plan/types";
import {
  maintenanceReferenceWeightFromInitialMeasurements,
  type WeightMeasurement,
} from "@/domain/weight/trend";
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
  schemaVersion: 2;
  activePlan: ActivePlan;
  draft: DraftProposal | null;
  measurements: WeightMeasurement[];
  messages: ExistingChatMessage[];
  approvedCatalogFoodIds: string[];
  agentSession: AgentSessionState;
}

export const existingStateSchema = z
  .object({
    schemaVersion: z.literal(2),
    activePlan: activePlanSchema,
    draft: draftProposalSchema.nullable(),
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

export function parseExistingState(value: unknown): ExistingDemoState {
  const legacy = z
    .object({ schemaVersion: z.literal(1) })
    .passthrough()
    .safeParse(value);
  const upgraded = legacy.success
    ? {
        ...legacy.data,
        schemaVersion: 2 as const,
        draft: "draft" in legacy.data ? legacy.data.draft : null,
      }
    : value;
  const record =
    typeof upgraded === "object" && upgraded !== null
      ? (upgraded as Record<string, unknown>)
      : null;
  const activePlan =
    record &&
    typeof record.activePlan === "object" &&
    record.activePlan !== null
      ? (record.activePlan as Record<string, unknown>)
      : null;
  const measurements = Array.isArray(record?.measurements)
    ? record.measurements.filter(
        (measurement): measurement is WeightMeasurement =>
          typeof measurement === "object" &&
          measurement !== null &&
          typeof (measurement as WeightMeasurement).id === "string" &&
          typeof (measurement as WeightMeasurement).date === "string" &&
          Number.isFinite((measurement as WeightMeasurement).weightKg) &&
          typeof (measurement as WeightMeasurement).commandId === "string",
      )
    : [];
  const withMaintenanceReference =
    activePlan && !("maintenanceReferenceWeightKg" in activePlan)
      ? {
          ...record,
          activePlan: {
            ...activePlan,
            maintenanceReferenceWeightKg:
              maintenanceReferenceWeightFromInitialMeasurements(measurements),
          },
        }
      : upgraded;
  return existingStateSchema.parse(withMaintenanceReference);
}
