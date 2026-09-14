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
  if (value.type === "draft_failure_review" || value.type === "draft_approval")
    return "draft";
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
  const foodFlow = new Set([
    "food_candidates",
    "food_approval",
    "existing_food",
    "confirm_draft_food",
    "source_unavailable",
  ]);
  const sameWorkflow = Boolean(
    current &&
    ((foodFlow.has(current.type) && foodFlow.has(next.type)) ||
      interactionWorkflow(current) === interactionWorkflow(next) ||
      current.id === next.id),
  );
  return {
    ...state,
    agentSession: {
      ...state.agentSession,
      pendingInteraction: next,
      pausedInteraction:
        current && !sameWorkflow
          ? current
          : state.agentSession.pausedInteraction,
    },
  };
}

export function finishNonInteractiveWorkflow(
  state: PersistedDemoState,
  workflow: InteractionWorkflow,
) {
  const current = state.agentSession.pendingInteraction;
  if (!current || interactionWorkflow(current) !== workflow) return state;
  return {
    ...state,
    agentSession: {
      ...state.agentSession,
      pendingInteraction: state.agentSession.pausedInteraction,
      pausedInteraction: null,
    },
  };
}
