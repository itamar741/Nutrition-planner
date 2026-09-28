import { describe, expect, it } from "vitest";
import {
  makePlanChangeDraftReady,
  markPlanChangeDraftPending,
  markPlanChangeFailure,
  planChangeCandidateIssues,
  resolvePlanChangeFood,
  startPlanChange,
  waitForFoodApproval,
} from "@/application/plan-change-workflow";
import { createExistingDemoState } from "@/data/demo-fixtures";
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
  it("advances one operation through food resolution, Draft, failure, and retry", () => {
    const state = createExistingDemoState();
    const resolving = startPlanChange(state, {
      status: "resolving_foods",
      unresolvedFoodNames: ["cottage cheese"],
      requestEvidence: "add cottage cheese to my meal plan",
    });
    const awaitingFood = waitForFoodApproval(resolving);
    const awaitingDraft = resolvePlanChangeFood(
      awaitingFood,
      "cottage-cheese-approved",
    );
    const ready = makePlanChangeDraftReady(awaitingDraft, {
      requiredFoodId: "cottage-cheese-approved",
    });
    const pending = markPlanChangeDraftPending(ready, "draft-1");
    const failed = markPlanChangeFailure(ready);
    const retried = makePlanChangeDraftReady(failed, {
      retryStrategy: "different_approved_mix",
    });

    expect(awaitingFood).toMatchObject({
      id: resolving.id,
      status: "awaiting_food_approval",
    });
    expect(awaitingDraft).toMatchObject({
      id: resolving.id,
      status: "awaiting_draft_confirmation",
      requiredCatalogFoodIds: ["cottage-cheese-approved"],
      unresolvedFoodNames: [],
    });
    expect(ready.status).toBe("ready_for_draft");
    expect(pending).toMatchObject({
      id: resolving.id,
      status: "draft_pending_approval",
      currentDraftId: "draft-1",
    });
    expect(retried).toMatchObject({
      id: resolving.id,
      status: "ready_for_draft",
      strategy: "different_approved_mix",
      attemptBatch: 2,
    });
  });

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
});
