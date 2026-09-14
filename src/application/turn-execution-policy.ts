import type { CoachToolName } from "@/ai/coach-agent";
import type { CoachMessageRequest } from "@/domain/agent/types";
import type { AgentInteraction } from "@/domain/agent/types";
import type { TurnDecision } from "@/domain/agent/turn-decision";

const toolsByIntent: Record<TurnDecision["intent"], CoachToolName[]> = {
  onboarding_answer: [],
  plan_create: ["submit_draft_proposal"],
  plan_replace: ["submit_draft_proposal"],
  plan_revise: ["submit_draft_proposal"],
  food_alternatives: [],
  food_alternative_selection: ["submit_draft_proposal"],
  draft_retry: ["submit_draft_proposal"],
  adjustment_retry: ["submit_adjustment_proposal"],
  weight_record: ["record_weight"],
  weight_edit: ["edit_weight"],
  weight_delete: ["delete_weight"],
  food_search: ["search_foods"],
  food_candidate_selection: ["select_food_candidate"],
  food_inspect: ["inspect_food_availability"],
  food_remove: ["inspect_food_availability", "remove_approved_food"],
  preference_save: ["remember_preference"],
  nutrition_question: [],
  fitness_question: [],
  unsupported: [],
  unknown: [],
};

const answerIntents = new Set<TurnDecision["intent"]>([
  "food_alternative_selection",
  "draft_retry",
  "adjustment_retry",
  "food_search",
  "food_candidate_selection",
  "weight_record",
  "weight_edit",
  "weight_delete",
]);

const questionIntents = new Set<TurnDecision["intent"]>(["food_inspect"]);

export function decisionAuthorizesIntent(
  decision: TurnDecision | null,
  intent: TurnDecision["intent"],
  pendingInteraction: AgentInteraction | null = null,
) {
  if (!decision || decision.intent !== intent || !decision.evidence) {
    return false;
  }
  if (decision.speechAct === "request") return true;
  if (decision.speechAct === "question") return questionIntents.has(intent);
  if (decision.speechAct !== "answer" || !answerIntents.has(intent)) {
    return false;
  }
  switch (intent) {
    case "food_alternative_selection":
      return (
        pendingInteraction?.type === "clarification" &&
        pendingInteraction.workflow === "draft"
      );
    case "draft_retry":
      return (
        pendingInteraction?.type === "draft_failure_review" &&
        pendingInteraction.proposalKind !== "adjustment"
      );
    case "adjustment_retry":
      return (
        (pendingInteraction?.type === "clarification" &&
          pendingInteraction.workflow === "adjustment") ||
        (pendingInteraction?.type === "draft_failure_review" &&
          pendingInteraction.proposalKind === "adjustment")
      );
    case "food_search":
      return (
        pendingInteraction?.type === "clarification" &&
        pendingInteraction.workflow === "food"
      );
    case "food_candidate_selection":
      return pendingInteraction?.type === "food_candidates";
    case "weight_record":
    case "weight_edit":
    case "weight_delete":
      return (
        pendingInteraction?.type === "clarification" &&
        pendingInteraction.workflow === "weight"
      );
    default:
      return false;
  }
}

export function allowedToolsForDecision(
  available: CoachToolName[],
  decision: TurnDecision | null,
  pendingInteraction: AgentInteraction | null = null,
) {
  if (!decision) return available;
  const authorized = new Set(
    decisionAuthorizesIntent(decision, decision.intent, pendingInteraction)
      ? toolsByIntent[decision.intent]
      : [],
  );
  return available.filter((tool) => authorized.has(tool));
}

export function decisionAuthorizesOnboardingExtraction(
  decision: TurnDecision | null,
  onboardingRequired: boolean,
) {
  return Boolean(
    onboardingRequired &&
    decision?.intent === "onboarding_answer" &&
    decision.evidence &&
    (decision.speechAct === "answer" || decision.speechAct === "request"),
  );
}

const modelInteractionActions = new Set<
  Extract<CoachMessageRequest["input"], { type: "interaction" }>["action"]
>(["review_trend", "generate_adjustment", "confirm_draft_food"]);

export function coachInputRequiresModel(input: CoachMessageRequest["input"]) {
  return input.type === "text" || modelInteractionActions.has(input.action);
}

export function deterministicInteractionText(
  input: Extract<CoachMessageRequest["input"], { type: "interaction" }>,
  summary: Record<string, unknown> | null,
) {
  const name =
    summary && typeof summary.food === "string" ? summary.food : "The food";
  switch (input.action) {
    case "approve_draft":
      return "The Draft was approved and is now your Active Plan.";
    case "reject_draft":
      return "The Draft was declined. What would you like changed in the next Draft?";
    case "select_candidate":
      return "The selected food is ready for review. Check its source and nutrition values before approving it.";
    case "approve_food":
    case "add_existing_food":
      return `${name} is now approved for this profile. Would you like a new Draft that includes it?`;
    case "reject_food":
      return "The food was rejected. What should I correct in the food search?";
    case "approve_adjustment":
      return "The adjustment was approved and is now your Active Plan.";
    case "reject_adjustment":
      return "The adjustment was declined. What did you not like about it?";
    case "decline_draft_food":
      return "Okay. The food remains approved for future Drafts, and no plan was changed.";
    case "confirm_ai_estimate":
      return "The unverified estimate is ready for review. Check its label and nutrition values before approving it.";
    case "refine_search":
      return "How should I refine the food name?";
    case "review_trend":
    case "generate_adjustment":
    case "confirm_draft_food":
      return null;
  }
}
