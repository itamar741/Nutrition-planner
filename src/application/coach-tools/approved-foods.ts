import { randomUUID } from "node:crypto";
import { coachToolResult } from "@/domain/agent/tool-result";
import {
  catalogFoodMatchesQuery,
  textValuesOverlap,
} from "@/domain/catalog/identity";
import type { CatalogFood } from "@/domain/catalog/types";
import type { PersistedDemoState } from "@/persistence/repository";
import { setInteraction } from "../interaction-state";
import { startPlanChange } from "../plan-change-workflow";

function approvedIdsOf(state: PersistedDemoState) {
  return "profile" in state
    ? state.profile.approvedCatalogFoodIds
    : state.approvedCatalogFoodIds;
}

function plansUsingFood(state: PersistedDemoState, foodId: string) {
  const hasFood = (plan: {
    meals: Array<{ items: Array<{ catalogFoodId: string }> }>;
  }) =>
    plan.meals.some((meal) =>
      meal.items.some((item) => item.catalogFoodId === foodId),
    );
  return {
    inDraft: state.draft ? hasFood(state.draft.plan) : false,
    inActivePlan: state.activePlan ? hasFood(state.activePlan.plan) : false,
  };
}

export function removeApprovedFood(input: {
  state: PersistedDemoState;
  catalog: CatalogFood[];
  foodId: string;
  currentText: string | null;
}) {
  const food = input.catalog.find((item) => item.id === input.foodId);
  if (!food || !approvedIdsOf(input.state).includes(input.foodId)) {
    return {
      state: input.state,
      result: coachToolResult(
        "blocked",
        "food_not_approved",
        "That food is not approved for this profile.",
      ),
    };
  }
  if (
    input.currentText === null ||
    (!textValuesOverlap(input.currentText, food.displayName) &&
      !catalogFoodMatchesQuery(food, input.currentText))
  ) {
    return {
      state: input.state,
      result: coachToolResult(
        "blocked",
        "missing_source_evidence",
        "The current message must name the approved food to remove.",
      ),
    };
  }
  const use = plansUsingFood(input.state, input.foodId);
  const state =
    "profile" in input.state
      ? {
          ...input.state,
          profile: {
            ...input.state.profile,
            approvedCatalogFoodIds:
              input.state.profile.approvedCatalogFoodIds.filter(
                (id) => id !== input.foodId,
              ),
          },
        }
      : {
          ...input.state,
          approvedCatalogFoodIds: input.state.approvedCatalogFoodIds.filter(
            (id) => id !== input.foodId,
          ),
        };
  return {
    state,
    result: coachToolResult(
      "completed",
      "food_removed",
      "The food was removed.",
      {
        removedFromFutureDrafts: true,
        food: { id: food.id, name: food.displayName },
        activePlanUnchanged: true,
        ...use,
      },
    ),
  };
}

export function offerApprovedFoodAlternatives(input: {
  state: PersistedDemoState;
  catalog: CatalogFood[];
  excludedFoodIds: string[];
  evidence: string;
  sourceMessageId: string;
  currentMessageId: string | null;
  currentText: string | null;
}) {
  if (
    input.currentMessageId === null ||
    input.currentText === null ||
    input.sourceMessageId !== input.currentMessageId ||
    !textValuesOverlap(input.currentText, input.evidence)
  ) {
    return {
      state: input.state,
      result: coachToolResult(
        "blocked",
        "missing_source_evidence",
        "The alternative request must cite the current user message.",
      ),
    };
  }
  const approvedIds = new Set(approvedIdsOf(input.state));
  const excludedFoods = input.catalog.filter(
    (food) =>
      approvedIds.has(food.id) && input.excludedFoodIds.includes(food.id),
  );
  if (excludedFoods.length !== input.excludedFoodIds.length) {
    return {
      state: input.state,
      result: coachToolResult(
        "blocked",
        "invalid_excluded_food",
        "Alternatives can exclude only foods approved for this profile.",
      ),
    };
  }
  const categories = new Set(excludedFoods.map((food) => food.category));
  const offeredFoods = input.catalog
    .filter(
      (food) =>
        approvedIds.has(food.id) &&
        !input.excludedFoodIds.includes(food.id) &&
        categories.has(food.category),
    )
    .sort((left, right) => left.displayName.localeCompare(right.displayName))
    .slice(0, 5);
  if (offeredFoods.length === 0) {
    return {
      state: input.state,
      result: coachToolResult(
        "completed",
        "no_approved_alternatives",
        "No eligible approved alternatives are available.",
        { alternatives: [] },
      ),
    };
  }

  const planChange = startPlanChange(input.state, {
    status: "awaiting_draft_confirmation",
    sourceMessageId: input.sourceMessageId,
    requestEvidence: input.evidence,
    excludedCatalogFoodIds: input.excludedFoodIds,
    mustDiffer: true,
    scope: "food_replacement",
    offeredAlternativeFoodIds: offeredFoods.map((food) => food.id),
  });
  const interaction = {
    id: randomUUID(),
    type: "clarification" as const,
    workflow: "draft" as const,
    prompt: "Which approved alternative would you like to use?",
    quickReplies: offeredFoods.map((food) => food.displayName),
    planChangeId: planChange.id,
  };
  const state = setInteraction(
    {
      ...input.state,
      agentSession: { ...input.state.agentSession, planChange },
    },
    interaction,
  );
  return {
    state,
    result: coachToolResult(
      "needs_user_action",
      "alternative_selection_required",
      "Approved alternatives were offered for user selection.",
      {
        planChangeId: planChange.id,
        alternatives: offeredFoods.map((food) => ({
          id: food.id,
          name: food.displayName,
        })),
      },
    ),
  };
}
