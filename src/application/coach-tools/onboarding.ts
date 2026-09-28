import { coachToolResult } from "@/domain/agent/tool-result";
import { calculateTargets } from "@/domain/nutrition/calculations";
import {
  applyOnboardingFactPatch,
  getNextTurn,
  isProfileReady,
} from "@/domain/profile/onboarding";
import type { ProfileFactPatch } from "@/domain/profile/types";
import type { PersistedDemoState } from "@/persistence/repository";

export function submitOnboardingFacts(input: {
  state: PersistedDemoState;
  facts: Record<string, unknown>;
  acknowledgement: string;
  supportingMessageId: string;
  currentMessageId: string | null;
  currentDate: string;
  commandId: string;
}) {
  if (
    !("profile" in input.state) ||
    isProfileReady(input.state.profile) ||
    input.currentMessageId === null
  ) {
    return {
      state: input.state,
      result: coachToolResult(
        "blocked",
        "onboarding_not_active",
        "Onboarding facts can be submitted only during active Fresh onboarding.",
      ),
    };
  }
  if (input.supportingMessageId !== input.currentMessageId) {
    return {
      state: input.state,
      result: coachToolResult(
        "blocked",
        "missing_source_evidence",
        "Onboarding facts must cite the current user message.",
      ),
    };
  }
  if (input.state.activeTurn.type !== "open_question") {
    return {
      state: input.state,
      result: coachToolResult(
        "blocked",
        "visible_choice_required",
        "The current onboarding step must be completed with its visible control.",
      ),
    };
  }

  const patch = Object.fromEntries(
    Object.entries(input.facts).filter(([, value]) => value !== null),
  ) as ProfileFactPatch;
  if (Object.keys(patch).length === 0) {
    return {
      state: input.state,
      result: coachToolResult(
        "rejected",
        "no_explicit_facts",
        "No explicit supported onboarding facts were found in the current message.",
      ),
    };
  }

  const nextProfile = applyOnboardingFactPatch(input.state.profile, patch);
  const activeTurn = getNextTurn(nextProfile);
  const currentWeightKg = nextProfile.currentWeightKg;
  let measurements = input.state.weightMeasurements;
  if (currentWeightKg !== null && patch.currentWeightKg !== undefined) {
    const existingTodayWeight = measurements.find(
      (measurement) => measurement.date === input.currentDate,
    );
    measurements = existingTodayWeight
      ? measurements.map((measurement) =>
          measurement.id === existingTodayWeight.id
            ? {
                ...measurement,
                weightKg: currentWeightKg,
                commandId: input.commandId,
              }
            : measurement,
        )
      : [
          ...measurements,
          {
            id: `weight-onboarding-${input.commandId}`,
            date: input.currentDate,
            weightKg: currentWeightKg,
            commandId: input.commandId,
          },
        ];
  }

  return {
    state: {
      ...input.state,
      profile: nextProfile,
      activeTurn,
      targets: calculateTargets(nextProfile),
      weightMeasurements: measurements,
      status: "idle" as const,
      pendingCommand: null,
      pendingOperation: null,
      processedCommandIds: input.state.processedCommandIds.includes(
        input.commandId,
      )
        ? input.state.processedCommandIds
        : [...input.state.processedCommandIds, input.commandId],
      error: null,
    },
    result: coachToolResult(
      "completed",
      "onboarding_facts_applied",
      "Explicit onboarding facts were applied.",
      {
        acknowledgement: input.acknowledgement,
        acceptedFields: Object.keys(patch),
        nextTurn: activeTurn,
      },
    ),
  };
}
