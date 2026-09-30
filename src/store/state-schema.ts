function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

export function upgradePersistedStateV4(value: unknown) {
  const state = recordOf(value);
  if (!state || state.schemaVersion !== 3) return value;
  const agentSession = recordOf(state.agentSession);
  if (!agentSession) return { ...state, schemaVersion: 4 };
  const planChange = recordOf(agentSession.planChange);
  if (!planChange) {
    return {
      ...state,
      schemaVersion: 4,
      agentSession: { ...agentSession, planChange: null },
    };
  }
  const pendingInteraction = recordOf(agentSession.pendingInteraction);
  const recoveredAttempts =
    pendingInteraction?.type === "draft_failure_review" &&
    Array.isArray(pendingInteraction.attempts)
      ? pendingInteraction.attempts
      : [];
  return {
    ...state,
    schemaVersion: 4,
    agentSession: {
      ...agentSession,
      planChange: {
        ...planChange,
        rejectedDraftAttempts: Array.isArray(planChange.rejectedDraftAttempts)
          ? planChange.rejectedDraftAttempts
          : recoveredAttempts,
      },
    },
  };
}
