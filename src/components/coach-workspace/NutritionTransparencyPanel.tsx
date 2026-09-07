import {
  buildNutritionExplanation,
  NUTRITION_EXPLANATION_SOURCES,
  type ExplanationSource,
} from "@/domain/nutrition/explanations";
import {
  buildPlanValidationExplanation,
  type PlanValidationExplanationCheck,
} from "@/domain/plan/validation";
import type { MealPlan } from "@/domain/plan/types";
import type {
  NutritionTargets,
  StructuredProfile,
} from "@/domain/profile/types";
import type { WeightAdjustmentDecision } from "@/domain/weight/decision";
import styles from "./CoachWorkspace.module.css";

function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
  }).format(value);
}

function formatSigned(value: number, digits = 2) {
  const formatted = formatNumber(Math.abs(value), digits);
  return value > 0 ? `+${formatted}` : value < 0 ? `−${formatted}` : formatted;
}

function SourceLinks({ sources }: { sources: ExplanationSource[] }) {
  return (
    <div className={styles.explanationSources}>
      <span>Sources</span>
      {sources.map((source) => (
        <a href={source.url} key={source.id} rel="noreferrer" target="_blank">
          {source.label}
        </a>
      ))}
    </div>
  );
}

function ValidationCheck({ check }: { check: PlanValidationExplanationCheck }) {
  return (
    <li className={styles.validationCheck}>
      <span
        aria-label={check.passed ? "Passed" : "Needs revision"}
        className={check.passed ? styles.checkPassed : styles.checkFailed}
      >
        {check.passed ? "✓" : "!"}
      </span>
      <div>
        <strong>{check.label}</strong>
        <p>{check.actual}</p>
        <small>Expected: {check.expected}</small>
      </div>
    </li>
  );
}

export function NutritionTransparencyPanel({
  profile,
  targetSnapshot,
  plan,
}: {
  profile: StructuredProfile;
  targetSnapshot: NutritionTargets;
  plan: MealPlan | null;
}) {
  const explanation = buildNutritionExplanation(profile, targetSnapshot);
  if (!explanation) return null;
  const validationChecks = plan
    ? buildPlanValidationExplanation(profile, plan)
    : [];
  const passedChecks = validationChecks.filter((check) => check.passed).length;
  const goalAdjustment = explanation.goalAdjustmentPercent;

  return (
    <article
      aria-label="How your nutrition plan works"
      className={styles.transparencyPanel}
    >
      <header className={styles.transparencyHeader}>
        <div>
          <p className={styles.kicker}>Behind your plan</p>
          <h3>How your nutrition plan works</h3>
        </div>
        {validationChecks.length > 0 ? (
          <span className={styles.transparencyValidated}>
            {passedChecks}/{validationChecks.length} checks passed
          </span>
        ) : null}
      </header>
      <p className={styles.transparencyIntro}>
        Follow the calculation from your profile to the target and the checks
        applied to your meal plan.
      </p>

      <div className={styles.decisionJourney}>
        <span>
          <small>Energy estimate</small>
          <strong>{formatNumber(explanation.rawEerKcal)} kcal</strong>
        </span>
        <span>
          <small>{explanation.goalLabel}</small>
          <strong>
            {goalAdjustment === 0
              ? "No adjustment"
              : `${formatSigned(goalAdjustment, 0)}%`}
          </strong>
        </span>
        <span>
          <small>Current target</small>
          <strong>{formatNumber(explanation.currentTargetKcal)} kcal</strong>
        </span>
      </div>

      <div className={styles.explanationSteps}>
        <details>
          <summary>
            <span>1</span>
            <div>
              <strong>Estimated daily energy needs</strong>
              <small>{explanation.activity.palLabel} activity basis</small>
            </div>
            <b>{formatNumber(explanation.rawEerKcal)} kcal</b>
          </summary>
          <div className={styles.explanationBody}>
            <p>
              Your {explanation.activity.routineLabel} routine scores{" "}
              {explanation.activity.routineScore}.{" "}
              {formatNumber(explanation.activity.moderateEquivalentMinutes)}{" "}
              weekly moderate-equivalent exercise minutes score{" "}
              {explanation.activity.exerciseScore}. Together, score{" "}
              {explanation.activity.totalScore} maps to{" "}
              <strong>{explanation.activity.palLabel}</strong>.
            </p>
            <code>{explanation.energyFormula}</code>
            <p>
              EER is a research-based starting estimate of daily energy needs,
              often called maintenance calories or TDEE in fitness apps. It is
              not a direct measurement of your metabolism.
            </p>
            <SourceLinks sources={explanation.energySources} />
          </div>
        </details>

        <details>
          <summary>
            <span>2</span>
            <div>
              <strong>Adjusted for {explanation.goalLabel}</strong>
              <small>Goal rule and controlled rounding</small>
            </div>
            <b>{formatNumber(explanation.baseGoalTargetKcal)} kcal</b>
          </summary>
          <div className={styles.explanationBody}>
            <p>
              {goalAdjustment < 0
                ? `The project starts with a moderate ${Math.abs(goalAdjustment)}% energy deficit.`
                : goalAdjustment > 0
                  ? `The project starts with a conservative ${goalAdjustment}% energy surplus.`
                  : "Maintenance starts from the estimated energy requirement without a goal surplus or deficit."}
            </p>
            <code>{explanation.goalFormula}</code>
            {explanation.adjustmentNote ? (
              <p className={styles.adjustmentNote}>
                {explanation.adjustmentNote}
              </p>
            ) : null}
            <SourceLinks sources={explanation.goalSources} />
          </div>
        </details>

        <details>
          <summary>
            <span>3</span>
            <div>
              <strong>Daily nutrition targets</strong>
              <small>Protein, carbohydrate, fat and fiber</small>
            </div>
            <b>{explanation.nutrientTargets.length} targets</b>
          </summary>
          <div className={styles.explanationBody}>
            <div className={styles.nutrientExplanationGrid}>
              {explanation.nutrientTargets.map((target) => (
                <section key={target.key}>
                  <small>{target.label}</small>
                  <strong>
                    {target.minimum ? "≥ " : ""}
                    {formatNumber(target.value, 1)} g
                  </strong>
                  <code>{target.formula}</code>
                </section>
              ))}
            </div>
            <p>
              These are planning targets. The completed plan is checked against
              goal-specific protein limits, age-appropriate macro ranges and a
              fiber minimum.
            </p>
            <SourceLinks sources={explanation.nutrientSources} />
          </div>
        </details>

        {plan ? (
          <details>
            <summary>
              <span>4</span>
              <div>
                <strong>How this plan was checked</strong>
                <small>Actual totals compared with deterministic rules</small>
              </div>
              <b>
                {passedChecks}/{validationChecks.length} passed
              </b>
            </summary>
            <div className={styles.explanationBody}>
              <ul className={styles.validationChecks}>
                {validationChecks.map((check) => (
                  <ValidationCheck check={check} key={check.key} />
                ))}
              </ul>
              <p>
                A plan cannot become Active from model text alone. It must pass
                deterministic validation and then receive explicit approval.
              </p>
            </div>
          </details>
        ) : null}
      </div>
    </article>
  );
}

