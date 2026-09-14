import type { AgentInteraction } from "@/domain/agent/types";
import type { PersistedDemoState } from "@/persistence/repository";

export type InteractionWorkflow = Extract<
  AgentInteraction,
  { type: "clarification" }
>["workflow"];

export function interactionWorkflow(
  value: AgentInteraction,
): InteractionWorkflow {
  if (value.type === "clarification") return value.workflow;
  if (value.type === "draft_failure_review")
    return value.proposalKind === "adjustment" ? "adjustment" : "draft";
  if (value.type === "draft_approval") return "draft";
  if (
    value.type === "food_candidates" ||
    value.type === "food_approval" ||
    value.type === "existing_food" ||
    value.type === "confirm_draft_food" ||
    value.type === "source_unavailable"
  )
    return "food";
  return "adjustment";
}

function sameWorkflow(left: AgentInteraction, right: AgentInteraction) {
  return interactionWorkflow(left) === interactionWorkflow(right);
}

function planChangeIsCurrent(state: PersistedDemoState) {
  const workflow = state.agentSession.planChange;
  if (!workflow) return true;
  const activeVersion = state.activePlan?.version ?? null;
  if (workflow.basePlanVersion !== activeVersion) return false;
  if (workflow.mode === "create_initial") return !state.activePlan;
  if (workflow.mode === "replace_active") return Boolean(state.activePlan);
  return Boolean(state.draft && workflow.baseDraftId === state.draft.id);
}

function interactionIsCurrent(
  state: PersistedDemoState,
  value: AgentInteraction | null,
) {
  if (!value) return false;
  if (value.type === "draft_approval") {
    return Boolean(state.draft && value.proposalId === state.draft.id);
  }
  if (value.type === "draft_failure_review") {
    if (value.proposalKind === "adjustment") {
      return Boolean(
        !("profile" in state) &&
        !state.draft &&
        value.basePlanVersion === state.activePlan.version,
      );
    }
    return Boolean(state.agentSession.planChange);
  }
  if (value.type === "adjustment_offer") {
    return Boolean(
      !("profile" in state) &&
      !state.draft &&
      value.basePlanVersion === state.activePlan.version,
    );
  }
  if (value.type === "adjustment_approval") {
    return Boolean(
      !("profile" in state) &&
      value.draft.basePlanVersion === state.activePlan.version,
    );
  }
  return true;
}

export function reconcileAgentWorkflowState(state: PersistedDemoState) {
  const planChange = planChangeIsCurrent(state)
    ? state.agentSession.planChange
    : null;
  const stateWithPlanChange =
    planChange === state.agentSession.planChange
      ? state
      : {
          ...state,
          agentSession: { ...state.agentSession, planChange },
        };
  let pending = interactionIsCurrent(
    stateWithPlanChange,
    stateWithPlanChange.agentSession.pendingInteraction,
  )
    ? stateWithPlanChange.agentSession.pendingInteraction
    : null;
  let paused = interactionIsCurrent(
    stateWithPlanChange,
    stateWithPlanChange.agentSession.pausedInteraction,
  )
    ? stateWithPlanChange.agentSession.pausedInteraction
    : null;
  if (pending && paused && sameWorkflow(pending, paused)) paused = null;
  if (!pending && paused) {
    pending = paused;
    paused = null;
  }
  return {
    ...stateWithPlanChange,
    agentSession: {
      ...stateWithPlanChange.agentSession,
      pendingInteraction: pending,
      pausedInteraction: paused,
    },
  };
}

export function setInteraction(
  state: PersistedDemoState,
  next: AgentInteraction | null,
) {
  const current = state.agentSession.pendingInteraction;
  if (!next) {
    return {
      ...state,
      agentSession: {
        ...state.agentSession,
        pendingInteraction: state.agentSession.pausedInteraction,
        pausedInteraction: null,
      },
    };
  }
  const continuesCurrent = Boolean(current && sameWorkflow(current, next));
  const resumesPaused = Boolean(
    state.agentSession.pausedInteraction &&
    sameWorkflow(state.agentSession.pausedInteraction, next),
  );
  return {
    ...state,
    agentSession: {
      ...state.agentSession,
      pendingInteraction: next,
      pausedInteraction: resumesPaused
        ? null
        : continuesCurrent
          ? state.agentSession.pausedInteraction
          : (state.agentSession.pausedInteraction ?? current),
    },
  };
}

export function finishNonInteractiveWorkflow(
  state: PersistedDemoState,
  workflow: InteractionWorkflow,
) {
  const current = state.agentSession.pendingInteraction;
  if (!current || interactionWorkflow(current) !== workflow) return state;
  return setInteraction(state, null);
}
