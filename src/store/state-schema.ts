import { calculateTargets } from "@/domain/nutrition/calculations";
import {
  getNextTurn,
  normalizeExerciseRoutine,
} from "@/domain/profile/onboarding";
import { structuredProfileSchema } from "@/domain/profile/schemas";

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

export function upgradePersistedStateV5(value: unknown) {
  const upgradedV4 = upgradePersistedStateV4(value);
  const state = recordOf(upgradedV4);
  if (!state || state.schemaVersion !== 4) return upgradedV4;
  if (state.profileId !== "new") return { ...state, schemaVersion: 5 };

  const parsedProfile = structuredProfileSchema.safeParse(state.profile);
  if (!parsedProfile.success) return { ...state, schemaVersion: 5 };
  const profile = normalizeExerciseRoutine(parsedProfile.data);

  return {
    ...state,
    schemaVersion: 5,
    profile,
    activeTurn: getNextTurn(profile),
    targets: calculateTargets(profile),
  };
}
