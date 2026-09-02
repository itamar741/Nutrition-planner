import OpenAI from "openai";
import { ZodError } from "zod";
import {
  baselineCatalogSnapshot,
  type CatalogSnapshot,
} from "@/domain/catalog/snapshot";
import {
  calculateTargets,
  roundTo25HalfUp,
} from "@/domain/nutrition/calculations";
import {
  draftCandidateSchema,
  draftModificationOperationSchema,
} from "@/domain/plan/schemas";
import {
  applyModificationToDraft,
  buildDeterministicSeedCandidate,
  getExpectedMealIds,
  repairCandidateNutrition,
  validateAndBuildPlan,
  validateFoodSelections,
} from "@/domain/plan/validation";
import type { DraftCandidate, DraftProposal } from "@/domain/plan/types";
import {
  draftCandidateJsonSchema,
  draftModificationJsonSchema,
  type DraftModificationRequest,
  type DraftRequest,
  type AdjustmentRequest,
} from "./plan-contracts";

export class OpenAIPlanConfigurationError extends Error {}

export class PlanModelContractError extends Error {
  constructor(
    message: string,
    readonly kind: "model" | "validation" = "model",
  ) {
    super(message);
  }
}

export type PlanResponseCreator = (input: {
  instructions: string;
  userInput: string;
  schemaName: string;
  schema: Record<string, unknown>;
}) => Promise<string>;

async function defaultPlanResponseCreator(input: {
  instructions: string;
  userInput: string;
  schemaName: string;
  schema: Record<string, unknown>;
}): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;
  if (!apiKey || !model) {
    throw new OpenAIPlanConfigurationError(
      "Server-side OpenAI configuration is missing.",
    );
  }
  const client = new OpenAI({ apiKey });
  const response = await client.responses.create({
    model,
    instructions: input.instructions,
    input: input.userInput,
    store: false,
    tools: [],
    tool_choice: "none",
    text: {
      format: {
        type: "json_schema",
        name: input.schemaName,
        strict: true,
        schema: input.schema,
      },
    },
  });
  if (response.status !== "completed" || !response.output_text) {
    throw new PlanModelContractError("The model response was incomplete.");
  }
  return response.output_text;
}

function repairMessage(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues
      .map((issue) => issue.message)
      .join("; ")
      .slice(0, 500);
  }
  if (error instanceof SyntaxError) {
    return "Return valid JSON matching the supplied schema.";
  }
  return error instanceof Error
    ? error.message.slice(0, 500)
    : "Unknown structured-output error.";
}

function approvedCatalogContext(ids: string[], catalog: CatalogSnapshot) {
  return ids.map((id) => {
    const food = catalog.byId.get(id);
    if (!food)
      throw new PlanModelContractError(`Unknown food ${id}.`, "validation");
    return {
      id: food.id,
      name: food.displayName,
      category: food.category,
      mealClassification: food.mealClassification,
      nutrientsPer100g: food.nutrientsPer100g,
      practicalGrams: food.practicalGrams,
    };
  });
}

function candidateContainsFood(
  candidate: DraftCandidate,
  catalogFoodId: string | undefined,
) {
  return (
    !catalogFoodId ||
    candidate.meals.some((meal) =>
      meal.items.some(
        (item) =>
          item.catalogFoodId === catalogFoodId ||
          item.alternatives.some(
            (alternative) => alternative.catalogFoodId === catalogFoodId,
          ),
      ),
    )
  );
}

