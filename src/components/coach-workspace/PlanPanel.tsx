import { foodCatalog } from "@/data/food-catalog";
import type { CatalogFood } from "@/domain/catalog/types";
import type { ActivePlan, DraftProposal } from "@/domain/plan/types";
import type { NutritionTargets } from "@/domain/profile/types";
import styles from "./CoachWorkspace.module.css";

function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
  }).format(value);
}

export function PlanContents({
  proposal,
  catalog = foodCatalog,
}: {
  proposal: DraftProposal;
  catalog?: readonly CatalogFood[];
}) {
  const catalogById = new Map(catalog.map((food) => [food.id, food]));
  const totals = proposal.plan.validation.totals;
  return (
    <>
      <div className={styles.nutritionStrip}>
        <span>
          <strong>{formatNumber(totals.energyKcal)}</strong> kcal
        </span>
        <span>
          <strong>{formatNumber(totals.proteinG)}</strong> g protein
        </span>
        <span>
          <strong>{formatNumber(totals.fiberG, 1)}</strong> g fiber
        </span>
      </div>
      <div className={styles.planMeals}>
        {proposal.plan.meals.map((meal) => (
          <section className={styles.planMeal} key={meal.id}>
            <h4>{meal.name}</h4>
            <ul>
              {meal.items.map((item) => {
                const food = catalogById.get(item.catalogFoodId);
                return (
                  <li key={item.id}>
                    <span>{food?.displayName ?? item.catalogFoodId}</span>
                    <strong>{item.grams} g</strong>
                    {item.alternatives.length > 0 ? (
                      <small>
                        Or:{" "}
                        {item.alternatives
                          .map((alternative) => {
                            const alternativeFood = catalogById.get(
                              alternative.catalogFoodId,
                            );
                            return `${alternativeFood?.displayName ?? alternative.catalogFoodId} ${alternative.grams} g`;
                          })
                          .join(" · ")}
                      </small>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

export function PlanPanel({
  draft,
  activePlan,
  targets,
  disabled,
  onApprove,
  onReject,
  catalog = foodCatalog,
}: {
  draft: DraftProposal | null;
  activePlan: ActivePlan | null;
  targets: NutritionTargets | null;
  disabled: boolean;
  onApprove: () => void;
  onReject: () => void;
  catalog?: readonly CatalogFood[];
}) {
  if (draft) {
    return (
      <article className={`${styles.planCard} ${styles.draftCard}`}>
        <div className={styles.planTitleRow}>
          <div>
            <span className={styles.draftBadge}>Draft Meal Plan</span>
            <h3>Review before anything changes.</h3>
          </div>
          <span className={styles.validBadge}>Validated</span>
        </div>
        <p className={styles.planSummary}>{draft.summary}</p>
        <PlanContents catalog={catalog} proposal={draft} />
        {activePlan ? (
          <p className={styles.planNotice}>
            Your current Active Plan remains unchanged while this Draft is
            pending.
          </p>
        ) : (
          <p className={styles.planNotice}>
            You do not have an Active Plan yet. This Draft has no effect until
            approval.
          </p>
        )}
        <div className={styles.approvalActions}>
          <button
            className={styles.primaryAction}
            disabled={disabled}
            onClick={onApprove}
            type="button"
          >
            Approve &amp; activate
          </button>
          <button
            className={styles.secondaryAction}
            disabled={disabled}
            onClick={onReject}
            type="button"
          >
            Decline Draft
          </button>
        </div>
      </article>
    );
  }

  if (activePlan) {
    const proposal: DraftProposal = {
      schemaVersion: 1,
      id: `active-${activePlan.version}`,
      basePlanVersion: activePlan.version,
      reason: "initial",
      summary: "Your approved repeatable day.",
      plan: activePlan.plan,
    };
    return (
      <article className={`${styles.planCard} ${styles.activeCard}`}>
        <div className={styles.planTitleRow}>
          <div>
            <span className={styles.activeBadge}>Active Plan</span>
            <h3>Your approved daily plan.</h3>
          </div>
          <span className={styles.planVersion}>v{activePlan.version}</span>
        </div>
        <PlanContents catalog={catalog} proposal={proposal} />
        <p className={styles.planNotice}>
          Active after your explicit approval. Weight-based adjustments arrive
          only in Turn 3.
        </p>
      </article>
    );
  }

  return (
    <article className={styles.planEmpty}>
      <span>{targets ? "Targets ready" : "No plan yet"}</span>
      <h3>
        {targets
          ? `${formatNumber(targets.energyKcal)} kcal daily target`
          : "Your Draft will appear here."}
      </h3>
      <p>
        {targets
          ? `Protein target ${formatNumber(targets.proteinTargetG)} g · fiber minimum ${formatNumber(targets.fiberMinimumG, 1)} g. Generate a Draft when ready.`
          : "Complete onboarding and food selection first. Nothing becomes Active without your explicit approval."}
      </p>
    </article>
  );
}
