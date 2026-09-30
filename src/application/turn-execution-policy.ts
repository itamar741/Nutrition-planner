import type { CoachMessageRequest } from "@/domain/agent/types";

const modelInteractionActions = new Set<
  Extract<CoachMessageRequest["input"], { type: "interaction" }>["action"]
>([
  "review_trend",
  "generate_draft",
  "generate_adjustment",
  "confirm_draft_food",
]);

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
    case "generate_draft":
    case "generate_adjustment":
    case "confirm_draft_food":
      return null;
  }
}
