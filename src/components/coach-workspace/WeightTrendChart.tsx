import {
  formatWeightKg,
  normalizeWeightKg,
  type WeightMeasurement,
  type WeightTrend,
} from "@/domain/weight/trend";
import {
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
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

function formatFullDate(date: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
}

type PointOverlay = {
  measurement: WeightMeasurement;
  x: number;
  y: number;
  placeBelow: boolean;
};

function pointOverlay(
  measurement: WeightMeasurement,
  point: SVGCircleElement,
): PointOverlay {
  const pointBounds = point.getBoundingClientRect();
  const chartBounds =
    point.ownerSVGElement?.parentElement?.getBoundingClientRect();
  const rawX =
    pointBounds.left + pointBounds.width / 2 - (chartBounds?.left ?? 0);
  const chartWidth = chartBounds?.width ?? 0;
  const halfEditorWidth = Math.min(130, Math.max(0, (chartWidth - 16) / 2));
  const x = Math.max(
    halfEditorWidth + 8,
    Math.min(rawX, chartWidth - halfEditorWidth - 8),
  );
  const y = pointBounds.top + pointBounds.height / 2 - (chartBounds?.top ?? 0);
  return { measurement, x, y, placeBelow: y < 90 };
}

function overlayStyle(overlay: PointOverlay): CSSProperties {
  return {
    "--chart-point-x": `${overlay.x}px`,
    "--chart-point-y": `${overlay.y}px`,
  } as CSSProperties;
}

export function WeightTrendChart({
  measurements,
  trend,
  onEdit,
  onDelete,
  disabled = false,
  footer,
}: {
  measurements: WeightMeasurement[];
  trend: WeightTrend;
  onEdit: (date: string, weightKg: number) => void;
  onDelete: (date: string) => void;
  disabled?: boolean;
  footer?: ReactNode;
}) {
  const [hovered, setHovered] = useState<PointOverlay | null>(null);
  const [editing, setEditing] = useState<PointOverlay | null>(null);
  const [editingWeight, setEditingWeight] = useState("");
  const [editError, setEditError] = useState("");
  const ordered = [...measurements].sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  if (ordered.length === 0) {
    return (
      <div className={styles.chartWrap}>
        <div className={styles.chartEmpty}>No weights recorded yet.</div>
        <div className={styles.chartFooter}>{footer}</div>
      </div>
    );
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

  function openEditor(measurement: WeightMeasurement, point: SVGCircleElement) {
    if (disabled) return;
    setEditing(pointOverlay(measurement, point));
    setEditingWeight(formatWeightKg(measurement.weightKg));
    setEditError("");
    setHovered(null);
  }

  function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || disabled) return;
    try {
      const weightKg = normalizeWeightKg(Number(editingWeight));
      onEdit(editing.measurement.date, weightKg);
      setEditing(null);
      setEditError("");
    } catch (error) {
      setEditError(
        error instanceof Error ? error.message : "Enter a valid weight.",
      );
    }
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    setEditing(null);
    setEditError("");
  }

  return (
    <div className={styles.chartWrap}>
      <div className={styles.chartCanvas}>
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
                {formatWeightKg(tick)}
              </text>
            </g>
          ))}
          <path className={styles.chartLine} d={pointPath} fill="none" />
          {trendPath ? (
            <path className={styles.chartTrendLine} d={trendPath} fill="none" />
          ) : null}
          {ordered.map((item, index) => {
            const active =
              hovered?.measurement.id === item.id ||
              editing?.measurement.id === item.id;
            return (
              <g key={item.id}>
                <circle
                  className={`${styles.chartPoint} ${active ? styles.chartPointActive : ""}`}
                  cx={xFor(index)}
                  cy={yFor(item.weightKg)}
                  r={active ? 7 : 5}
                />
                <circle
                  aria-disabled={disabled}
                  aria-label={`Edit ${formatFullDate(item.date)}, ${formatWeightKg(item.weightKg)} kilograms`}
                  className={styles.chartPointHitArea}
                  cx={xFor(index)}
                  cy={yFor(item.weightKg)}
                  onBlur={() => setHovered(null)}
                  onClick={(event) => openEditor(item, event.currentTarget)}
                  onFocus={(event) =>
                    setHovered(pointOverlay(item, event.currentTarget))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openEditor(item, event.currentTarget);
                    }
                  }}
                  onMouseEnter={(event) =>
                    setHovered(pointOverlay(item, event.currentTarget))
                  }
                  onMouseLeave={() => setHovered(null)}
                  r={14}
                  role="button"
                  tabIndex={disabled ? -1 : 0}
                />
              </g>
            );
          })}
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
        {hovered && !editing ? (
          <div
            className={`${styles.chartTooltip} ${hovered.placeBelow ? styles.chartOverlayBelow : ""}`}
            role="tooltip"
            style={overlayStyle(hovered)}
          >
            <strong>{formatFullDate(hovered.measurement.date)}</strong>
            <span>{formatWeightKg(hovered.measurement.weightKg)} kg</span>
          </div>
        ) : null}
        {editing ? (
          <form
            aria-label={`Edit weight for ${formatFullDate(editing.measurement.date)}`}
            className={`${styles.chartEditor} ${editing.placeBelow ? styles.chartOverlayBelow : ""}`}
            onKeyDown={handleEditorKeyDown}
            onSubmit={saveEdit}
            role="dialog"
            style={overlayStyle(editing)}
          >
            <strong>{formatFullDate(editing.measurement.date)}</strong>
            <label htmlFor={`chart-weight-${editing.measurement.id}`}>
              Weight (kg)
            </label>
            <input
              aria-label="Replacement weight in kilograms"
              autoFocus
              disabled={disabled}
              id={`chart-weight-${editing.measurement.id}`}
              inputMode="decimal"
              min="1"
              onChange={(event) => setEditingWeight(event.target.value)}
              step="0.01"
              type="number"
              value={editingWeight}
            />
            {editError ? <small role="alert">{editError}</small> : null}
            <div>
              <button
                aria-label="Save replacement"
                className={styles.primaryAction}
                disabled={disabled}
                type="submit"
              >
                Save
              </button>
              <button
                className={styles.secondaryAction}
                disabled={disabled}
                onClick={() => {
                  setEditing(null);
                  setEditError("");
                }}
                type="button"
              >
                Cancel
              </button>
              <button
                className={styles.chartDeleteAction}
                disabled={disabled}
                onClick={() => {
                  onDelete(editing.measurement.date);
                  setEditing(null);
                  setEditError("");
                }}
                type="button"
              >
                Delete
              </button>
            </div>
          </form>
        ) : null}
      </div>
      <div className={styles.chartFooter}>
        <p className={styles.chartHint}>
          Hover for details. Select a point to edit that day&apos;s weight.
        </p>
        {footer}
      </div>
    </div>
  );
}
