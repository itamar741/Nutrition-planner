import type { WeightMeasurement, WeightTrend } from "@/domain/weight/trend";
import styles from "./CoachWorkspace.module.css";

const WIDTH = 680;
const HEIGHT = 250;
const PADDING = { top: 22, right: 22, bottom: 32, left: 46 };

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
  }).format(new Date(`${date}T12:00:00Z`));
}

export function WeightTrendChart({
  measurements,
  trend,
  onSelect,
}: {
  measurements: WeightMeasurement[];
  trend: WeightTrend;
  onSelect: (measurement: WeightMeasurement) => void;
}) {
  const ordered = [...measurements].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  if (ordered.length === 0) {
    return <div className={styles.chartEmpty}>No weights recorded yet.</div>;
  }
  const values = ordered.map((item) => item.weightKg);
  const low = Math.floor((Math.min(...values) - 0.5) * 2) / 2;
  const high = Math.ceil((Math.max(...values) + 0.5) * 2) / 2;
  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const xFor = (index: number) =>
    PADDING.left +
    (ordered.length === 1
      ? plotWidth / 2
      : (index / (ordered.length - 1)) * plotWidth);
  const yFor = (weight: number) =>
    PADDING.top + ((high - weight) / Math.max(high - low, 0.1)) * plotHeight;
  const pointPath = ordered
    .map(
      (item, index) =>
        `${index === 0 ? "M" : "L"}${xFor(index)},${yFor(item.weightKg)}`,
    )
    .join(" ");
  const trendStartIndex = Math.max(0, ordered.length - trend.measurementCount);
  const trendPath =
    trend.evidence === "sufficient"
      ? ordered
          .slice(trendStartIndex)
          .map((_, index) => {
            const value =
              trend.meanWeightKg +
              trend.slopeKgPerDay * (index - (trend.measurementCount - 1) / 2);
            const pointIndex = index + trendStartIndex;
            return `${index === 0 ? "M" : "L"}${xFor(pointIndex)},${yFor(value)}`;
          })
          .join(" ")
      : null;
  const ticks = [low, (low + high) / 2, high];
  return (
    <div className={styles.chartWrap}>
      <svg
        aria-label="Weight history chart"
        className={styles.weightChart}
        role="img"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              className={styles.chartGrid}
              x1={PADDING.left}
              x2={WIDTH - PADDING.right}
              y1={yFor(tick)}
              y2={yFor(tick)}
            />
            <text
              className={styles.chartLabel}
              textAnchor="end"
              x={PADDING.left - 8}
              y={yFor(tick) + 4}
            >
              {tick.toFixed(1)}
            </text>
          </g>
        ))}
        <path className={styles.chartLine} d={pointPath} fill="none" />
        {trendPath ? (
          <path className={styles.chartTrendLine} d={trendPath} fill="none" />
        ) : null}
        {ordered.map((item, index) => (
          <circle
            aria-label={`Edit ${item.date}, ${item.weightKg.toFixed(1)} kilograms`}
            className={styles.chartPoint}
            cx={xFor(index)}
            cy={yFor(item.weightKg)}
            key={item.id}
            onClick={() => onSelect(item)}
            r={5}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(item);
              }
            }}
          />
        ))}
        <text
          className={styles.chartLabel}
          textAnchor="start"
          x={PADDING.left}
          y={HEIGHT - 8}
        >
          {formatDate(ordered[0].date)}
        </text>
        <text
          className={styles.chartLabel}
          textAnchor="end"
          x={WIDTH - PADDING.right}
          y={HEIGHT - 8}
        >
          {formatDate(ordered[ordered.length - 1].date)}
        </text>
      </svg>
      <p className={styles.chartHint}>
        Select a point to edit that day&apos;s weight.
      </p>
    </div>
  );
}
