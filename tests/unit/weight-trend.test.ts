import { describe, expect, it } from "vitest";
import {
  createExistingActivePlan,
  createExistingWeightHistory,
} from "@/data/demo-fixtures";
import {
  adjustmentDirection,
  calculateMaintenanceWeightDrift,
  calculateWeightTrend,
  currentPlanWeightFromMeasurements,
  formatWeightKg,
  maintenanceReferenceWeightFromInitialMeasurements,
  parseCurrentWeightMessage,
  type WeightMeasurement,
} from "@/domain/weight/trend";

const now = new Date("2026-08-30T12:00:00.000Z");

function measurements(count = 35): WeightMeasurement[] {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date("2026-07-27T12:00:00.000Z");
    date.setUTCDate(date.getUTCDate() + index);
    return {
      id: `weight-${index}`,
      date: date.toISOString().slice(0, 10),
      weightKg: 80 + index * 0.0571428571,
      commandId: `command-${index}`,
    };
  });
}

describe("weight trend controls", () => {
  it("VT-15 parses a current weight and rejects unsupported chat text", () => {
    expect(parseCurrentWeightMessage("80.4 kg")).toBe(80.4);
    expect(parseCurrentWeightMessage("80,4")).toBe(80.4);
    expect(parseCurrentWeightMessage("I weigh 80.4 kg")).toBeNull();
  });

  it("B-02 formats weights with no more than two decimal places", () => {
    expect(formatWeightKg(80)).toBe("80");
    expect(formatWeightKg(80.4)).toBe("80.4");
    expect(formatWeightKg(81.0857142849)).toBe("81.09");
  });

  it("VT-17 calculates the seeded maintenance gain trend without rounding inputs", () => {
    const trend = calculateWeightTrend(measurements(), { now });
    expect(trend.evidence).toBe("sufficient");
    expect(trend.weeklyPercent).toBeCloseTo(0.494, 3);
  });

  it("VT-16 blocks evidence when an Active Plan changed in the measurement window", () => {
    const trend = calculateWeightTrend(measurements(), {
      now,
      activePlanActivatedAt: "2026-08-15T12:00:00.000Z",
    });
    expect(trend.evidence).toBe("insufficient");
    expect(trend.evidenceReason).toBe("active_plan_changed");
  });

  it("uses enough post-activation evidence even when activation is inside the 35-day window", () => {
    const trend = calculateWeightTrend(measurements(), {
      now,
      activePlanActivatedAt: "2026-07-28T12:00:00.000Z",
    });

    expect(trend.measurementCount).toBe(34);
    expect(trend.spanDays).toBe(33);
    expect(trend.evidence).toBe("sufficient");
  });

  it("excludes future measurements from the current evidence window", () => {
    const future = {
      id: "future-weight",
      date: "2026-08-31",
      weightKg: 120,
      commandId: "future-command",
    };
    const trend = calculateWeightTrend([...measurements(), future], { now });

    expect(trend.measurementCount).toBe(35);
    expect(trend.meanWeightKg).toBeLessThan(82);
  });

  it("anchors Maintenance to the first recorded weight and uses a seven-day average for gain or loss", () => {
    const history = Array.from({ length: 8 }, (_, index) => ({
      id: `policy-${index}`,
      date: `2026-08-${String(index + 1).padStart(2, "0")}`,
      weightKg: 70 + index,
      commandId: `policy-command-${index}`,
    }));

    expect(maintenanceReferenceWeightFromInitialMeasurements(history)).toBe(70);
    expect(currentPlanWeightFromMeasurements(history)).toBe(74);
    expect(currentPlanWeightFromMeasurements(history.slice(0, 6))).toBe(75);
  });

  it("creates relative seeded history ending yesterday and a preceding Active Plan", () => {
    const history = createExistingWeightHistory(now);
    const activePlan = createExistingActivePlan(now);
    expect(history).toHaveLength(59);
    expect(history.at(-1)?.date).toBe("2026-08-29");
    expect(activePlan.activatedAt < `${history[0].date}T00:00:00.000Z`).toBe(
      true,
    );
  });

  it("keeps the Existing maintenance fixture between 75 and 76 kg with a recent rising trend", () => {
    const history = createExistingWeightHistory(now);
    const trend = calculateWeightTrend(history, {
      now,
      activePlanActivatedAt: createExistingActivePlan(now).activatedAt,
    });

    expect(
      Math.min(...history.map((item) => item.weightKg)),
    ).toBeGreaterThanOrEqual(75);
    expect(
      Math.max(...history.map((item) => item.weightKg)),
    ).toBeLessThanOrEqual(76);
    expect(history.slice(-5).map((item) => item.weightKg)).toEqual([
      75.78, 75.85, 75.91, 75.96, 76,
    ]);
    expect(trend.evidence).toBe("sufficient");
    expect(trend.weeklyPercent).toBeCloseTo(0.253, 3);
    expect(adjustmentDirection("maintenance", trend.weeklyPercent)).toBe(
      "decrease",
    );
  });

  it("requires two consecutive seven-measurement blocks beyond the maintenance anchor", () => {
    const sustained = Array.from({ length: 14 }, (_, index) => {
      const date = new Date("2026-08-01T12:00:00.000Z");
      date.setUTCDate(date.getUTCDate() + index);
      return {
        id: `sustained-${index}`,
        date: date.toISOString().slice(0, 10),
        weightKg: 75.72 + (index % 2 === 0 ? 0.02 : -0.01),
        commandId: `sustained-command-${index}`,
      };
    });
    const drift = calculateMaintenanceWeightDrift({
      measurements: sustained,
      referenceWeightKg: 75,
    });
    expect(drift.direction).toBe("decrease");
    expect(drift.latestAverageKg).toBeGreaterThanOrEqual(75.7);
    expect(drift.precedingAverageKg).toBeGreaterThanOrEqual(75.7);

    const shortLived = sustained.map((measurement, index) =>
      index < 7 ? { ...measurement, weightKg: 75.2 } : measurement,
    );
    expect(
      calculateMaintenanceWeightDrift({
        measurements: shortLived,
        referenceWeightKg: 75,
      }).direction,
    ).toBeNull();

    const sustainedLoss = sustained.map((measurement) => ({
      ...measurement,
      weightKg: measurement.weightKg - 1.44,
    }));
    expect(
      calculateMaintenanceWeightDrift({
        measurements: sustainedLoss,
        referenceWeightKg: 75,
      }).direction,
    ).toBe("increase");
  });
});
