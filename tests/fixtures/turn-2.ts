import { existingProfileFoundation } from "@/data/demo-fixtures";
import { foodCatalog } from "@/data/food-catalog";
import { emptyAgentSession } from "@/domain/agent/types";
import { calculateTargets } from "@/domain/nutrition/calculations";
import { validateAndBuildPlan } from "@/domain/plan/validation";
import type { DraftCandidate, DraftProposal } from "@/domain/plan/types";
import type { StructuredProfile } from "@/domain/profile/types";
import type { DemoState } from "@/store/demo-reducer";

export function makeReadyProfile(): StructuredProfile {
  return {
    ...existingProfileFoundation,
    foodPreferencesComplete: true,
    approvedCatalogFoodIds: foodCatalog.map((food) => food.id),
  };
}

export function makeValidMaintenanceCandidate(): DraftCandidate {
  return {
    summary: "A practical repeatable day built from your approved foods.",
    meals: [
      {
        id: "breakfast",
        items: [
          { catalogFoodId: "rolled-oats-dry", grams: 100, alternatives: [] },
          {
            catalogFoodId: "greek-yogurt-nonfat",
            grams: 300,
            alternatives: [],
          },
          { catalogFoodId: "banana-raw", grams: 115, alternatives: [] },
        ],
      },
      {
        id: "lunch",
        items: [
          {
            catalogFoodId: "chicken-breast-roasted",
            grams: 250,
            alternatives: [],
          },
          {
            catalogFoodId: "white-rice-cooked",
            grams: 350,
            alternatives: [],
          },
          { catalogFoodId: "broccoli-raw", grams: 150, alternatives: [] },
          { catalogFoodId: "olive-oil", grams: 15, alternatives: [] },
        ],
      },
      {
        id: "snack",
        items: [
          { catalogFoodId: "banana-raw", grams: 115, alternatives: [] },
          { catalogFoodId: "avocado-raw", grams: 100, alternatives: [] },
        ],
      },
      {
        id: "dinner",
        items: [
          {
            catalogFoodId: "white-rice-cooked",
            grams: 350,
            alternatives: [],
          },
          {
            catalogFoodId: "sweet-potato-baked",
            grams: 400,
            alternatives: [],
          },
          { catalogFoodId: "broccoli-raw", grams: 150, alternatives: [] },
          { catalogFoodId: "olive-oil", grams: 20, alternatives: [] },
        ],
      },
    ],
  };
}

export function makeValidDraft(commandId = "command-draft-1"): DraftProposal {
  const profile = makeReadyProfile();
  const targets = calculateTargets(profile);
  if (!targets) throw new Error("Expected fixture targets");
  const plan = validateAndBuildPlan({
    candidate: makeValidMaintenanceCandidate(),
    profile,
    targets,
    planId: `plan-${commandId}`,
    version: 1,
  });
  if (!plan.validation.valid) {
    throw new Error(plan.validation.issues.join(" "));
  }
  return {
    schemaVersion: 1,
    id: `draft-${commandId}`,
    basePlanVersion: null,
    reason: "initial",
    summary: makeValidMaintenanceCandidate().summary,
    plan,
  };
}

export function makeFoodGridState(): DemoState {
  return {
    schemaVersion: 2,
    profileId: "new",
    profile: {
      ...existingProfileFoundation,
      foodPreferencesComplete: false,
      approvedCatalogFoodIds: [],
    },
    messages: [
      {
        id: "fixture-ready",
        role: "assistant",
        text: "Your profile details are complete. Choose your food preferences next.",
      },
    ],
    activeTurn: {
      type: "food_grid",
      id: "select-foods",
      prompt: "Choose your food preferences.",
    },
    targets: null,
    draft: null,
    activePlan: null,
    status: "idle",
    pendingCommand: null,
    pendingOperation: null,
    processedCommandIds: [],
    error: null,
    agentSession: emptyAgentSession(),
    weightMeasurements: [],
  };
}

export function makeReadyState(): DemoState {
  const profile = makeReadyProfile();
  return {
    schemaVersion: 2,
    profileId: "new",
    profile,
    messages: [
      {
        id: "fixture-ready",
        role: "assistant",
        text: "Your food preferences are complete. Generate a Draft when you are ready.",
      },
    ],
    activeTurn: {
      type: "message",
      id: "profile-ready",
      prompt: "Your nutrition profile is ready for target calculation.",
    },
    targets: calculateTargets(profile),
    draft: null,
    activePlan: null,
    status: "idle",
    pendingCommand: null,
    pendingOperation: null,
    processedCommandIds: [],
    error: null,
    agentSession: emptyAgentSession(),
    weightMeasurements: [],
  };
}
