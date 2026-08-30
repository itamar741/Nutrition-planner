import { calculateTargets } from "@/domain/nutrition/calculations";
import type { ActivePlan, DraftProposal } from "@/domain/plan/types";
import {
  revalidatePlan,
  validateFoodSelections,
} from "@/domain/plan/validation";
import { applyFactPatch, getNextTurn } from "@/domain/profile/onboarding";
import type {
  AssistantTurn,
  DemoProfileId,
  NutritionTargets,
  ProfileFactPatch,
  StructuredProfile,
} from "@/domain/profile/types";

export interface ChatMessage {
  id: string;
  role: "assistant" | "user";
  text: string;
}

export interface PendingCommand {
  id: string;
  message: string;
}

export interface DemoState {
  schemaVersion: 2;
  profileId: DemoProfileId;
  profile: StructuredProfile;
  messages: ChatMessage[];
  activeTurn: AssistantTurn;
  targets: NutritionTargets | null;
  draft: DraftProposal | null;
  activePlan: ActivePlan | null;
  status: "idle" | "processing" | "failed";
  pendingCommand: PendingCommand | null;
  pendingOperation: "onboarding" | "draft" | "modification" | null;
  processedCommandIds: string[];
  error: string | null;
}

export type DemoAction =
  | { type: "hydrate"; state: DemoState }
  | { type: "start_open"; command: PendingCommand }
  | { type: "retry_open"; commandId: string }
  | {
      type: "complete_open";
      commandId: string;
      profile: StructuredProfile;
      activeTurn: AssistantTurn;
      acknowledgement: string;
      targets: NutritionTargets | null;
    }
  | { type: "fail_open"; commandId: string; message: string }
  | {
      type: "apply_closed";
      commandId: string;
      label: string;
      patch: ProfileFactPatch;
    }
  | { type: "apply_food_selection"; commandId: string; ids: string[] }
  | {
      type: "start_plan";
      command: PendingCommand;
      operation: "draft" | "modification";
    }
  | { type: "retry_plan"; commandId: string }
  | { type: "complete_draft"; commandId: string; draft: DraftProposal }
  | {
      type: "complete_modification";
      commandId: string;
      draft: DraftProposal;
      message: string;
    }
  | { type: "complete_unsupported"; commandId: string; message: string }
  | { type: "fail_plan"; commandId: string; message: string }
  | { type: "reject_draft"; commandId: string; proposalId: string }
  | {
      type: "activate_draft";
      commandId: string;
      proposalId: string;
      activatedAt: string;
    };

function messageId(prefix: string, commandId: string) {
  return `${prefix}-${commandId}`;
}

