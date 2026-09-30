import { randomUUID } from "node:crypto";
import type {
  DraftAttemptReview,
  PlanChangeWorkflow,
} from "@/domain/agent/types";
import type { DraftCandidate } from "@/domain/plan/types";
import type { PersistedDemoState } from "@/persistence/repository";

export function startPlanChange(
  state: PersistedDemoState,
  input: Partial<PlanChangeWorkflow> = {},
): PlanChangeWorkflow {
  return {
    id: randomUUID(),
    status: "ready_for_draft",
    sourceMessageId: null,
    requestEvidence: null,
    mode: state.draft
      ? "revise_pending"
      : state.activePlan
        ? "replace_active"
        : "create_initial",
    basePlanVersion: state.activePlan?.version ?? null,
    baseDraftId: state.draft?.id ?? null,
    requiredCatalogFoodIds: [],
    unresolvedFoodNames: [],
    excludedCatalogFoodIds: [],
    mustDiffer: Boolean(state.activePlan || state.draft),
    scope: "unspecified",
    portionRecalculation: "whole_draft",
    strategy: null,
    offeredAlternativeFoodIds: [],
    selectedAlternativeFoodId: null,
    attemptBatch: 1,
    rejectedDraftAttempts: [],
    currentDraftId: null,
    ...input,
  };
}

export function waitForFoodApproval(workflow: PlanChangeWorkflow) {
  return { ...workflow, status: "awaiting_food_approval" as const };
}

export function resolvePlanChangeFood(
  workflow: PlanChangeWorkflow,
  foodId: string,
) {
  return {
    ...workflow,
    status: "awaiting_draft_confirmation" as const,
    requiredCatalogFoodIds: [foodId],
    unresolvedFoodNames: [],
  };
}

export function makePlanChangeDraftReady(
  workflow: PlanChangeWorkflow,
  input: {
    requiredFoodId?: string | null;
    selectedAlternativeFoodId?: string | null;
    retryStrategy?: PlanChangeWorkflow["strategy"];
  } = {},
) {
  const startsNewAttemptBatch = Boolean(input.retryStrategy);
  return {
    ...workflow,
    status: "ready_for_draft" as const,
    requiredCatalogFoodIds: input.selectedAlternativeFoodId
      ? [input.selectedAlternativeFoodId]
      : input.requiredFoodId
        ? [input.requiredFoodId]
        : workflow.requiredCatalogFoodIds,
    unresolvedFoodNames: input.requiredFoodId
      ? []
      : workflow.unresolvedFoodNames,
    selectedAlternativeFoodId:
      input.selectedAlternativeFoodId ?? workflow.selectedAlternativeFoodId,
    strategy: input.retryStrategy ?? workflow.strategy,
    attemptBatch: startsNewAttemptBatch
      ? workflow.attemptBatch + 1
      : workflow.attemptBatch,
    rejectedDraftAttempts: startsNewAttemptBatch
      ? []
      : workflow.rejectedDraftAttempts,
  };
}

export function recordPlanChangeDraftRejection(
  workflow: PlanChangeWorkflow,
  attempt: DraftAttemptReview,
) {
  const attempts = workflow.rejectedDraftAttempts
    .filter((item) => item.attempt !== attempt.attempt)
    .concat(attempt)
    .sort((left, right) => left.attempt - right.attempt)
    .slice(0, 3);
  return {
    ...workflow,
    status: "ready_for_draft" as const,
    rejectedDraftAttempts: attempts,
  };
}

export function markPlanChangeFailure(workflow: PlanChangeWorkflow) {
  return { ...workflow, status: "failure_review" as const };
}

export function markPlanChangeDraftPending(
  workflow: PlanChangeWorkflow,
  draftId: string,
) {
  return {
    ...workflow,
    status: "draft_pending_approval" as const,
    currentDraftId: draftId,
  };
}

export function retainPlanChangeAfterDraftRejection(
  workflow: PlanChangeWorkflow,
  state: PersistedDemoState,
) {
  return {
    ...workflow,
    status: "ready_for_draft" as const,
    mode: state.activePlan
      ? ("replace_active" as const)
      : ("create_initial" as const),
    baseDraftId: null,
    currentDraftId: null,
    attemptBatch: workflow.attemptBatch + 1,
    rejectedDraftAttempts: [],
  };
}

function gramsByMealAndFood(plan: {
  meals: Array<{
    id: string;
    items: Array<{ catalogFoodId: string; grams: number }>;
  }>;
}) {
  const grams = new Map<string, number>();
  for (const meal of plan.meals) {
    for (const item of meal.items) {
      const key = `${meal.id}:${item.catalogFoodId}`;
      grams.set(key, (grams.get(key) ?? 0) + item.grams);
    }
  }
  return grams;
}

