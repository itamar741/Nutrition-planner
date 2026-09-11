export interface WeightMeasurement {
  id: string;
  date: string;
  weightKg: number;
  commandId: string;
}

export interface WeightTrend {
  measurementCount: number;
  spanDays: number;
  meanWeightKg: number;
  slopeKgPerDay: number;
  weeklyKg: number;
  weeklyPercent: number;
  evidence: "sufficient" | "insufficient";
  evidenceReason:
    | "enough_data"
    | "not_enough_measurements"
    | "not_enough_span"
    | "active_plan_changed";
}

const MS_PER_DAY = 86_400_000;
export const MAINTENANCE_SUSTAINED_DRIFT_KG = 0.7;
export const CURRENT_WEIGHT_AVERAGE_SAMPLE_SIZE = 7;

export interface MaintenanceWeightDrift {
  referenceWeightKg: number | null;
  latestAverageKg: number | null;
  precedingAverageKg: number | null;
  direction: "increase" | "decrease" | null;
}

function chronologicalUniqueMeasurements(measurements: WeightMeasurement[]) {
  const valid = measurements
    .filter((item) => Number.isFinite(Date.parse(item.date)))
    .sort((a, b) => a.date.localeCompare(b.date));
  return [...new Map(valid.map((item) => [item.date, item])).values()];
}

function averageWeightKg(measurements: WeightMeasurement[]) {
  if (measurements.length === 0) return null;
  return (
    measurements.reduce((sum, measurement) => sum + measurement.weightKg, 0) /
    measurements.length
  );
}

export function maintenanceReferenceWeightFromRecentMeasurements(
  measurements: WeightMeasurement[],
) {
  return averageWeightKg(
    chronologicalUniqueMeasurements(measurements).slice(
      -CURRENT_WEIGHT_AVERAGE_SAMPLE_SIZE,
    ),
  );
}

export function maintenanceReferenceWeightFromInitialMeasurements(
  measurements: WeightMeasurement[],
) {
  return chronologicalUniqueMeasurements(measurements)[0]?.weightKg ?? null;
}

/**
 * The body weight used for a new gaining or loss plan. A full week smooths
 * day-to-day water fluctuations; until then, the most recent measurement is
 * the only honest current signal.
 */
export function currentPlanWeightFromMeasurements(
  measurements: WeightMeasurement[],
) {
  const ordered = chronologicalUniqueMeasurements(measurements);
  const recent = ordered.slice(-CURRENT_WEIGHT_AVERAGE_SAMPLE_SIZE);
  if (recent.length < CURRENT_WEIGHT_AVERAGE_SAMPLE_SIZE) {
    return ordered.at(-1)?.weightKg ?? null;
  }
  return averageWeightKg(recent);
}

export function calculateMaintenanceWeightDrift(input: {
  measurements: WeightMeasurement[];
  referenceWeightKg: number | null;
}): MaintenanceWeightDrift {
  const ordered = chronologicalUniqueMeasurements(input.measurements);
  const latest = ordered.slice(-CURRENT_WEIGHT_AVERAGE_SAMPLE_SIZE);
  const preceding = ordered.slice(
    -CURRENT_WEIGHT_AVERAGE_SAMPLE_SIZE * 2,
    -CURRENT_WEIGHT_AVERAGE_SAMPLE_SIZE,
  );
  const latestAverageKg = averageWeightKg(latest);
  const precedingAverageKg = averageWeightKg(preceding);
  if (
    input.referenceWeightKg === null ||
    latest.length < CURRENT_WEIGHT_AVERAGE_SAMPLE_SIZE ||
    preceding.length < CURRENT_WEIGHT_AVERAGE_SAMPLE_SIZE ||
    latestAverageKg === null ||
    precedingAverageKg === null
  ) {
    return {
      referenceWeightKg: input.referenceWeightKg,
      latestAverageKg,
      precedingAverageKg,
      direction: null,
    };
  }
  const aboveReference =
    latestAverageKg - input.referenceWeightKg >=
      MAINTENANCE_SUSTAINED_DRIFT_KG &&
    precedingAverageKg - input.referenceWeightKg >=
      MAINTENANCE_SUSTAINED_DRIFT_KG;
  const belowReference =
    input.referenceWeightKg - latestAverageKg >=
      MAINTENANCE_SUSTAINED_DRIFT_KG &&
    input.referenceWeightKg - precedingAverageKg >=
      MAINTENANCE_SUSTAINED_DRIFT_KG;
  return {
    referenceWeightKg: input.referenceWeightKg,
    latestAverageKg,
    precedingAverageKg,
    direction: aboveReference ? "decrease" : belowReference ? "increase" : null,
  };
}