export async function generateDraft(
  request: DraftRequest,
  createResponse: PlanResponseCreator = defaultPlanResponseCreator,
  catalog: CatalogSnapshot = baselineCatalogSnapshot,
): Promise<DraftProposal> {
  const selections = validateFoodSelections(
    request.profile.approvedCatalogFoodIds,
    catalog,
  );
  const targets = calculateTargets(request.profile);
  if (!selections.valid || !targets || !request.profile.mealPattern) {
    throw new PlanModelContractError(
      selections.issues.join(" ") || "The profile is not ready for a Draft.",
      "validation",
    );
  }
  if (
    request.requiredCatalogFoodId &&
    !selections.orderedIds.includes(request.requiredCatalogFoodId)
  ) {
    throw new PlanModelContractError(
      "The required food is not approved for this profile.",
      "validation",
    );
  }

  const expectedMealIds = getExpectedMealIds(request.profile.mealPattern);
  const context = {
    feedback: request.message?.trim() || null,
    goal: request.profile.goal,
    currentWeightKg: request.profile.currentWeightKg,
    mealPattern: request.profile.mealPattern,
    expectedMealIds,
    targets,
    approvedCatalog: approvedCatalogContext(selections.orderedIds, catalog),
    requiredCatalogFoodId: request.requiredCatalogFoodId ?? null,
  };
  let repairIssue: string | undefined;
  let lastCandidate: DraftCandidate | undefined;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const feedbackForAttempt = attempt === 0 ? request.message?.trim() : null;
    try {
      const raw = await createResponse({
        schemaName: "nutrition_coach_daily_draft",
        schema: draftCandidateJsonSchema as unknown as Record<string, unknown>,
        instructions: [
          "Create one repeatable daily meal plan for a healthy-adult nutrition demo.",
          "Use only the supplied approved catalog IDs and integer gram portions within each practical range and step.",
          "Approved foods may be reused in multiple meals; do not treat each catalog ID as limited to one occurrence.",
          request.requiredCatalogFoodId
            ? `The new Draft must include catalog food ${request.requiredCatalogFoodId} in at least one meal.`
            : "No particular catalog food is required in this Draft.",
          `Return meals exactly in this order: ${expectedMealIds.join(", ")}.`,
          "Meet the supplied energy, protein, AMDR, fiber, and meat/dairy constraints. Fish is neutral for this project's narrow meal check.",
          "Return alternatives: [] for every item unless you can verify the entire whole-day substitution independently. Do not add alternatives by default.",
          "Before returning, check every portion against its supplied practical min, max, and step; never exceed a maximum even when more energy is needed.",
          "Before returning, calculate the whole-day totals. A candidate below the energy or protein minimum is invalid even if its individual meals look reasonable.",
          feedbackForAttempt
            ? `Use this user feedback as a preference for the new Draft, while keeping every catalog, nutrition, meal-pattern, and approval rule intact: ${feedbackForAttempt}`
            : "No additional user preference was provided.",
          feedbackForAttempt
            ? "For feedback about eating more at a particular time, redistribute the approved foods and portions across meals while preserving the whole-day energy, protein, AMDR, and fiber totals; do not simply add calories or remove a meal."
            : "",
          feedbackForAttempt
            ? "Qualitative feedback must never change the daily target, meal count, meal IDs, or approved-food set. If the preference conflicts with nutrition constraints, satisfy the deterministic nutrition constraints first and keep the closest safe distribution."
            : "",
          feedbackForAttempt
            ? "If you cannot honor the feedback and still pass every constraint, ignore the feedback and return a standard valid plan rather than returning an invalid plan."
            : "",
          attempt === 1 && request.message?.trim()
            ? "The feedback attempt failed validation. Return a standard valid plan first; do not let the earlier preference affect the nutrition totals."
            : "",
          "Do not browse, invent food data, add meals, change the goal, or include instructions outside the schema.",
          repairIssue
            ? `Repair the previous invalid result: ${repairIssue}`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
        userInput: JSON.stringify({
          ...context,
          feedback: feedbackForAttempt,
        }),
      });
      const candidate = draftCandidateSchema.parse(JSON.parse(raw));
      if (!candidateContainsFood(candidate, request.requiredCatalogFoodId)) {
        throw new PlanModelContractError(
          `The Draft omitted required catalog food ${request.requiredCatalogFoodId}.`,
          "validation",
        );
      }
      lastCandidate = candidate;
      const plan = validateAndBuildPlan({
        candidate,
        profile: request.profile,
        targets,
        planId: `plan-${request.commandId}`,
        version: 1,
        catalog,
      });
      if (!plan.validation.valid) {
        throw new PlanModelContractError(
          plan.validation.issues.join(" "),
          "validation",
        );
      }
      return {
        schemaVersion: 1,
        id: `draft-${request.commandId}`,
        basePlanVersion: null,
        reason: "initial",
        summary: candidate.summary,
        plan,
      };
    } catch (error) {
      if (error instanceof OpenAIPlanConfigurationError) throw error;
      repairIssue = repairMessage(error);
    }
  }

  const fallbackCandidates = lastCandidate
    ? [
        lastCandidate,
        buildDeterministicSeedCandidate(request.profile, catalog) ?? undefined,
      ].filter((candidate): candidate is DraftCandidate => Boolean(candidate))
    : [];

  for (const fallbackCandidate of fallbackCandidates) {
    if (
      !candidateContainsFood(fallbackCandidate, request.requiredCatalogFoodId)
    ) {
      continue;
    }
    const repairedCandidate = repairCandidateNutrition({
      candidate: fallbackCandidate,
      profile: request.profile,
      targets,
      catalog,
    });
    if (repairedCandidate) {
      const plan = validateAndBuildPlan({
        candidate: repairedCandidate,
        profile: request.profile,
        targets,
        planId: `plan-${request.commandId}`,
        version: 1,
        catalog,
      });
      if (plan.validation.valid) {
        return {
          schemaVersion: 1,
          id: `draft-${request.commandId}`,
          basePlanVersion: null,
          reason: "initial",
          summary: repairedCandidate.summary,
          plan,
        };
      }
    }
  }

  throw new PlanModelContractError(
    repairIssue ?? "The model returned an invalid Draft twice.",
    "validation",
  );
}

