import OpenAI from "openai";
import { ZodError } from "zod";
import { foodCatalogById } from "@/data/food-catalog";
import { calculateTargets } from "@/domain/nutrition/calculations";
import {
  draftCandidateSchema,
  draftModificationOperationSchema,
} from "@/domain/plan/schemas";
import {
  applyModificationToDraft,
  getExpectedMealIds,
  validateAndBuildPlan,
  validateFoodSelections,
} from "@/domain/plan/validation";
import type { DraftProposal } from "@/domain/plan/types";
import {
  draftCandidateJsonSchema,
  draftModificationJsonSchema,
  type DraftModificationRequest,
  type DraftRequest,
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

function approvedCatalogContext(ids: string[]) {
  return ids.map((id) => {
    const food = foodCatalogById.get(id);
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

export async function generateDraft(
  request: DraftRequest,
  createResponse: PlanResponseCreator = defaultPlanResponseCreator,
): Promise<DraftProposal> {
  const selections = validateFoodSelections(
    request.profile.approvedCatalogFoodIds,
  );
  const targets = calculateTargets(request.profile);
  if (!selections.valid || !targets || !request.profile.mealPattern) {
    throw new PlanModelContractError(
      selections.issues.join(" ") || "The profile is not ready for a Draft.",
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
    approvedCatalog: approvedCatalogContext(selections.orderedIds),
  };
  let repairIssue: string | undefined;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await createResponse({
        schemaName: "nutrition_coach_daily_draft",
        schema: draftCandidateJsonSchema as unknown as Record<string, unknown>,
        instructions: [
          "Create one repeatable daily meal plan for a healthy-adult nutrition demo.",
          "Use only the supplied approved catalog IDs and integer gram portions within each practical range and step.",
          "Approved foods may be reused in multiple meals; do not treat each catalog ID as limited to one occurrence.",
          `Return meals exactly in this order: ${expectedMealIds.join(", ")}.`,
          "Meet the supplied energy, protein, AMDR, fiber, and meat/dairy constraints. Fish is neutral for this project's narrow meal check.",
          "Return alternatives: [] for every item unless you can verify the entire whole-day substitution independently. Do not add alternatives by default.",
          "Before returning, check every portion against its supplied practical min, max, and step; never exceed a maximum even when more energy is needed.",
          "Before returning, calculate the whole-day totals. A candidate below the energy or protein minimum is invalid even if its individual meals look reasonable.",
          request.message?.trim()
            ? `Use this user feedback as a preference for the new Draft, while keeping every catalog, nutrition, meal-pattern, and approval rule intact: ${request.message.trim()}`
            : "No additional user preference was provided.",
          request.message?.trim()
            ? "For feedback about eating more at a particular time, redistribute the approved foods and portions across meals while preserving the whole-day energy, protein, AMDR, and fiber totals; do not simply add calories or remove a meal."
            : "",
          request.message?.trim()
            ? "Qualitative feedback must never change the daily target, meal count, meal IDs, or approved-food set. If the preference conflicts with nutrition constraints, satisfy the deterministic nutrition constraints first and keep the closest safe distribution."
            : "",
          "Do not browse, invent food data, add meals, change the goal, or include instructions outside the schema.",
          repairIssue
            ? `Repair the previous invalid result: ${repairIssue}`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
        userInput: JSON.stringify(context),
      });
      const candidate = draftCandidateSchema.parse(JSON.parse(raw));
      const plan = validateAndBuildPlan({
        candidate,
        profile: request.profile,
        targets,
        planId: `plan-${request.commandId}`,
        version: 1,
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

  throw new PlanModelContractError(
    repairIssue ?? "The model returned an invalid Draft twice.",
    "validation",
  );
}

export async function generateDraftModification(
  request: DraftModificationRequest,
  createResponse: PlanResponseCreator = defaultPlanResponseCreator,
): Promise<
  | { outcome: "modified"; draft: DraftProposal; message: string }
  | { outcome: "unsupported"; message: string }
> {
  const selections = validateFoodSelections(
    request.profile.approvedCatalogFoodIds,
  );
  if (!selections.valid || !request.draft.plan.validation.valid) {
    throw new PlanModelContractError(
      selections.issues.join(" ") || "The current Draft is not valid.",
      "validation",
    );
  }

  const context = {
    request: request.message,
    allowedActions: ["replace_food", "change_portion", "unsupported"],
    currentDraft: request.draft,
    approvedCatalog: approvedCatalogContext(selections.orderedIds),
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
      if (operation.type === "unsupported") {
        return { outcome: "unsupported", message: operation.explanation };
      }
      const draft = applyModificationToDraft({
        draft: request.draft,
        operation,
        profile: request.profile,
        proposalId: `draft-${request.commandId}`,
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