export function formatWeightKg(value: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
    useGrouping: false,
  }).format(value);
}

export function normalizeWeightKg(value: number, unit: "kg" | "lb" = "kg") {
  if (!Number.isFinite(value) || value <= 0 || value > 500) {
    throw new Error("Enter a valid positive weight.");
  }
  return unit === "lb" ? value * 0.45359237 : value;
}

export function calculateWeightTrend(
  measurements: WeightMeasurement[],
  input: { now?: Date; activePlanActivatedAt?: string } = {},
): WeightTrend {
  const now = input.now ?? new Date();
  const recent = chronologicalUniqueMeasurements(measurements)
    .filter((item) => now.getTime() - Date.parse(item.date) <= 35 * MS_PER_DAY)
    .sort((a, b) => a.date.localeCompare(b.date));
  const unique = recent;
  const first = unique[0];
  const last = unique[unique.length - 1];
  const spanDays =
    first && last
      ? (Date.parse(last.date) - Date.parse(first.date)) / MS_PER_DAY
      : 0;
  const meanWeightKg = unique.length
    ? unique.reduce((sum, item) => sum + item.weightKg, 0) / unique.length
    : 0;
  const windowStart = new Date(now.getTime() - 35 * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
  const activationDate = input.activePlanActivatedAt?.slice(0, 10);
  const activePlanChanged = Boolean(
    activationDate &&
    activationDate >= windowStart &&
    activationDate <= now.toISOString().slice(0, 10),
  );
  if (unique.length < 28 || spanDays < 28 || activePlanChanged) {
    return {
      measurementCount: unique.length,
      spanDays,
      meanWeightKg,
      slopeKgPerDay: 0,
      weeklyKg: 0,
      weeklyPercent: 0,
      evidence: "insufficient",
      evidenceReason: activePlanChanged
        ? "active_plan_changed"
        : unique.length < 28
          ? "not_enough_measurements"
          : "not_enough_span",
    };
  }
  const origin = Date.parse(first.date) / MS_PER_DAY;
  const xs = unique.map((item) => Date.parse(item.date) / MS_PER_DAY - origin);
  const ys = unique.map((item) => item.weightKg);
  const xMean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const yMean = ys.reduce((a, b) => a + b, 0) / ys.length;
  const numerator = xs.reduce(
    (sum, x, i) => sum + (x - xMean) * (ys[i] - yMean),
    0,
  );
  const denominator = xs.reduce((sum, x) => sum + (x - xMean) ** 2, 0);
  const slopeKgPerDay = denominator ? numerator / denominator : 0;
  const weeklyKg = slopeKgPerDay * 7;
  return {
    measurementCount: unique.length,
    spanDays,
    meanWeightKg,
    slopeKgPerDay,
    weeklyKg,
    weeklyPercent: (weeklyKg / meanWeightKg) * 100,
    evidence: "sufficient",
    evidenceReason: "enough_data",
  };
}

export function parseCurrentWeightMessage(message: string): number | null {
  const match = message
    .trim()
    .match(/^(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:kg|ק["׳']?ג)?$/i);
  if (!match) return null;
  try {
    return normalizeWeightKg(Number(match[1].replace(",", ".")));
  } catch {
    return null;
  }
}

export function adjustmentDirection(
  goal: "fat_loss" | "maintenance" | "muscle_gain",
  weeklyPercent: number,
): "increase" | "decrease" | null {
  if (goal === "fat_loss")
    return weeklyPercent > -0.5
      ? "decrease"
      : weeklyPercent < -1
        ? "increase"
        : null;
  if (goal === "muscle_gain")
    return weeklyPercent < 0.25
      ? "increase"
      : weeklyPercent > 0.5
        ? "decrease"
        : null;
  return weeklyPercent > 0.25
    ? "decrease"
    : weeklyPercent < -0.25
      ? "increase"
      : null;
}
