import {
  coachToolResult,
  type CoachToolResult,
} from "@/domain/agent/tool-result";
import {
  calculateWeightTrend,
  formatWeightKg,
  normalizeWeightKg,
} from "@/domain/weight/trend";
import type { PersistedDemoState } from "@/persistence/repository";
import { finishNonInteractiveWorkflow } from "../interaction-state";

type HistoricalWeight = { date: string; weightKg: number };

function measurementsOf(state: PersistedDemoState) {
  return "profile" in state ? state.weightMeasurements : state.measurements;
}

function withMeasurements(
  state: PersistedDemoState,
  measurements: ReturnType<typeof measurementsOf>,
): PersistedDemoState {
  return "profile" in state
    ? { ...state, weightMeasurements: measurements }
    : { ...state, measurements };
}

export function executeWeightTool(input: {
  name: "record_weight" | "edit_weight" | "delete_weight";
  state: PersistedDemoState;
  commandId: string;
  currentDate: string;
  todayWeight: number | null;
  historicalWeight: HistoricalWeight | null;
  deleteDate: string | null;
}): {
  state: PersistedDemoState;
  result: CoachToolResult;
  confirmation: string | null;
} {
  if ("profile" in input.state && !input.state.activePlan) {
    return {
      state: input.state,
      result: coachToolResult(
        "blocked",
        "active_plan_required",
        `Activate your first plan before ${input.name === "record_weight" ? "recording" : input.name === "edit_weight" ? "editing" : "deleting"} weight.`,
      ),
      confirmation: null,
    };
  }

  const existingMeasurements = measurementsOf(input.state);
  if (input.name === "delete_weight") {
    if (!input.deleteDate) {
      return {
        state: input.state,
        result: coachToolResult(
          "blocked",
          "missing_source_evidence",
          "Restate the measurement date in this message.",
        ),
        confirmation: null,
      };
    }
    const deleted = existingMeasurements.filter(
      (item) => item.date === input.deleteDate,
    );
    if (deleted.length === 0) {
      return {
        state: input.state,
        result: coachToolResult(
          "blocked",
          "weight_not_found",
          "No weight is recorded for that date.",
        ),
        confirmation: null,
      };
    }
    const measurements = existingMeasurements.filter(
      (item) => item.date !== input.deleteDate,
    );
    const trend = calculateWeightTrend(measurements, {
      activePlanActivatedAt: input.state.activePlan?.activatedAt,
    });
    const state = finishNonInteractiveWorkflow(
      withMeasurements(input.state, measurements),
      "weight",
    );
    const deletedWeight = deleted.at(-1)!.weightKg;
    return {
      state,
      result: coachToolResult(
        "completed",
        "weight_deleted",
        "The weight measurement was deleted.",
        {
          deleted: { date: input.deleteDate, weightKg: deletedWeight },
          trend,
        },
      ),
      confirmation: `Deleted the ${formatWeightKg(deletedWeight)} kg measurement for ${input.deleteDate === input.currentDate ? "today" : input.deleteDate}.`,
    };
  }

  const resolved =
    input.name === "record_weight"
      ? input.todayWeight === null
        ? null
        : { date: input.currentDate, weightKg: input.todayWeight }
      : input.historicalWeight;
  if (!resolved) {
    return {
      state: input.state,
      result: coachToolResult(
        "blocked",
        "missing_source_evidence",
        input.name === "record_weight"
          ? "Restate today's weight in this message."
          : "Restate the date and weight in this message.",
      ),
      confirmation: null,
    };
  }

  const weightKg = normalizeWeightKg(resolved.weightKg);
  const previous = existingMeasurements
    .filter((item) => item.date === resolved.date)
    .at(-1);
  const measurement = previous
    ? { ...previous, weightKg, commandId: input.commandId }
    : {
        id: `weight-${input.commandId}`,
        date: resolved.date,
        weightKg,
        commandId: input.commandId,
      };
  const measurements = [
    ...existingMeasurements.filter((item) => item.date !== resolved.date),
    measurement,
  ].sort((left, right) => left.date.localeCompare(right.date));
  const trend = calculateWeightTrend(measurements, {
    activePlanActivatedAt: input.state.activePlan?.activatedAt,
  });
  const state = finishNonInteractiveWorkflow(
    withMeasurements(input.state, measurements),
    "weight",
  );
  const dayLabel =
    resolved.date === input.currentDate ? "today" : resolved.date;
  const confirmation = previous
    ? resolved.date === input.currentDate
      ? `Updated today’s weight from ${formatWeightKg(previous.weightKg)} kg to ${formatWeightKg(weightKg)} kg.`
      : `Updated ${resolved.date} from ${formatWeightKg(previous.weightKg)} kg to ${formatWeightKg(weightKg)} kg.`
    : `Recorded ${formatWeightKg(weightKg)} kg for ${dayLabel}.`;
  return {
    state,
    result: coachToolResult(
      "completed",
      previous ? "weight_updated" : "weight_recorded",
      previous
        ? "The weight measurement was updated."
        : "The weight measurement was recorded.",
      {
        operation: previous ? "updated" : "created",
        previousWeightKg: previous?.weightKg ?? null,
        measurement: { date: resolved.date, weightKg },
        trend,
      },
    ),
    confirmation,
  };
}