export async function generateDraftModification(
  request: DraftModificationRequest,
  createResponse: PlanResponseCreator = defaultPlanResponseCreator,
  catalog: CatalogSnapshot = baselineCatalogSnapshot,
): Promise<
  | { outcome: "modified"; draft: DraftProposal; message: string }
  | { outcome: "unsupported"; message: string }
> {
  const selections = validateFoodSelections(
    request.profile.approvedCatalogFoodIds,
    catalog,
  );
  if (!selections.valid || !request.draft.plan.validation.valid) {
    throw new PlanModelContractError(
      selections.issues.join(" ") || "The current Draft is not valid.",
      "validation",
    );
  }
  if (
    request.requiredCatalogFoodId &&
    !selections.orderedIds.includes(request.requiredCatalogFoodId)
  ) {
    throw new PlanModelContractError(
      "The required food is not approved for this profile.",
      "validation",
    );
  }

  const context = {
    request: request.message,
    allowedActions: ["replace_food", "change_portion", "unsupported"],
    currentDraft: request.draft,
    approvedCatalog: approvedCatalogContext(selections.orderedIds, catalog),
    requiredCatalogFoodId: request.requiredCatalogFoodId ?? null,
  };
  let repairIssue: string | undefined;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await createResponse({
        schemaName: "nutrition_coach_draft_modification",
        schema: draftModificationJsonSchema as unknown as Record<
          string,
          unknown
        >,
        instructions: [
          "Interpret one requested change to the supplied Draft.",
          "Return only replace_food, change_portion, or unsupported.",
          "Use an existing mealId and itemId. A replacement must use one approved catalog ID and a practical integer gram amount.",
          request.requiredCatalogFoodId
            ? `This continuation must replace one item with catalog food ${request.requiredCatalogFoodId}; do not choose a different food ID.`
            : "No particular replacement food is required.",
          "Do not add meals, add foods, browse, create weekly variation, change the goal, or activate the plan.",
          "Use unsupported when the request cannot be represented by exactly one allowed operation.",
          repairIssue
            ? `Repair the previous invalid result: ${repairIssue}`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
        userInput: JSON.stringify(context),
      });
      const operation = draftModificationOperationSchema.parse(JSON.parse(raw));
      if (
        request.requiredCatalogFoodId &&
        (operation.type !== "replace_food" ||
          (operation.type === "replace_food" &&
            operation.catalogFoodId !== request.requiredCatalogFoodId))
      ) {
        throw new PlanModelContractError(
          `The modification omitted required catalog food ${request.requiredCatalogFoodId}.`,
          "validation",
        );
      }
      if (operation.type === "unsupported") {
        return { outcome: "unsupported", message: operation.explanation };
      }
      const draft = applyModificationToDraft({
        draft: request.draft,
        operation,
        profile: request.profile,
        proposalId: `draft-${request.commandId}`,
        catalog,
      });
      if (!draft.plan.validation.valid) {
        throw new PlanModelContractError(
          draft.plan.validation.issues.join(" "),
          "validation",
        );
      }
      return {
        outcome: "modified",
        draft,
        message: operation.explanation,
      };
    } catch (error) {
      if (error instanceof OpenAIPlanConfigurationError) throw error;
      repairIssue = repairMessage(error);
    }
  }

  throw new PlanModelContractError(
    repairIssue ?? "The model returned an invalid modification twice.",
    "validation",
  );
}

