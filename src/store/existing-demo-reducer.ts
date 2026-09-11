import type { DraftProposal } from "@/domain/plan/types";
import type { WeightMeasurement } from "@/domain/weight/trend";
import type {
  ExistingChatMessage,
  ExistingDemoState,
} from "./existing-demo-store";

export type ExistingDemoAction =
  | {
      type: "add_messages";
      commandId: string;
      messages: ExistingChatMessage[];
    }
  | {
      type: "record_weight";
      commandId: string;
      measurement: WeightMeasurement;
      messages: ExistingChatMessage[];
    }
  | {
      type: "edit_weight";
      commandId: string;
      date: string;
      weightKg: number;
      messages: ExistingChatMessage[];
    }
  | {
      type: "delete_weight";
      commandId: string;
      date: string;
      messages: ExistingChatMessage[];
    }
  | {
      type: "approve_adjustment";
      commandId: string;
      draft: DraftProposal;
      activatedAt: string;
      messages: ExistingChatMessage[];
    };

export function existingDemoReducer(
  state: ExistingDemoState,
  action: ExistingDemoAction,
): ExistingDemoState {
  switch (action.type) {
    case "add_messages":
      return { ...state, messages: [...state.messages, ...action.messages] };
    case "record_weight":
      if (
        state.measurements.some(
          (item) =>
            item.date === action.measurement.date ||
            item.commandId === action.commandId,
        )
      ) {
        return state;
      }
      return {
        ...state,
        measurements: [...state.measurements, action.measurement],
        messages: [...state.messages, ...action.messages],
      };
    case "edit_weight":
      return {
        ...state,
        measurements: state.measurements.map((item) =>
          item.date === action.date
            ? {
                ...item,
                weightKg: action.weightKg,
                commandId: action.commandId,
              }
            : item,
        ),
        messages: [...state.messages, ...action.messages],
      };
    case "delete_weight":
      if (!state.measurements.some((item) => item.date === action.date)) {
        return state;
      }
      return {
        ...state,
        measurements: state.measurements.filter(
          (item) => item.date !== action.date,
        ),
        messages: [...state.messages, ...action.messages],
      };
    case "approve_adjustment":
      if (
        action.draft.basePlanVersion !== state.activePlan.version ||
        !action.draft.plan.validation.valid
      ) {
        return state;
      }
      return {
        ...state,
        draft: null,
        activePlan: {
          ...state.activePlan,
          version: action.draft.plan.version,
          activatedAt: action.activatedAt,
          maintenanceReferenceWeightKg:
            state.activePlan.maintenanceReferenceWeightKg,
          plan: action.draft.plan,
        },
        messages: [...state.messages, ...action.messages],
      };
  }
}
