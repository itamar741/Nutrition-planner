import { z } from "zod";
import { activePlanSchema, draftProposalSchema } from "@/domain/plan/schemas";
import type { ActivePlan, DraftProposal } from "@/domain/plan/types";
import {
  maintenanceReferenceWeightFromInitialMeasurements,
  type WeightMeasurement,
} from "@/domain/weight/trend";
import {
  agentSessionSchema,
  projectedConversationMessageSchema,
  type AgentSessionState,
} from "@/domain/agent/types";
import { upgradePersistedStateV5 } from "./state-schema";

export interface ExistingChatMessage {
  id: string;
  role: "assistant" | "user";
  text: string;
}

export interface ExistingDemoState {
  schemaVersion: 5;
  activePlan: ActivePlan;
  draft: DraftProposal | null;
  measurements: WeightMeasurement[];
  messages: ExistingChatMessage[];
  approvedCatalogFoodIds: string[];
  agentSession: AgentSessionState;
}

export const existingStateSchema = z
  .object({
    schemaVersion: z.literal(5),
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
    messages: z.array(projectedConversationMessageSchema),
    approvedCatalogFoodIds: z.array(z.string().min(1).max(100)),
    agentSession: agentSessionSchema,
  })
  .strict();

export function parseExistingState(value: unknown): ExistingDemoState {
  const legacy = z
    .object({
      schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    })
    .passthrough()
    .safeParse(value);
  const upgraded = legacy.success
    ? {
        ...legacy.data,
        schemaVersion: 3 as const,
        draft: "draft" in legacy.data ? legacy.data.draft : null,
      }
    : value;
  const upgradedV4 = upgradePersistedStateV5(upgraded);
  const record =
    typeof upgradedV4 === "object" && upgradedV4 !== null
      ? (upgradedV4 as Record<string, unknown>)
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
      : upgradedV4;
  return existingStateSchema.parse(withMaintenanceReference);
}
