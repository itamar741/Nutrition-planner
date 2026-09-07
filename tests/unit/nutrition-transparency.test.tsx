import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  createExistingActivePlan,
  existingReadyProfile,
} from "@/data/demo-fixtures";
import { calculateTargets } from "@/domain/nutrition/calculations";
import { buildNutritionExplanation } from "@/domain/nutrition/explanations";
import { buildPlanValidationExplanation } from "@/domain/plan/validation";
import type { Goal } from "@/domain/profile/types";
import { evaluateWeightAdjustmentDecision } from "@/domain/weight/decision";
import type { WeightMeasurement } from "@/domain/weight/trend";
import {
  NutritionTransparencyPanel,
  WeightDecisionPanel,
} from "@/components/coach-workspace/NutritionTransparencyPanel";

const now = new Date("2026-08-30T12:00:00.000Z");

function flatMeasurements(weightKg: number, count = 35): WeightMeasurement[] {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date("2026-07-27T12:00:00.000Z");
    date.setUTCDate(date.getUTCDate() + index);
    return {
      id: `weight-${index}`,
      date: date.toISOString().slice(0, 10),
      weightKg,
      commandId: `command-${index}`,
    };
  });
}

function slopedMeasurements(slopeKgPerDay: number): WeightMeasurement[] {
  return Array.from({ length: 35 }, (_, index) => {
    const date = new Date("2026-07-27T12:00:00.000Z");
    date.setUTCDate(date.getUTCDate() + index);
    return {
      id: `sloped-weight-${index}`,
      date: date.toISOString().slice(0, 10),
      weightKg: 80 + slopeKgPerDay * index,
      commandId: `sloped-command-${index}`,
    };
  });
}

describe("nutrition transparency", () => {
  it.each([
    ["fat_loss", 2500, -15],
    ["maintenance", 2950, 0],
    ["muscle_gain", 3250, 10],
  ] as const)(
    "builds a generic explanation for %s",
    (goal: Goal, expectedEnergy: number, expectedPercent: number) => {
      const profile = { ...existingReadyProfile, goal };
      const targets = calculateTargets(profile);
      expect(targets).not.toBeNull();
      const explanation = buildNutritionExplanation(profile, targets!);

      expect(explanation).toMatchObject({
        goal,
        baseGoalTargetKcal: expectedEnergy,
        currentTargetKcal: expectedEnergy,
        goalAdjustmentPercent: expectedPercent,
        approvedAdjustmentKcal: 0,
      });
      expect(explanation?.energyFormula).toContain("581.47");
      expect(explanation?.energyFormula).toContain("2945.77 kcal/day");
      expect(explanation?.activity).toMatchObject({
        routineScore: 0,
        exerciseScore: 1,
        palCategory: "low_active",
      });
    },
  );

  it("explains an approved target change without tying the model to a demo profile", () => {
    const targets = calculateTargets(existingReadyProfile)!;
    const explanation = buildNutritionExplanation(existingReadyProfile, {
      ...targets,
      energyKcal: targets.energyKcal - 150,
      carbohydrateTargetG: targets.carbohydrateTargetG - 37.5,
    });

    expect(explanation?.approvedAdjustmentKcal).toBe(-150);
    expect(explanation?.adjustmentNote).toContain("approved decrease of 150");
  });

  it("turns the stored plan validation into five readable checks", () => {
    const activePlan = createExistingActivePlan(now);
    const checks = buildPlanValidationExplanation(
      existingReadyProfile,
      activePlan.plan,
    );

    expect(checks).toHaveLength(5);
    expect(checks.every((check) => check.passed)).toBe(true);
    expect(checks.map((check) => check.key)).toEqual([
      "energy",
      "protein",
      "macros",
      "fiber",
      "plan_rules",
    ]);
  });

  it("uses one decision model for the evidence gate, goal band and drift guard", () => {
    const activePlan = {
      ...createExistingActivePlan(now),
      maintenanceReferenceWeightKg: 75,
    };
    const insufficient = evaluateWeightAdjustmentDecision({
      goal: "maintenance",
      measurements: flatMeasurements(75.8, 10),
      activePlan,
      now,
    });
    const sustainedDrift = evaluateWeightAdjustmentDecision({
      goal: "maintenance",
      measurements: flatMeasurements(75.8),
      activePlan,
      now,
    });

    expect(insufficient).toMatchObject({
      status: "insufficient_evidence",
      adjustmentKcal: null,
    });
    expect(sustainedDrift).toMatchObject({
      status: "adjustment_available",
      reason: "maintenance_drift_above",
      direction: "decrease",
      adjustmentKcal: 150,
    });
  });

  it.each([
    ["fat_loss", -0.0285714286, "decrease", "rate_above_band"],
    ["muscle_gain", 0, "increase", "rate_below_band"],
  ] as const)(
    "evaluates the %s rate with the same generic decision model",
    (goal, slope, direction, reason) => {
      const decision = evaluateWeightAdjustmentDecision({
        goal,
        measurements: slopedMeasurements(slope),
        activePlan: createExistingActivePlan(now),
        now,
      });

      expect(decision).toMatchObject({
        status: "adjustment_available",
        direction,
        reason,
      });
    },
  );

  it("keeps a stable Maintenance plan when rate and drift are in range", () => {
    const activePlan = {
      ...createExistingActivePlan(now),
      maintenanceReferenceWeightKg: 75,
    };
    const decision = evaluateWeightAdjustmentDecision({
      goal: "maintenance",
      measurements: flatMeasurements(75),
      activePlan,
      now,
    });

    expect(decision).toMatchObject({
      status: "keep_plan",
      reason: "within_goal_band",
      direction: null,
      adjustmentKcal: null,
    });
  });

  it("renders progressive disclosure, formulas, sources and plan checks", async () => {
    const user = userEvent.setup();
    const activePlan = createExistingActivePlan(now);
    render(
      <NutritionTransparencyPanel
        plan={activePlan.plan}
        profile={existingReadyProfile}
        targetSnapshot={activePlan.plan.targetSnapshot}
      />,
    );

    expect(
      screen.getByRole("article", { name: "How your nutrition plan works" }),
    ).toBeInTheDocument();
    expect(screen.getByText("5/5 checks passed")).toBeInTheDocument();
    await user.click(screen.getByText("Estimated daily energy needs"));
    expect(screen.getByText(/581\.47/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: /Dietary Reference Intakes for Energy, 2023/,
      }),
    ).toHaveAttribute("href", "https://www.ncbi.nlm.nih.gov/books/NBK591034/");
  });

  it("renders a readable weight decision without presenting a single weigh-in as evidence", () => {
    const activePlan = createExistingActivePlan(now);
    const decision = evaluateWeightAdjustmentDecision({
      goal: "maintenance",
      measurements: flatMeasurements(75, 10),
      activePlan,
      now,
    });
    render(<WeightDecisionPanel decision={decision} />);

    expect(
      screen.getByText("More data is needed before changing the plan."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("10/28 qualifying measurements are available."),
    ).toBeInTheDocument();
    expect(screen.getByText("Not evaluated")).toBeInTheDocument();
  });
});