export async function generateAdjustmentDraft(
  request: AdjustmentRequest,
  createResponse: PlanResponseCreator = defaultPlanResponseCreator,
  catalog: CatalogSnapshot = baselineCatalogSnapshot,
): Promise<DraftProposal> {
  const selections = validateFoodSelections(
    request.profile.approvedCatalogFoodIds,
    catalog,
  );
  if (!selections.valid || !request.activePlan.plan.validation.valid) {
    throw new PlanModelContractError(
      "The Existing profile is not ready for an adjustment.",
      "validation",
    );
  }
  const expectedAdjustment = Math.max(
    100,
    Math.min(
      200,
      roundTo25HalfUp(
        request.activePlan.plan.validation.totals.energyKcal * 0.05,
      ),
    ),
  );
  if (request.adjustmentKcal !== expectedAdjustment) {
    throw new PlanModelContractError(
      "The adjustment amount is not permitted.",
      "validation",
    );
  }
  const baseTargets = request.activePlan.plan.targetSnapshot;
  const energyKcal =
    baseTargets.energyKcal +
    (request.direction === "increase"
      ? request.adjustmentKcal
      : -request.adjustmentKcal);
  const targets = {
    ...baseTargets,
    energyKcal,
    carbohydrateTargetG:
      (energyKcal -
        baseTargets.proteinTargetG * 4 -
        baseTargets.fatTargetG * 9) /
      4,
  };
  const expectedMealIds = getExpectedMealIds(request.profile.mealPattern!);
  let repairIssue: string | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await createResponse({
        schemaName: "nutrition_coach_plan_adjustment",
        schema: draftCandidateJsonSchema as unknown as Record<string, unknown>,
        instructions: [
          "Create a replacement repeatable daily meal plan for a healthy-adult nutrition demo.",
          "Use only the supplied approved catalog IDs and integer gram portions within each practical range and step.",
          `Return meals exactly in this order: ${expectedMealIds.join(", ")}.`,
          `The active plan must change in the permitted direction only: ${request.direction} energy by exactly ${request.adjustmentKcal} kcal/day target, producing a plan that passes the supplied adjusted targets and all protein, AMDR, fiber, catalog, and meat/dairy checks.`,
          request.feedback
            ? "Use the user's feedback only to choose among the supplied approved foods and redistribute their portions. The feedback cannot change the goal, direction, calorie adjustment, meal pattern, or validation rules."
            : "",
          "Do not browse, invent food data, add meals, alter the goal, or activate the plan. Return alternatives: [] unless each alternative independently passes the entire plan validation.",
          repairIssue
            ? `Repair the previous invalid result: ${repairIssue}`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
        userInput: JSON.stringify({
          direction: request.direction,
          adjustmentKcal: request.adjustmentKcal,
          adjustedTargets: targets,
          currentActivePlan: request.activePlan.plan,
          userFeedback: request.feedback ?? null,
          approvedCatalog: approvedCatalogContext(
            selections.orderedIds,
            catalog,
          ),
        }),
      });
      const candidate = draftCandidateSchema.parse(JSON.parse(raw));
      const plan = validateAndBuildPlan({
        candidate,
        profile: request.profile,
        targets,
        planId: `plan-${request.commandId}`,
        version: request.activePlan.version + 1,
        catalog,
      });
      if (!plan.validation.valid)
        throw new PlanModelContractError(
          plan.validation.issues.join(" "),
          "validation",
        );
      return {
        schemaVersion: 1,
        id: `adjustment-${request.commandId}`,
        basePlanVersion: request.activePlan.version,
        reason: "modification",
        summary: candidate.summary,
        plan,
      };
    } catch (error) {
      if (error instanceof OpenAIPlanConfigurationError) throw error;
      repairIssue = repairMessage(error);
    }
  }
  const fallback = buildDeterministicSeedCandidate(request.profile, catalog);
  const repairedFallback = fallback
    ? repairCandidateNutrition({
        candidate: fallback,
        profile: request.profile,
        targets,
      })
    : null;
  if (repairedFallback) {
    const plan = validateAndBuildPlan({
      candidate: repairedFallback,
      profile: request.profile,
      targets,
      catalog,
      planId: `plan-${request.commandId}`,
      version: request.activePlan.version + 1,
    });
    if (plan.validation.valid) {
      return {
        schemaVersion: 1,
        id: `adjustment-${request.commandId}`,
        basePlanVersion: request.activePlan.version,
        reason: "modification",
        summary:
          "A validated adjustment was prepared from your approved foods.",
        plan,
      };
    }
  }
  throw new PlanModelContractError(
    repairIssue ?? "The adjustment did not pass validation.",
    "validation",
  );
}