function evidenceCopy(decision: WeightAdjustmentDecision) {
  if (decision.trend.evidenceReason === "active_plan_changed") {
    return "The evidence window restarted because the Active Plan changed.";
  }
  if (decision.trend.evidenceReason === "not_enough_measurements") {
    return `${decision.trend.measurementCount}/28 qualifying measurements are available.`;
  }
  return `Measurements currently span ${formatNumber(decision.trend.spanDays)}/28 required days.`;
}

function decisionCopy(decision: WeightAdjustmentDecision) {
  if (decision.status === "insufficient_evidence") {
    return {
      title: "More data is needed before changing the plan.",
      body: evidenceCopy(decision),
    };
  }
  if (decision.status === "keep_plan") {
    return {
      title: "Your Active Plan stays the same.",
      body: "The measured rate is inside the goal band and no sustained Maintenance drift requires action.",
    };
  }
  const direction = decision.direction === "increase" ? "increase" : "decrease";
  const reason = decision.reason.startsWith("maintenance_drift")
    ? "two consecutive seven-measurement averages crossed the Maintenance drift guard"
    : "the measured weekly rate is outside the goal band";
  return {
    title: `A ${direction} of ${decision.adjustmentKcal} kcal/day is available.`,
    body: `Deterministic rules allow this direction because ${reason}.`,
  };
}

export function WeightDecisionPanel({
  decision,
}: {
  decision: WeightAdjustmentDecision;
}) {
  const copy = decisionCopy(decision);
  const sufficient = decision.trend.evidence === "sufficient";
  const drift = decision.maintenanceDrift;
  return (
    <article
      aria-label="Why your Active Plan stays or changes"
      className={styles.weightDecisionPanel}
    >
      <p className={styles.kicker}>The decision behind the chart</p>
      <h3>{copy.title}</h3>
      <p>{copy.body}</p>
      <div className={styles.weightDecisionStats}>
        <span>
          <strong>{decision.trend.measurementCount}</strong>
          measurements in the 35-day window
        </span>
        <span>
          <strong>{formatNumber(decision.trend.spanDays)} days</strong>
          measurement span
        </span>
        <span>
          <strong>
            {sufficient
              ? `${formatSigned(decision.trend.weeklyPercent)}%`
              : "Not evaluated"}
          </strong>
          measured weekly rate
        </span>
        <span>
          <strong>
            {formatSigned(decision.goalBand.minimum)}% to{" "}
            {formatSigned(decision.goalBand.maximum)}%
          </strong>
          goal band
        </span>
      </div>
      <details className={styles.weightDecisionDetails}>
        <summary>How this decision was made</summary>
        <div className={styles.explanationBody}>
          <p>
            Evidence requires at least 28 unique measurements spanning at least
            28 days under the same Active Plan. The weekly rate comes from a
            regression across qualifying measurements, not from one weigh-in.
          </p>
          {drift?.referenceWeightKg !== null &&
          drift?.referenceWeightKg !== undefined ? (
            <p>
              Maintenance reference: {formatNumber(drift.referenceWeightKg, 2)}
              {" kg"}. Recent seven-measurement averages:{" "}
              {drift.precedingAverageKg === null
                ? "not ready"
                : `${formatNumber(drift.precedingAverageKg, 2)} kg`}{" "}
              and{" "}
              {drift.latestAverageKg === null
                ? "not ready"
                : `${formatNumber(drift.latestAverageKg, 2)} kg`}
              .
            </p>
          ) : null}
          <p>
            An available adjustment only permits a bounded proposal. The Active
            Plan changes only after the exact proposal is approved.
          </p>
          <SourceLinks
            sources={[
              NUTRITION_EXPLANATION_SOURCES.weightEvidence,
              NUTRITION_EXPLANATION_SOURCES.weightVariability,
            ]}
          />
        </div>
      </details>
    </article>
  );
}
