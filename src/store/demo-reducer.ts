import { calculateTargets } from "@/domain/nutrition/calculations";
import {
  baselineCatalogSnapshot,
  type CatalogSnapshot,
} from "@/domain/catalog/snapshot";
import type { ActivePlan, DraftProposal } from "@/domain/plan/types";
import type { AgentSessionState } from "@/domain/agent/types";
import { validateFoodSelections } from "@/domain/plan/validation";
import { applyFactPatch, getNextTurn } from "@/domain/profile/onboarding";
import type {
  AssistantTurn,
  DemoProfileId,
  NutritionTargets,
  ProfileFactPatch,
  StructuredProfile,
} from "@/domain/profile/types";
import type { WeightMeasurement } from "@/domain/weight/trend";

export interface ChatMessage {
  id: string;
  role: "assistant" | "user";
  text: string;
}

export interface PendingCommand {
  id: string;
  message: string;
}

export interface DemoState {
  schemaVersion: 4;
  profileId: DemoProfileId;
  profile: StructuredProfile;
  messages: ChatMessage[];
  activeTurn: AssistantTurn;
  targets: NutritionTargets | null;
  draft: DraftProposal | null;
  activePlan: ActivePlan | null;
  status: "idle" | "processing" | "failed";
  pendingCommand: PendingCommand | null;
  pendingOperation: "onboarding" | "draft" | "modification" | null;
  processedCommandIds: string[];
  error: string | null;
  agentSession: AgentSessionState;
  weightMeasurements: WeightMeasurement[];
}

export type DemoAction =
  | { type: "hydrate"; state: DemoState }
  | { type: "start_open"; command: PendingCommand }
  | { type: "retry_open"; commandId: string }
  | {
      type: "complete_open";
      commandId: string;
      profile: StructuredProfile;
      activeTurn: AssistantTurn;
      acknowledgement: string;
      targets: NutritionTargets | null;
    }
  | { type: "fail_open"; commandId: string; message: string }
  | {
      type: "apply_closed";
      commandId: string;
      optionId: string;
      label: string;
      patch: ProfileFactPatch;
    }
  | { type: "apply_food_selection"; commandId: string; ids: string[] }
  | {
      type: "record_weight";
      commandId: string;
      measurement: WeightMeasurement;
    }
  | {
      type: "edit_weight";
      commandId: string;
      date: string;
      weightKg: number;
    }
  | { type: "delete_weight"; commandId: string; date: string };

function messageId(prefix: string, commandId: string) {
  return `${prefix}-${commandId}`;
}

