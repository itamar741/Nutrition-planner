import { describe, expect, it } from "vitest";
import {
  applyPlanChangeDecision,
  planChangeCandidateIssues,
} from "@/application/plan-change-workflow";
import { createExistingDemoState } from "@/data/demo-fixtures";
import { foodCatalog } from "@/data/food-catalog";
import type { DraftCandidate } from "@/domain/plan/types";

function candidateFromActivePlan(): {
  state: ReturnType<typeof createExistingDemoState>;
  candidate: DraftCandidate;
} {
  const state = createExistingDemoState();
  const candidate = {
    summary: "A proposed replacement plan.",
    meals: state.activePlan.plan.meals.map((meal) => ({
      id: meal.id,
      items: meal.items.map((item) => ({
        catalogFoodId: item.catalogFoodId,
        grams: item.grams,
        alternatives: [],
      })),
    })),
  };
  state.agentSession.planChange = {
    id: "test-plan-change",
    status: "ready_for_draft",
    sourceMessageId: null,
    requestEvidence: null,
    mode: "replace_active",
    basePlanVersion: state.activePlan.version,
    baseDraftId: null,
    requiredCatalogFoodIds: [],
    unresolvedFoodNames: [],
    excludedCatalogFoodIds: [],
    mustDiffer: true,
    scope: "whole_plan",
    portionRecalculation: "whole_draft",
    strategy: "different_approved_mix",
    offeredAlternativeFoodIds: [],
    selectedAlternativeFoodId: null,
    attemptBatch: 1,
    currentDraftId: null,
  };
  return { state, candidate };
}

describe("plan change workflow", () => {
  it("does not accept gram-only edits as a different approved-food mix", () => {
    const { state, candidate } = candidateFromActivePlan();
    candidate.meals[0].items[0].grams += 5;

    expect(planChangeCandidateIssues(state, candidate).issues).toContain(
      "The requested strategy requires a different mix of approved foods; changing gram amounts alone is not enough.",
    );
  });

  it("recognizes an actual food-composition change", () => {
    const { state, candidate } = candidateFromActivePlan();
    candidate.meals[0].items[0].catalogFoodId = "another-approved-food";

    expect(planChangeCandidateIssues(state, candidate).issues).not.toContain(
      "The requested strategy requires a different mix of approved foods; changing gram amounts alone is not enough.",
    );
  });

  it("does not accept an offered-food answer after another workflow became current", () => {
    const { state } = candidateFromActivePlan();
    state.agentSession.planChange = {
      ...state.agentSession.planChange!,
      offeredAlternativeFoodIds: ["potato-baked"],
    };
    const currentInteraction = {
      id: "current-food-search",
      type: "clarification" as const,
      workflow: "food" as const,
      prompt: "Which food should I search for?",
      quickReplies: [],
    };
    state.agentSession.pendingInteraction = currentInteraction;

    const result = applyPlanChangeDecision({
      state,
      catalog: [...foodCatalog],
      currentInteraction,
      decision: {
        intent: "food_alternative_selection",
        speechAct: "answer",
        foodNames: ["Potato"],
        candidateOrdinal: null,
        referenceScope: "persisted_interaction",
        planChangeStrategy: null,
        evidence: "Potato",
      },
    });

    expect(result.planMutationAuthorized).toBe(false);
    expect(result.selectedAlternativeFood).toBeNull();
    expect(result.state.agentSession.pendingInteraction).toEqual(
      currentInteraction,
    );
  });
});
