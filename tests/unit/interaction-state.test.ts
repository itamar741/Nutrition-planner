import { describe, expect, it } from "vitest";
import {
  finishNonInteractiveWorkflow,
  reconcileAgentWorkflowState,
  setInteraction,
} from "@/application/interaction-state";
import { createExistingDemoState } from "@/data/demo-fixtures";
import type { AgentInteraction } from "@/domain/agent/types";

const foodQuestion: AgentInteraction = {
  id: "food-question",
  type: "clarification",
  workflow: "food",
  prompt: "Which food?",
  quickReplies: [],
};

const draftQuestion: AgentInteraction = {
  id: "draft-question",
  type: "clarification",
  workflow: "draft",
  prompt: "What should change?",
  quickReplies: [],
};

const adjustmentQuestion: AgentInteraction = {
  id: "adjustment-question",
  type: "clarification",
  workflow: "adjustment",
  prompt: "What should change in the adjustment?",
  quickReplies: [],
};

describe("interaction state transitions", () => {
  it("pauses one different workflow and restores it when the current one ends", () => {
    const state = createExistingDemoState();
    const withFood = {
      ...state,
      agentSession: {
        ...state.agentSession,
        pendingInteraction: foodQuestion,
      },
    };
    const withDraft = setInteraction(withFood, draftQuestion);
    expect(withDraft.agentSession.pendingInteraction).toEqual(draftQuestion);
    expect(withDraft.agentSession.pausedInteraction).toEqual(foodQuestion);

    const restored = setInteraction(withDraft, null);
    expect(restored.agentSession.pendingInteraction).toEqual(foodQuestion);
    expect(restored.agentSession.pausedInteraction).toBeNull();
  });

  it("does not hide an unrelated interaction after a non-interactive action", () => {
    const state = createExistingDemoState();
    const withFood = {
      ...state,
      agentSession: {
        ...state.agentSession,
        pendingInteraction: foodQuestion,
      },
    };
    expect(finishNonInteractiveWorkflow(withFood, "weight")).toEqual(withFood);
  });

  it("restores a paused interaction after its current workflow completes", () => {
    const state = createExistingDemoState();
    const withBoth = {
      ...state,
      agentSession: {
        ...state.agentSession,
        pendingInteraction: draftQuestion,
        pausedInteraction: foodQuestion,
      },
    };
    const restored = finishNonInteractiveWorkflow(withBoth, "draft");
    expect(restored.agentSession.pendingInteraction).toEqual(foodQuestion);
    expect(restored.agentSession.pausedInteraction).toBeNull();
  });

  it("does not silently overwrite the first paused workflow on a second topic switch", () => {
    const state = createExistingDemoState();
    const withFood = {
      ...state,
      agentSession: {
        ...state.agentSession,
        pendingInteraction: foodQuestion,
      },
    };
    const withDraft = setInteraction(withFood, draftQuestion);
    const withAdjustment = setInteraction(withDraft, adjustmentQuestion);

    expect(withAdjustment.agentSession.pendingInteraction).toEqual(
      adjustmentQuestion,
    );
    expect(withAdjustment.agentSession.pausedInteraction).toEqual(foodQuestion);
  });

  it("resumes a paused workflow explicitly and supersedes the interrupted current one", () => {
    const state = createExistingDemoState();
    const withBoth = {
      ...state,
      agentSession: {
        ...state.agentSession,
        pendingInteraction: draftQuestion,
        pausedInteraction: foodQuestion,
      },
    };
    const resumedFood = { ...foodQuestion, id: "new-food-question" };
    const resumed = setInteraction(withBoth, resumedFood);

    expect(resumed.agentSession.pendingInteraction).toEqual(resumedFood);
    expect(resumed.agentSession.pausedInteraction).toBeNull();
  });

  it("prunes stale plan and approval state and restores a still-current paused workflow", () => {
    const state = createExistingDemoState();
    const staleDraftApproval: AgentInteraction = {
      id: "stale-draft",
      type: "draft_approval",
      proposalId: "missing-draft",
    };
    const stale = {
      ...state,
      agentSession: {
        ...state.agentSession,
        pendingInteraction: staleDraftApproval,
        pausedInteraction: foodQuestion,
        planChange: {
          mode: "replace_active" as const,
          basePlanVersion: state.activePlan.version + 1,
          baseDraftId: null,
          requiredCatalogFoodIds: [],
          excludedCatalogFoodIds: [],
          mustDiffer: true,
          scope: "whole_plan" as const,
          portionRecalculation: "whole_draft" as const,
          strategy: null,
          offeredAlternativeFoodIds: [],
          selectedAlternativeFoodId: null,
          attemptBatch: 1,
        },
      },
    };

    const reconciled = reconcileAgentWorkflowState(stale);
    expect(reconciled.agentSession.planChange).toBeNull();
    expect(reconciled.agentSession.pendingInteraction).toEqual(foodQuestion);
    expect(reconciled.agentSession.pausedInteraction).toBeNull();
  });
});