export function demoReducer(
  state: DemoState,
  action: DemoAction,
  catalog: CatalogSnapshot = baselineCatalogSnapshot,
): DemoState {
  if (action.type === "hydrate") return action.state;

  if (
    "commandId" in action &&
    state.processedCommandIds.includes(action.commandId)
  ) {
    return state;
  }

  switch (action.type) {
    case "start_open":
      if (state.status === "processing") return state;
      return {
        ...state,
        status: "processing",
        pendingCommand: action.command,
        pendingOperation: "onboarding",
        error: null,
        messages: [
          ...state.messages,
          {
            id: messageId("user", action.command.id),
            role: "user",
            text: action.command.message,
          },
        ],
      };
    case "retry_open":
      if (
        state.pendingCommand?.id !== action.commandId ||
        state.status !== "failed"
      ) {
        return state;
      }
      return {
        ...state,
        status: "processing",
        error: null,
      };
    case "complete_open":
      if (state.pendingCommand?.id !== action.commandId) return state;
      const measurements =
        state.weightMeasurements.length > 0 ||
        action.profile.currentWeightKg === null
          ? state.weightMeasurements
          : [
              {
                id: `weight-onboarding-${action.commandId}`,
                date: new Date().toISOString().slice(0, 10),
                weightKg: action.profile.currentWeightKg,
                commandId: action.commandId,
              },
            ];
      return {
        ...state,
        profile: action.profile,
        activeTurn: action.activeTurn,
        targets: action.targets,
        weightMeasurements: measurements,
        status: "idle",
        pendingCommand: null,
        pendingOperation: null,
        processedCommandIds: [...state.processedCommandIds, action.commandId],
        error: null,
        messages: [
          ...state.messages,
          {
            id: messageId("assistant", action.commandId),
            role: "assistant",
            text: `${action.acknowledgement} ${action.activeTurn.prompt}`.trim(),
          },
        ],
      };
    case "fail_open":
      if (state.pendingCommand?.id !== action.commandId) return state;
      return {
        ...state,
        status: "failed",
        error: action.message,
      };
    case "apply_closed": {
      if (state.status === "processing") return state;
      const profile = applyFactPatch(state.profile, action.patch);
      const activeTurn = getNextTurn(profile);
      return {
        ...state,
        profile,
        activeTurn,
        targets: calculateTargets(profile),
        status: "idle",
        pendingCommand: null,
        pendingOperation: null,
        processedCommandIds: [...state.processedCommandIds, action.commandId],
        error: null,
        messages: [
          ...state.messages,
          {
            id: messageId("user", action.commandId),
            role: "user",
            text: action.label,
          },
          {
            id: messageId("assistant", action.commandId),
            role: "assistant",
            text: activeTurn.prompt,
          },
        ],
      };
    }
    case "apply_food_selection": {
      if (state.status === "processing") return state;
      const selection = validateFoodSelections(action.ids, catalog);
      if (!selection.valid) {
        return {
          ...state,
          status: "failed",
          error: selection.issues.join(" "),
          pendingCommand: null,
          pendingOperation: null,
        };
      }
      const profile = {
        ...state.profile,
        foodPreferencesComplete: true,
        approvedCatalogFoodIds: selection.orderedIds,
      };
      const activeTurn = getNextTurn(profile);
      return {
        ...state,
        profile,
        activeTurn,
        targets: calculateTargets(profile),
        status: "idle",
        pendingCommand: null,
        pendingOperation: null,
        error: null,
        processedCommandIds: [...state.processedCommandIds, action.commandId],
        messages: [
          ...state.messages,
          {
            id: messageId("user", action.commandId),
            role: "user",
            text: `Selected ${selection.orderedIds.length} catalog foods.`,
          },
          {
            id: messageId("assistant", action.commandId),
            role: "assistant",
            text: "Your food preferences and deterministic targets are ready. I’m Arnold, your planning coach. When you’re ready, ask me to create a Draft from your approved foods.",
          },
        ],
      };
    }
    case "record_weight":
      if (
        !state.activePlan ||
        state.weightMeasurements.some(
          (item) =>
            item.date === action.measurement.date ||
            item.commandId === action.commandId,
        )
      ) {
        return state;
      }
      return {
        ...state,
        weightMeasurements: [...state.weightMeasurements, action.measurement],
        processedCommandIds: [...state.processedCommandIds, action.commandId],
        messages: [
          ...state.messages,
          {
            id: messageId("assistant", action.commandId),
            role: "assistant",
            text: `Recorded ${action.measurement.weightKg} kg for ${action.measurement.date}. Your trend was recalculated.`,
          },
        ],
      };
    case "edit_weight":
      if (
        !state.activePlan ||
        !state.weightMeasurements.some((item) => item.date === action.date)
      ) {
        return state;
      }
      return {
        ...state,
        weightMeasurements: state.weightMeasurements.map((item) =>
          item.date === action.date
            ? {
                ...item,
                weightKg: action.weightKg,
                commandId: action.commandId,
              }
            : item,
        ),
        processedCommandIds: [...state.processedCommandIds, action.commandId],
        messages: [
          ...state.messages,
          {
            id: messageId("assistant", action.commandId),
            role: "assistant",
            text: `Updated ${action.date} to ${action.weightKg} kg. Your trend was recalculated.`,
          },
        ],
      };
    case "delete_weight":
      if (
        !state.activePlan ||
        !state.weightMeasurements.some((item) => item.date === action.date)
      ) {
        return state;
      }
      return {
        ...state,
        weightMeasurements: state.weightMeasurements.filter(
          (item) => item.date !== action.date,
        ),
        processedCommandIds: [...state.processedCommandIds, action.commandId],
        messages: [
          ...state.messages,
          {
            id: messageId("assistant", action.commandId),
            role: "assistant",
            text: `Deleted the weight recorded for ${action.date}. Your trend was recalculated.`,
          },
        ],
      };
  }
}
