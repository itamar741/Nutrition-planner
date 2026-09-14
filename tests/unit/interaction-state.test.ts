import { describe, expect, it } from "vitest";
import {
  finishNonInteractiveWorkflow,
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
});
