export type ArnoldCapabilityId =
  "draft" | "foods" | "calculations" | "weight" | "trend" | "goal";

export interface ArnoldCapability {
  id: ArnoldCapabilityId;
  title: string;
  description: string;
  example: string;
  modelContract: string;
}

export const arnoldCapabilities: ArnoldCapability[] = [
  {
    id: "draft",
    title: "Create or revise a meal-plan Draft",
    description: "Build a validated plan from your approved foods.",
    example: "Generate my Draft Meal Plan",
    modelContract:
      "A request to create, revise, replace, or change the whole meal plan is in scope and must use submit_draft_proposal before prose. A fresh request uses new_request; an active Plan Change uses continuation.",
  },
  {
    id: "foods",
    title: "Manage approved foods",
    description: "Add, find, inspect, or remove foods for future Drafts.",
    example: "Find Greek yogurt and add it to my foods",
    modelContract:
      "Food catalog inspection, search, addition, and removal are in scope and use the matching bounded food skill when state must change. Catalog-only work remains independent of an active Plan Change; an already-approved food is acknowledged without retrying that change.",
  },
  {
    id: "calculations",
    title: "Explain your calculations",
    description: "Ask about calories, macros, TDEE/EER, or plan checks.",
    example: "How is my TDEE calculated?",
    modelContract:
      "Calculation questions are in scope and are answered directly from authoritative calculationExplanation and planValidationExplanation without a skill call.",
  },
  {
    id: "weight",
    title: "Record and correct weight",
    description: "Track a weight measurement or correct an earlier day.",
    example: "I weigh 75.4 kg today",
    modelContract:
      "Explicit weight recording or correction is in scope and uses the matching bounded weight skill.",
  },
  {
    id: "trend",
    title: "Review weight trends",
    description: "Review evidence and propose an adjustment when supported.",
    example: "Review my weight trend",
    modelContract:
      "Weight-trend review is in scope and is answered directly from authoritative deterministicTrend and boundedAdjustment without a skill call. If an adjustment is supported, describe the visible Generate AI proposal control; never call submit_adjustment_proposal from a text review request.",
  },
  {
    id: "goal",
    title: "Choose a different goal",
    description: "Restart onboarding to choose a new nutrition goal.",
    example: "I want to change my nutrition goal",
    modelContract:
      "Goal-change questions are in scope. Explain that this demo requires reset and onboarding again; do not mutate the goal through a skill.",
  },
];
