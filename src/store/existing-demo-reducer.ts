import { formatWeightKg, type WeightMeasurement } from "@/domain/weight/trend";
import type { ExistingDemoState } from "./existing-demo-store";

export type ExistingDemoAction =
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
  | {
      type: "delete_weight";
      commandId: string;
      date: string;
    };

function assistantMessage(commandId: string, text: string) {
  return {
    id: `assistant-${commandId}`,
    role: "assistant" as const,
    text,
  };
}

export function existingDemoReducer(
  state: ExistingDemoState,
  action: ExistingDemoAction,
): ExistingDemoState {
  switch (action.type) {
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
        messages: [
          ...state.messages,
          assistantMessage(
            action.commandId,
            `Recorded ${formatWeightKg(action.measurement.weightKg)} kg for today. Your trend was recalculated.`,
          ),
        ],
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
        messages: [
          ...state.messages,
          assistantMessage(
            action.commandId,
            `Updated ${action.date} to ${formatWeightKg(action.weightKg)} kg. Your trend was recalculated.`,
          ),
        ],
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
        messages: [
          ...state.messages,
          assistantMessage(
            action.commandId,
            `Deleted the weight recorded for ${action.date}. Your trend was recalculated.`,
          ),
        ],
      };
  }
}