export function hasSamePlanAmounts(
  left: Parameters<typeof gramsByMealAndFood>[0],
  right: Parameters<typeof gramsByMealAndFood>[0],
) {
  const leftAmounts = gramsByMealAndFood(left);
  const rightAmounts = gramsByMealAndFood(right);
  if (leftAmounts.size !== rightAmounts.size) return false;
  return [...leftAmounts.entries()].every(
    ([key, grams]) => rightAmounts.get(key) === grams,
  );
}

export function baselineForPlanChange(
  state: PersistedDemoState,
  workflow: PlanChangeWorkflow | null,
) {
  if (
    workflow?.mode === "revise_pending" &&
    state.draft &&
    workflow.baseDraftId === state.draft.id
  ) {
    return state.draft.plan;
  }
  return state.activePlan?.plan ?? null;
}

function gramsByFood(plan: {
  meals: Array<{ items: Array<{ catalogFoodId: string; grams: number }> }>;
}) {
  const grams = new Map<string, number>();
  for (const meal of plan.meals) {
    for (const item of meal.items) {
      grams.set(
        item.catalogFoodId,
        (grams.get(item.catalogFoodId) ?? 0) + item.grams,
      );
    }
  }
  return grams;
}

function foodIdsOf(plan: {
  meals: Array<{ items: Array<{ catalogFoodId: string }> }>;
}) {
  return new Set(
    plan.meals.flatMap((meal) => meal.items.map((item) => item.catalogFoodId)),
  );
}

function hasSameFoodMix(
  left: Parameters<typeof foodIdsOf>[0],
  right: Parameters<typeof foodIdsOf>[0],
) {
  const leftIds = foodIdsOf(left);
  const rightIds = foodIdsOf(right);
  return (
    leftIds.size === rightIds.size &&
    [...leftIds].every((foodId) => rightIds.has(foodId))
  );
}

function hasUncompensatedRequiredFoodAddition(
  state: PersistedDemoState,
  candidate: DraftCandidate,
  requiredCatalogFoodId: string | null,
) {
  if (!requiredCatalogFoodId || !state.activePlan) return false;
  const before = gramsByFood(state.activePlan.plan);
  const after = gramsByFood(candidate);
  const requiredIncrease =
    (after.get(requiredCatalogFoodId) ?? 0) -
    (before.get(requiredCatalogFoodId) ?? 0);
  if (requiredIncrease <= 0) return false;
  return [...before.entries()]
    .filter(([foodId]) => foodId !== requiredCatalogFoodId)
    .every(
      ([foodId, previousGrams]) => (after.get(foodId) ?? 0) >= previousGrams,
    );
}

export function planChangeCandidateIssues(
  state: PersistedDemoState,
  candidate: DraftCandidate,
) {
  const workflow = state.agentSession.planChange;
  const requiredFoodIds = workflow?.requiredCatalogFoodIds ?? [];
  const excludedFoodIds = workflow?.excludedCatalogFoodIds ?? [];
  const candidateFoodIds = new Set(
    candidate.meals.flatMap((meal) =>
      meal.items.map((item) => item.catalogFoodId),
    ),
  );
  const includesRequiredFood =
    requiredFoodIds.length === 0 ||
    requiredFoodIds.every((foodId) => candidateFoodIds.has(foodId));
  const includedExcludedFoods = excludedFoodIds.filter((foodId) =>
    candidateFoodIds.has(foodId),
  );
  const baseline = baselineForPlanChange(state, workflow);
  const differsFromBaseline =
    !workflow?.mustDiffer ||
    !baseline ||
    !hasSamePlanAmounts(baseline, candidate);
  const usesDifferentFoodMix =
    workflow?.strategy !== "different_approved_mix" ||
    !baseline ||
    !hasSameFoodMix(baseline, candidate);
  const firstRequiredFoodId = requiredFoodIds[0] ?? null;
  return {
    includesRequiredFood,
    issues: [
      ...(includesRequiredFood
        ? []
        : [
            `The Draft must include approved food(s): ${requiredFoodIds.join(", ")}.`,
          ]),
      ...(includedExcludedFoods.length === 0
        ? []
        : [
            `The Draft must exclude the food(s) being replaced: ${includedExcludedFoods.join(", ")}.`,
          ]),
      ...(differsFromBaseline
        ? []
        : ["The requested plan change must differ from the current plan."]),
      ...(usesDifferentFoodMix
        ? []
        : [
            "The requested strategy requires a different mix of approved foods; changing gram amounts alone is not enough.",
          ]),
      ...(hasUncompensatedRequiredFoodAddition(
        state,
        candidate,
        firstRequiredFoodId,
      )
        ? [
            "This adds the required food without reducing or replacing another Active Plan portion. Rebalance the complete Draft before resubmitting.",
          ]
        : []),
    ],
  };
}
