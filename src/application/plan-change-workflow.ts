import { randomUUID } from "node:crypto";
import type {
  AgentInteraction,
  PlanChangeWorkflow,
} from "@/domain/agent/types";
import {
  requestsFoodAlternativeOffer,
  requestsPlanMutation,
  type TurnDecision,
} from "@/domain/agent/turn-decision";
import type { CatalogFood } from "@/domain/catalog/types";
import type { DraftCandidate } from "@/domain/plan/types";
import type { PersistedDemoState } from "@/persistence/repository";
import { setInteraction } from "./interaction-state";

function approvedIdsOf(state: PersistedDemoState) {
  return "profile" in state
    ? state.profile.approvedCatalogFoodIds
    : state.approvedCatalogFoodIds;
}

function approvedCatalog(catalog: CatalogFood[], ids: string[]) {
  const wanted = new Set(ids);
  return catalog.filter((food) => wanted.has(food.id));
}

function normalizedFoodText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function foodMatchingNames(foods: CatalogFood[], names: string[]) {
  const normalizedNames = names.map(normalizedFoodText).filter(Boolean);
  return (
    foods.find((food) => {
      const displayName = normalizedFoodText(food.displayName);
      return normalizedNames.some(
        (name) => displayName.includes(name) || name.includes(displayName),
      );
    }) ?? null
  );
}

function alternativeFoodsFor(
  state: PersistedDemoState,
  catalog: CatalogFood[],
  excludedFood: CatalogFood | null,
) {
  const approved = approvedCatalog(catalog, approvedIdsOf(state));
  const activeFoodIds = new Set(
    state.activePlan?.plan.meals.flatMap((meal) =>
      meal.items.map((item) => item.catalogFoodId),
    ) ?? [],
  );
  const category = excludedFood?.category ?? "carbohydrate";
  return approved
    .filter(
      (food) =>
        food.id !== excludedFood?.id &&
        food.category === category &&
        !activeFoodIds.has(food.id),
    )
    .sort((left, right) => left.displayName.localeCompare(right.displayName))
    .slice(0, 5);
}

export function startPlanChange(
  state: PersistedDemoState,
  input: Partial<PlanChangeWorkflow> = {},
): PlanChangeWorkflow {
  return {
    mode: state.draft
      ? "revise_pending"
      : state.activePlan
        ? "replace_active"
        : "create_initial",
    basePlanVersion: state.activePlan?.version ?? null,
    baseDraftId: state.draft?.id ?? null,
    requiredCatalogFoodIds: [],
    excludedCatalogFoodIds: [],
    mustDiffer: Boolean(state.activePlan || state.draft),
    scope: "unspecified",
    portionRecalculation: "whole_draft",
    strategy: null,
    offeredAlternativeFoodIds: [],
    selectedAlternativeFoodId: null,
    attemptBatch: 1,
    ...input,
  };
}

function selectedOfferedFood(
  decision: TurnDecision,
  workflow: PlanChangeWorkflow | null,
  currentInteraction: AgentInteraction | null,
  catalog: CatalogFood[],
) {
  if (
    decision.intent !== "food_alternative_selection" ||
    decision.speechAct !== "answer" ||
    !workflow ||
    currentInteraction?.type !== "clarification" ||
    currentInteraction.workflow !== "draft"
  ) {
    return null;
  }
  const offered = new Set(workflow.offeredAlternativeFoodIds);
  return foodMatchingNames(
    catalog.filter((food) => offered.has(food.id)),
    decision.foodNames,
  );
}

export function offeredFoodNames(
  state: PersistedDemoState,
  catalog: CatalogFood[],
) {
  const offered = new Set(
    state.agentSession.planChange?.offeredAlternativeFoodIds ?? [],
  );
  return catalog
    .filter((food) => offered.has(food.id))
    .map((food) => food.displayName);
}

export function applyPlanChangeDecision(input: {
  state: PersistedDemoState;
  catalog: CatalogFood[];
  decision: TurnDecision;
  currentInteraction: AgentInteraction | null;
}) {
  let { state, currentInteraction } = input;
  let selectedAlternativeFood: CatalogFood | null = null;
  let planMutationAuthorized = false;

  if (requestsFoodAlternativeOffer(input.decision)) {
    const approved = approvedCatalog(input.catalog, approvedIdsOf(state));
    const excludedFood = foodMatchingNames(approved, input.decision.foodNames);
    const offeredFoods = alternativeFoodsFor(
      state,
      input.catalog,
      excludedFood,
    );
    const planChange = startPlanChange(state, {
      excludedCatalogFoodIds: excludedFood ? [excludedFood.id] : [],
      mustDiffer: true,
      scope: "food_replacement",
      offeredAlternativeFoodIds: offeredFoods.map((food) => food.id),
    });
    state = setInteraction(
      {
        ...state,
        agentSession: { ...state.agentSession, planChange },
      },
      {
        id: randomUUID(),
        type: "clarification",
        workflow: "draft",
        prompt: "Which approved alternative would you like to use?",
        quickReplies: offeredFoods.map((food) => food.displayName),
      },
    );
    currentInteraction = state.agentSession.pendingInteraction;
  } else {
    selectedAlternativeFood = selectedOfferedFood(
      input.decision,
      state.agentSession.planChange,
      currentInteraction,
      input.catalog,
    );
    if (selectedAlternativeFood && state.agentSession.planChange) {
      const planChange = {
        ...state.agentSession.planChange,
        requiredCatalogFoodIds: [selectedAlternativeFood.id],
        selectedAlternativeFoodId: selectedAlternativeFood.id,
      };
      state = setInteraction(
        {
          ...state,
          agentSession: { ...state.agentSession, planChange },
        },
        null,
      );
      currentInteraction = state.agentSession.pendingInteraction;
      planMutationAuthorized = true;
    } else if (
      requestsPlanMutation(input.decision) &&
      ["plan_create", "plan_replace", "plan_revise"].includes(
        input.decision.intent,
      )
    ) {
      const previous = state.agentSession.planChange;
      state = {
        ...state,
        agentSession: {
          ...state.agentSession,
          planChange: startPlanChange(state, {
            ...(previous ?? {}),
            scope:
              input.decision.intent === "plan_replace"
                ? "whole_plan"
                : (previous?.scope ?? "unspecified"),
          }),
        },
      };
      planMutationAuthorized = true;
    } else if (
      input.decision.intent === "draft_retry" &&
      input.decision.speechAct === "answer" &&
      input.decision.planChangeStrategy &&
      currentInteraction?.type === "draft_failure_review"
    ) {
      const previous = state.agentSession.planChange ?? startPlanChange(state);
      state = setInteraction(
        {
          ...state,
          agentSession: {
            ...state.agentSession,
            planChange: {
              ...previous,
              strategy: input.decision.planChangeStrategy,
              attemptBatch: previous.attemptBatch + 1,
            },
          },
        },
        null,
      );
      currentInteraction = state.agentSession.pendingInteraction;
      planMutationAuthorized = true;
    }
  }

  return {
    state,
    currentInteraction,
    selectedAlternativeFood,
    requiredCatalogFoodId: selectedAlternativeFood?.id ?? null,
    planMutationAuthorized,
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
