import { describe, expect, it } from "vitest";
import {
  createExistingActivePlan,
  createExistingWeightHistory,
} from "@/data/demo-fixtures";
import {
  calculateWeightTrend,
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

  it("creates relative seeded history ending yesterday and a preceding Active Plan", () => {
    const history = createExistingWeightHistory(now);
    const activePlan = createExistingActivePlan(now);
    expect(history).toHaveLength(59);
    expect(history.at(-1)?.date).toBe("2026-08-29");
    expect(activePlan.activatedAt < `${history[0].date}T00:00:00.000Z`).toBe(
      true,
    );
  });
});