export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  if (action.type === "hydrate") return action.state;

  if (
    "commandId" in action &&
    state.processedCommandIds.includes(action.commandId)
  ) {
    return state;
  }

  switch (action.type) {
    case "start_open":
      if (state.status === "processing") return state;
      return {
        ...state,
        status: "processing",
        pendingCommand: action.command,
        pendingOperation: "onboarding",
        error: null,
        messages: [
          ...state.messages,
          {
            id: messageId("user", action.command.id),
            role: "user",
            text: action.command.message,
          },
        ],
      };
    case "retry_open":
      if (
        state.pendingCommand?.id !== action.commandId ||
        state.status !== "failed"
      ) {
        return state;
      }
      return {
        ...state,
        status: "processing",
        error: null,
      };
    case "complete_open":
      if (state.pendingCommand?.id !== action.commandId) return state;
      return {
        ...state,
        profile: action.profile,
        activeTurn: action.activeTurn,
        targets: action.targets,
        status: "idle",
        pendingCommand: null,
        pendingOperation: null,
        processedCommandIds: [...state.processedCommandIds, action.commandId],
        error: null,
        messages: [
          ...state.messages,
          {
            id: messageId("assistant", action.commandId),
            role: "assistant",
            text: `${action.acknowledgement} ${action.activeTurn.prompt}`.trim(),
          },
        ],
      };
    case "fail_open":
      if (state.pendingCommand?.id !== action.commandId) return state;
      return {
        ...state,
        status: "failed",
        error: action.message,
      };
    case "apply_closed": {
      if (state.status === "processing") return state;
      const profile = applyFactPatch(state.profile, action.patch);
      const activeTurn = getNextTurn(profile);
      return {
        ...state,
        profile,
        activeTurn,
        targets: calculateTargets(profile),
        status: "idle",
        pendingCommand: null,
        pendingOperation: null,
        processedCommandIds: [...state.processedCommandIds, action.commandId],
        error: null,
        messages: [
          ...state.messages,
          {
            id: messageId("user", action.commandId),
            role: "user",
            text: action.label,
          },
          {
            id: messageId("assistant", action.commandId),
            role: "assistant",
            text: activeTurn.prompt,
          },
        ],
      };
    }
    case "apply_food_selection": {
      if (state.status === "processing") return state;
      const selection = validateFoodSelections(action.ids);
      if (!selection.valid) {
        return {
          ...state,
          status: "failed",
          error: selection.issues.join(" "),
          pendingCommand: null,
          pendingOperation: null,
        };
      }
      const profile = {
        ...state.profile,
        foodPreferencesComplete: true,
        approvedCatalogFoodIds: selection.orderedIds,
      };
      const activeTurn = getNextTurn(profile);
      return {
        ...state,
        profile,
        activeTurn,
        targets: calculateTargets(profile),
        status: "idle",
        pendingCommand: null,
        pendingOperation: null,
        error: null,
        processedCommandIds: [...state.processedCommandIds, action.commandId],
        messages: [
          ...state.messages,
          {
            id: messageId("user", action.commandId),
            role: "user",
            text: `Selected ${selection.orderedIds.length} catalog foods.`,
          },
          {
            id: messageId("assistant", action.commandId),
            role: "assistant",
            text: "Your food preferences are complete. Your targets are ready; generate a Draft when you are ready.",
          },
        ],
      };
    }
    case "start_plan":
      if (state.status === "processing") return state;
      return {
        ...state,
        status: "processing",
        pendingCommand: action.command,
        pendingOperation: action.operation,
        error: null,
        messages: [
          ...state.messages,
          {
            id: messageId("user", action.command.id),
            role: "user",
            text: action.command.message,
          },
        ],
      };
    case "retry_plan":
      if (
        state.pendingCommand?.id !== action.commandId ||
        state.status !== "failed" ||
        state.pendingOperation === null ||
        state.pendingOperation === "onboarding"
      ) {
        return state;
      }
      return { ...state, status: "processing", error: null };
    case "complete_draft": {
      if (
        state.pendingCommand?.id !== action.commandId ||
        state.pendingOperation !== "draft"
      ) {
        return state;
      }
      const plan = revalidatePlan(action.draft.plan, state.profile);
      if (!plan.validation.valid) {
        return {
          ...state,
          status: "failed",
          error: "The proposed Draft did not pass deterministic validation.",
        };
      }
      const draft = { ...action.draft, plan };
      return {
        ...state,
        draft,
        status: "idle",
        pendingCommand: null,
        pendingOperation: null,
        processedCommandIds: [...state.processedCommandIds, action.commandId],
        error: null,
        messages: [
          ...state.messages,
          {
            id: messageId("assistant", action.commandId),
            role: "assistant",
            text: `${draft.summary} Review the Draft beside the conversation. It is not Active until you approve it.`,
          },
        ],
      };
    }
    case "complete_modification": {
      if (
        state.pendingCommand?.id !== action.commandId ||
        state.pendingOperation !== "modification"
      ) {
        return state;
      }
      const plan = revalidatePlan(action.draft.plan, state.profile);
      if (!plan.validation.valid) {
        return {
          ...state,
          status: "failed",
          error: "That Draft change did not pass deterministic validation.",
        };
      }
      return {
        ...state,
        draft: { ...action.draft, plan },
        status: "idle",
        pendingCommand: null,
        pendingOperation: null,
        processedCommandIds: [...state.processedCommandIds, action.commandId],
        error: null,
        messages: [
          ...state.messages,
          {
            id: messageId("assistant", action.commandId),
            role: "assistant",
            text: `${action.message} The updated plan is still a Draft.`,
          },
        ],
      };
    }
    case "complete_unsupported":
      if (
        state.pendingCommand?.id !== action.commandId ||
        state.pendingOperation !== "modification"
      ) {
        return state;
      }
      return {
        ...state,
        status: "idle",
        pendingCommand: null,
        pendingOperation: null,
        processedCommandIds: [...state.processedCommandIds, action.commandId],
        error: null,
        messages: [
          ...state.messages,
          {
            id: messageId("assistant", action.commandId),
            role: "assistant",
            text: `${action.message} I can only replace one approved food or change one portion at a time.`,
          },
        ],
      };
    case "fail_plan":
      if (state.pendingCommand?.id !== action.commandId) return state;
      return { ...state, status: "failed", error: action.message };
    case "reject_draft":
      if (state.status !== "idle" || state.draft?.id !== action.proposalId) {
        return state;
      }
      return {
        ...state,
        draft: null,
        processedCommandIds: [...state.processedCommandIds, action.commandId],
        messages: [
          ...state.messages,
          {
            id: messageId("user", action.commandId),
            role: "user",
            text: "Decline this Draft",
          },
          {
            id: messageId("assistant", action.commandId),
            role: "assistant",
            text: "The Draft was declined. No Active Plan was changed.",
          },
        ],
      };
    case "activate_draft": {
      if (state.status !== "idle" || state.draft?.id !== action.proposalId) {
        return state;
      }
      const expectedBaseVersion = state.activePlan?.version ?? null;
      if (state.draft.basePlanVersion !== expectedBaseVersion) return state;
      const plan = revalidatePlan(state.draft.plan, state.profile);
      if (!plan.validation.valid) return state;
      const activePlan: ActivePlan = {
        schemaVersion: 1,
        version: (state.activePlan?.version ?? 0) + 1,
        activatedAt: action.activatedAt,
        plan,
      };
      return {
        ...state,
        draft: null,
        activePlan,
        processedCommandIds: [...state.processedCommandIds, action.commandId],
        messages: [
          ...state.messages,
          {
            id: messageId("user", action.commandId),
            role: "user",
            text: "Approve and activate",
          },
          {
            id: messageId("assistant", action.commandId),
            role: "assistant",
            text: "Approved. The exact validated Draft is now your Active Plan.",
          },
        ],
      };
    }
  }
}
