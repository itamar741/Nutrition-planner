import { calculateTargets } from "@/domain/nutrition/calculations";
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
  schemaVersion: 1;
  profileId: DemoProfileId;
  profile: StructuredProfile;
  messages: ChatMessage[];
  activeTurn: AssistantTurn;
  targets: NutritionTargets | null;
  status: "idle" | "processing" | "failed";
  pendingCommand: PendingCommand | null;
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
  }
}
