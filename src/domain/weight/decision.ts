import { roundTo25HalfUp } from "@/domain/nutrition/calculations";
import type { ActivePlan } from "@/domain/plan/types";
import type { Goal } from "@/domain/profile/types";
import {
  adjustmentDirection,
  calculateMaintenanceWeightDrift,
  calculateWeightTrend,
  type MaintenanceWeightDrift,
  type WeightMeasurement,
  type WeightTrend,
} from "@/domain/weight/trend";

export const GOAL_WEEKLY_RATE_BANDS: Record<
  Goal,
  { minimum: number; maximum: number }
> = {
  fat_loss: { minimum: -1, maximum: -0.5 },
  maintenance: { minimum: -0.25, maximum: 0.25 },
  muscle_gain: { minimum: 0.25, maximum: 0.5 },
};

export type WeightAdjustmentReason =
  | "insufficient_evidence"
  | "within_goal_band"
  | "rate_above_band"
  | "rate_below_band"
  | "maintenance_drift_above"
  | "maintenance_drift_below";

export interface WeightAdjustmentDecision {
  status: "insufficient_evidence" | "keep_plan" | "adjustment_available";
  reason: WeightAdjustmentReason;
  trend: WeightTrend;
  goalBand: { minimum: number; maximum: number };
  maintenanceDrift: MaintenanceWeightDrift | null;
  direction: "increase" | "decrease" | null;
  adjustmentKcal: number | null;
}

export function evaluateWeightAdjustmentDecision(input: {
  goal: Goal;
  measurements: WeightMeasurement[];
  activePlan: ActivePlan;
  now?: Date;
}): WeightAdjustmentDecision {
  const trend = calculateWeightTrend(input.measurements, {
    now: input.now,
    activePlanActivatedAt: input.activePlan.activatedAt,
  });
  const goalBand = GOAL_WEEKLY_RATE_BANDS[input.goal];
  const maintenanceDrift =
    input.goal === "maintenance"
      ? calculateMaintenanceWeightDrift({
          measurements: input.measurements,
          referenceWeightKg: input.activePlan.maintenanceReferenceWeightKg,
        })
      : null;

  if (trend.evidence === "insufficient") {
    return {
      status: "insufficient_evidence",
      reason: "insufficient_evidence",
      trend,
      goalBand,
      maintenanceDrift,
      direction: null,
      adjustmentKcal: null,
    };
  }

  const rateDirection = adjustmentDirection(input.goal, trend.weeklyPercent);
  const direction = rateDirection ?? maintenanceDrift?.direction ?? null;
  if (!direction) {
    return {
      status: "keep_plan",
      reason: "within_goal_band",
      trend,
      goalBand,
      maintenanceDrift,
      direction: null,
      adjustmentKcal: null,
    };
  }

  const reason: WeightAdjustmentReason = rateDirection
    ? trend.weeklyPercent > goalBand.maximum
      ? "rate_above_band"
      : "rate_below_band"
    : direction === "decrease"
      ? "maintenance_drift_above"
      : "maintenance_drift_below";
  const adjustmentKcal = Math.max(
    100,
    Math.min(
      200,
      roundTo25HalfUp(
        input.activePlan.plan.validation.totals.energyKcal * 0.05,
      ),
    ),
  );

  return {
    status: "adjustment_available",
    reason,
    trend,
    goalBand,
    maintenanceDrift,
    direction,
    adjustmentKcal,
  };
}
