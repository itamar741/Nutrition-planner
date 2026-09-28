import { randomUUID } from "node:crypto";
import {
  buildArnoldSystemPrompt,
  coachToolNames,
  runCoachAgent,
  type CoachToolCall,
  type CoachToolName,
  type DraftProposalArguments,
  type ProposalArguments,
} from "@/ai/coach-agent";
import {
  coachToolResult as toolResult,
  type CoachToolResult,
} from "@/domain/agent/tool-result";
import { existingReadyProfile } from "@/data/demo-fixtures";
import type {
  AgentInteraction,
  CoachMessageRequest,
  DraftAttemptReview,
} from "@/domain/agent/types";
import { createCatalogSnapshot } from "@/domain/catalog/snapshot";
import type { CatalogFood } from "@/domain/catalog/types";
import { textValuesOverlap } from "@/domain/catalog/identity";
import { calculateTargets } from "@/domain/nutrition/calculations";
import {
  buildPlanValidationExplanation,
  candidateFromPlan,
  getExpectedMealIds,
  getPlanNutritionRanges,
  validateAndBuildPlan,
} from "@/domain/plan/validation";
import type { DraftCandidate, DraftProposal } from "@/domain/plan/types";
import { isProfileReady } from "@/domain/profile/onboarding";
import type { StructuredProfile } from "@/domain/profile/types";
import { evaluateWeightAdjustmentDecision } from "@/domain/weight/decision";
import {
  calculateWeightTrend,
  currentPlanWeightFromMeasurements,
  maintenanceReferenceWeightFromInitialMeasurements,
  maintenanceReferenceWeightFromRecentMeasurements,
} from "@/domain/weight/trend";
import {
  addExistingFoodToProfile,
  appendConversationActivity,
  approveCatalogFood,
  createLookup,
  findCatalogFood,
  getCandidate,
  getLookup,
  getProfile,
  listConversationMessages,
  listCatalogFoods,
  mutateProfile,
  recordAgentSkillCall,
  recordAndCheckRateLimit,
  renewAgentTurnLease,
  replaceCandidate,
  saveCandidates,
  saveConversationSummary,
  updateLookup,
  type PersistedDemoState,
  type VersionedProfile,
} from "@/persistence/repository";
import {
  resolveUsdaFoodCandidates,
  searchUsdaFoodSummaries,
  UsdaUnavailableError,
  usdaFoodUrl,
} from "@/sources/usda";
import { rankUsdaCandidates } from "@/ai/food-catalog";
import { prepareAiEstimate, prepareFoodCandidate } from "./food-candidates";
import {
  reconcileAgentWorkflowState,
  setInteraction,
} from "./interaction-state";
import {
  makePlanChangeDraftReady,
  markPlanChangeDraftPending,
  markPlanChangeFailure,
  planChangeCandidateIssues,
  resolvePlanChangeFood,
  retainPlanChangeAfterDraftRejection,
  startPlanChange,
  waitForFoodApproval,
} from "./plan-change-workflow";
import {
  coachInputRequiresModel,
  deterministicInteractionText,
} from "./turn-execution-policy";
import { submitOnboardingFacts } from "./coach-tools/onboarding";
import { executeWeightTool } from "./coach-tools/weight";
import {
  offerApprovedFoodAlternatives,
  removeApprovedFood,
} from "./coach-tools/approved-foods";

type RateIdentity = { sessionHash: string; ipHash: string };
type Status =
  | "thinking"
  | "searching"
  | "validating"
  | "checking_foods"
  | "remembering"
  | "creating_draft"
  | "revising_draft";
type InteractionWithoutId = AgentInteraction extends infer Interaction
  ? Interaction extends { id: string }
    ? Omit<Interaction, "id">
    : never
  : never;

export interface CoachTurnResult {
  profile: VersionedProfile;
  catalogFood?: CatalogFood;
  assistantText: string;
}

async function atTurnStage<T>(stage: string, operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    const tagged =
      error instanceof Error ? error : new Error("Unknown coach turn error.");
    const staged = tagged as Error & { stage?: string };
    staged.stage ??= stage;
    throw staged;
  }
}

function approvedIdsOf(state: PersistedDemoState) {
  return "profile" in state
    ? state.profile.approvedCatalogFoodIds
    : state.approvedCatalogFoodIds;
}

function structuredProfileOf(state: PersistedDemoState): StructuredProfile {
  const profile =
    "profile" in state
      ? state.profile
      : {
          ...existingReadyProfile,
          approvedCatalogFoodIds: state.approvedCatalogFoodIds,
        };
  const measurements =
    "profile" in state ? state.weightMeasurements : state.measurements;
  const calculatedWeightKg =
    profile.goal === "maintenance"
      ? (state.activePlan?.maintenanceReferenceWeightKg ??
        maintenanceReferenceWeightFromInitialMeasurements(measurements) ??
        profile.currentWeightKg)
      : (currentPlanWeightFromMeasurements(measurements) ??
        profile.currentWeightKg);
  return { ...profile, currentWeightKg: calculatedWeightKg };
}

function measurementsOf(state: PersistedDemoState) {
  return "profile" in state ? state.weightMeasurements : state.measurements;
}

function contextFor(
  profile: VersionedProfile,
  catalog: CatalogFood[],
  currentInput: CoachMessageRequest["input"],
  allowed: CoachToolName[],
  conversationDigest: Record<string, unknown> | null,
  requiredCatalogFoodId: string | null,
) {
  const state = profile.state;
  const currentDate = new Date().toISOString().slice(0, 10);
  const weightMeasurements = measurementsOf(state);
  const structuredProfile = structuredProfileOf(state);
  const approved = approvedCatalog(catalog, approvedIdsOf(state));
  const targets = calculateTargets(structuredProfile);
  const weightKg = structuredProfile.currentWeightKg;
  const proteinMinimumMultiplier =
    structuredProfile.goal === "maintenance" ? 1.4 : 1.6;
  const base = {
    task: "Respond naturally and use a permitted bounded skill only when fresh facts or a supported change are required.",
    currentEvent:
      currentInput.type === "interaction"
        ? {
            action: currentInput.action,
            interactionId: currentInput.interactionId,
          }
        : null,
    onboarding:
      "profile" in state && !isProfileReady(state.profile)
        ? {
            required: true,
            currentTurn: state.activeTurn,
            responseRule:
              "Do not claim a profile update unless the onboarding extractor already persisted one. If no facts were accepted, answer an in-scope question or redirect an unsupported request without changing state; when useful, remind the user of currentTurn.prompt.",
          }
        : { required: false },
    currentDate,
    weightHistory: {
      todayMeasurement:
        weightMeasurements.find((item) => item.date === currentDate) ?? null,
      measurements: weightMeasurements,
    },
    profileId: profile.profileId,
    profileVersion: profile.version,
    structuredProfile,
    nutritionTargets: targets,
    expectedMealIds:
      structuredProfile.mealPattern === null
        ? null
        : getExpectedMealIds(structuredProfile.mealPattern),
    deterministicNutritionRules:
      targets && weightKg !== null
        ? {
            energyRangeKcal: {
              minimum: targets.energyKcal * 0.95,
              maximum: targets.energyKcal * 1.05,
            },
            proteinRangeG: {
              minimum: proteinMinimumMultiplier * weightKg,
              maximum: 2 * weightKg,
            },
            amdrPercent: {
              protein: {
                minimum: 10,
                maximum: structuredProfile.age === 18 ? 30 : 35,
              },
              carbohydrate: { minimum: 45, maximum: 65 },
              fat: {
                minimum: structuredProfile.age === 18 ? 25 : 20,
                maximum: 35,
              },
            },
            fiberMinimumG: targets.fiberMinimumG,
            portions: "Use each approved food's practicalGrams min/max/step.",
            mealComposition: "A meal cannot combine meat and dairy.",
            alternatives: "Not supported; submit no substitutions.",
          }
        : null,
    approvedFoods: approved.map((food) => ({
      id: food.id,
      name: food.displayName,
      category: food.category,
      preparation: food.preparation,
      mealClassification: food.mealClassification,
      nutrientsPer100g: food.nutrientsPer100g,
      practicalGrams: food.practicalGrams,
    })),
    conversationPreferences: state.agentSession.preferences,
    conversationDigest,
    requiredCatalogFoodId,
    allowedSkills: allowed,
    approvalBoundary:
      "Food, Draft, and adjustment approval requires the current visible button. Text never approves.",
    foodSearchPolicy: {
      aNamedBasicFoodIsEnoughForFirstSearch: true,
      preSearchSubtypeClarificationAllowed: false,
      clarificationAllowedWhen: [
        "the user has not supplied any food name",
        "the bounded USDA ranker found no genuine match",
      ],
    },
    pendingInteraction: state.agentSession.pendingInteraction,
    pausedInteraction: state.agentSession.pausedInteraction,
    pendingPlanChange: state.agentSession.planChange,
    currentDraft: state.draft,
    activePlan: state.activePlan,
    requiredFoodIntegration:
      requiredCatalogFoodId && state.activePlan
        ? {
            requiredCatalogFoodId,
            objective:
              "Create a complete replacement Draft that includes this food while preserving the current Active Plan targets.",
            planningRule:
              "Do not perform a one-for-one portion swap or append the food to an otherwise unchanged Active Plan. Recalculate portions across every meal in the complete Draft as needed to satisfy all targets, and explain the material changes in the Draft summary.",
          }
        : null,
    ordinaryDraftTargetSource:
      "profile" in state
        ? "deterministically calculated Fresh targets"
        : "the current Active Plan target snapshot; ordinary Drafts cannot change it",
  };
  if ("profile" in state) return base;
  const trend = calculateWeightTrend(state.measurements, {
    activePlanActivatedAt: state.activePlan.activatedAt,
  });
  const adjustment = adjustedTargetsFor(state);
  return {
    ...base,
    completeWeightHistory: state.measurements,
    deterministicTrend: trend,
    boundedAdjustment: adjustment
      ? {
          direction: adjustment.direction,
          adjustmentKcal: adjustment.adjustmentKcal,
          exactAdjustedTargets: adjustment.targets,
          adjustedEnergyRangeKcal: {
            minimum: adjustment.targets.energyKcal * 0.95,
            maximum: adjustment.targets.energyKcal * 1.05,
          },
          maintenanceDrift: adjustment.maintenanceDrift,
        }
      : null,
  };
}

function approvedCatalog(catalog: CatalogFood[], ids: string[]) {
  const wanted = new Set(ids);
  return catalog.filter((food) => wanted.has(food.id));
}

function contextWindowTokens() {
  const configured = Number(process.env.OPENAI_CONTEXT_WINDOW ?? 128_000);
  return Number.isInteger(configured) && configured >= 8_000
    ? configured
    : 128_000;
}

function tokenEstimate(value: string) {
  return Math.ceil(value.length / 4) + 8;
}

type ResolvedHistoricalWeightUpsert = {
  date: string;
  weightKg: number;
};

function dateBefore(currentDate: string, days: number) {
  const value = new Date(`${currentDate}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function historicalDateFromText(text: string, currentDate: string) {
  if (/\btoday\b/iu.test(text)) return currentDate;
  if (/\byesterday\b/iu.test(text)) return dateBefore(currentDate, 1);
  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/u)?.[1];
  if (iso) {
    const parsed = new Date(`${iso}T12:00:00Z`);
    if (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === iso &&
      iso <= currentDate
    ) {
      return iso;
    }
  }
  const short = text.match(/(?:^|\s|-)(\d{1,2})[./](\d{1,2})(?=\s|$)/u);
  if (!short) return null;
  const day = Number(short[1]);
  const month = Number(short[2]);
  const year = Number(currentDate.slice(0, 4));
  const candidate = new Date(Date.UTC(year, month - 1, day, 12));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  const normalized = candidate.toISOString().slice(0, 10);
  return normalized <= currentDate ? normalized : null;
}

function resolveWeightDelete(
  input: CoachMessageRequest["input"],
  conversation: Array<{ role: "assistant" | "user"; content: string }>,
  currentDate: string,
  allowConversationReference: boolean,
) {
  if (
    input.type !== "text" ||
    !/\b(?:delete|remove|erase)\b/iu.test(input.text)
  ) {
    return null;
  }
  const explicitDate = historicalDateFromText(input.text, currentDate);
  if (explicitDate) return explicitDate;
  if (!allowConversationReference) return null;
  if (!/\b(?:it|weight|measurement|entry)\b/iu.test(input.text)) return null;
  for (const message of [...conversation].reverse().slice(0, 12)) {
    if (message.role !== "user") continue;
    const date = historicalDateFromText(message.content, currentDate);
    if (date) return date;
  }
  return null;
}

function weightFromText(text: string) {
  const patterns = [
    /\b(?:weight\s+(?:is|was)|weigh|was|to)\s+(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:kg)?\b/iu,
    /\b(\d{1,3}(?:[.,]\d{1,2})?)\s*kg\b/iu,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const value = Number(match[1].replace(",", "."));
    if (value > 0 && value <= 500) return value;
  }
  return null;
}

function standaloneWeightFromText(text: string) {
  const match = text.trim().match(/^(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:kg)?$/iu);
  if (!match) return null;
  const value = Number(match[1].replace(",", "."));
  return value > 0 && value <= 500 ? value : null;
}

function resolveHistoricalWeightUpsert(
  input: CoachMessageRequest["input"],
  conversation: Array<{ role: "assistant" | "user"; content: string }>,
  currentDate: string,
  allowConversationReference: boolean,
): ResolvedHistoricalWeightUpsert | null {
  if (input.type !== "text") return null;
  const currentDateValue = historicalDateFromText(input.text, currentDate);
  const currentWeight = weightFromText(input.text);
  if (currentDateValue && currentWeight !== null) {
    return { date: currentDateValue, weightKg: currentWeight };
  }
  if (!allowConversationReference) return null;

  const contextualIntent =
    /\b(?:add|record|edit|update|replace|change)\b/iu.test(input.text) ||
    /^\s*\d{1,3}(?:[.,]\d{1,2})?\s*kg\s*$/iu.test(input.text);
  if (!contextualIntent) return null;

  let date = currentDateValue;
  let weightKg = currentWeight;
  for (const message of [...conversation].reverse().slice(0, 12)) {
    if (message.role !== "user") continue;
    date ??= historicalDateFromText(message.content, currentDate);
    weightKg ??= weightFromText(message.content);
    if (date && weightKg !== null) return { date, weightKg };
  }
  return null;
}

async function conversationForModel(input: {
  profileId: "new" | "existing";
  state: PersistedDemoState;
  contextWithoutDigest: Record<string, unknown>;
  currentInput: CoachMessageRequest["input"];
  agentTurnLease?: {
    profileId: "new" | "existing";
    commandId: string;
    leaseToken: string;
  };
}) {
  const stored = await listConversationMessages(input.profileId);
  const complete = stored
    .filter(
      (message) =>
        message.content.length > 0 &&
        (message.role === "user" || message.status !== "pending"),
    )
    .map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
    }));
  if (input.currentInput.type === "text") {
    const currentId = `user-${input.currentInput.text.length}-${input.profileId}`;
    const alreadyStored = complete.at(-1)?.content === input.currentInput.text;
    if (!alreadyStored) {
      complete.push({
        id: currentId,
        role: "user",
        content: input.currentInput.text,
      });
    }
  } else {
    complete.push({
      id: `event-${input.currentInput.interactionId}`,
      role: "user",
      content: `[Visible control event: ${input.currentInput.action.replaceAll("_", " ")}]`,
    });
  }
  const estimated =
    tokenEstimate(JSON.stringify(input.contextWithoutDigest)) +
    complete.reduce((sum, message) => sum + tokenEstimate(message.content), 0);
  if (estimated <= contextWindowTokens() * 0.6) {
    return {
      digest: null,
      messages: complete.map(({ role, content }) => ({ role, content })),
    };
  }
  const older = complete.slice(0, -20);
  const latest = complete.slice(-20);
  const digest = {
    kind: "validated_conversation_digest",
    authoritativeStateWins: true,
    confirmedPreferences: input.state.agentSession.preferences.map(
      ({ type, subject, value }) => ({ type, subject, value }),
    ),
    dialogueExcerpts: older.slice(-40).map(({ role, content }) => ({
      role,
      content: content.replace(/\s+/g, " ").slice(0, 240),
    })),
    pendingQuestion:
      input.state.agentSession.pendingInteraction?.type === "clarification"
        ? input.state.agentSession.pendingInteraction.prompt
        : null,
  };
  const through = older.at(-1);
  if (through) {
    await saveConversationSummary({
      profileId: input.profileId,
      throughMessageId: through.id,
      digest,
      lease: input.agentTurnLease,
    });
  }
  return {
    digest,
    messages: latest.map(({ role, content }) => ({ role, content })),
  };
}

function draftCandidateFromArguments(args: ProposalArguments): DraftCandidate {
  return {
    summary: args.summary,
    meals: args.meals.map((meal) => ({
      id: meal.id,
      items: meal.items.map((item) => ({ ...item, alternatives: [] })),
    })),
  };
}

function reviewDraftAttempt(input: {
  attempt: number;
  candidate: DraftCandidate;
  plan: DraftProposal["plan"];
  profile: StructuredProfile;
  catalog: CatalogFood[];
  issues: string[];
}): DraftAttemptReview {
  const catalogById = new Map(input.catalog.map((food) => [food.id, food]));
  return {
    attempt: input.attempt,
    summary: input.candidate.summary,
    meals: input.plan.meals.map((meal) => ({
      id: meal.id,
      name: meal.name,
      items: meal.items.map((item) => ({
        catalogFoodId: item.catalogFoodId,
        displayName:
          catalogById.get(item.catalogFoodId)?.displayName ??
          item.catalogFoodId,
        grams: item.grams,
      })),
    })),
    totals: input.plan.validation.totals,
    checks: buildPlanValidationExplanation(input.profile, input.plan),
    issues: input.issues.map((issue) => issue.trim()).filter(Boolean),
  };
}

function rangeRepair(
  actual: number,
  minimum: number,
  maximum: number,
  unit: string,
) {
  const action =
    actual < minimum
      ? `increase by at least ${(minimum - actual).toFixed(1)} ${unit}`
      : actual > maximum
        ? `decrease by at least ${(actual - maximum).toFixed(1)} ${unit}`
        : "keep within this range";
  return { actual, minimum, maximum, action };
}

function draftRepairGuidance(
  profile: StructuredProfile,
  plan: DraftProposal["plan"],
) {
  const ranges = getPlanNutritionRanges(profile, plan.targetSnapshot);
  const percentages = plan.validation.macroPercentages;
  return {
    requiredMealIdsInOrder:
      profile.mealPattern === null
        ? []
        : getExpectedMealIds(profile.mealPattern),
    instruction:
      "Keep the exact meal IDs and order. Make the smallest legal portion or food changes that bring every failed value into range without moving a passed value out of range.",
    ...(ranges
      ? {
          energyKcal: rangeRepair(
            plan.validation.totals.energyKcal,
            ranges.energyKcal.minimum,
            ranges.energyKcal.maximum,
            "kcal",
          ),
          proteinG: rangeRepair(
            plan.validation.totals.proteinG,
            ranges.proteinG.minimum,
            ranges.proteinG.maximum,
            "g",
          ),
          carbohydratePercent: rangeRepair(
            percentages.carbohydrate,
            ranges.carbohydratePercent.minimum,
            ranges.carbohydratePercent.maximum,
            "percentage points",
          ),
          fatPercent: rangeRepair(
            percentages.fat,
            ranges.fatPercent.minimum,
            ranges.fatPercent.maximum,
            "percentage points",
          ),
          fiberG: {
            actual: plan.validation.totals.fiberG,
            minimum: ranges.fiberMinimumG,
            action:
              plan.validation.totals.fiberG < ranges.fiberMinimumG
                ? `increase by at least ${(ranges.fiberMinimumG - plan.validation.totals.fiberG).toFixed(1)} g`
                : "keep at or above the minimum",
          },
        }
      : {}),
  };
}

function plansUsingFood(state: PersistedDemoState, foodId: string) {
  const hasFood = (plan: {
    meals: Array<{ items: Array<{ catalogFoodId: string }> }>;
  }) =>
    plan.meals.some((meal) =>
      meal.items.some((item) => item.catalogFoodId === foodId),
    );
  return {
    inDraft: state.draft ? hasFood(state.draft.plan) : false,
    inActivePlan: state.activePlan ? hasFood(state.activePlan.plan) : false,
  };
}

function adjustedTargetsFor(
  state: Exclude<PersistedDemoState, { profile: unknown }>,
) {
  const decision = evaluateWeightAdjustmentDecision({
    goal: existingReadyProfile.goal!,
    measurements: state.measurements,
    activePlan: state.activePlan,
  });
  if (
    decision.status !== "adjustment_available" ||
    !decision.direction ||
    decision.adjustmentKcal === null
  )
    return null;
  const { direction, adjustmentKcal } = decision;
  const base = state.activePlan.plan.targetSnapshot;
  const energyKcal =
    base.energyKcal +
    (direction === "increase" ? adjustmentKcal : -adjustmentKcal);
  return {
    trend: decision.trend,
    maintenanceDrift: decision.maintenanceDrift,
    direction,
    adjustmentKcal,
    targets: {
      ...base,
      energyKcal,
      carbohydrateTargetG:
        (energyKcal - base.proteinTargetG * 4 - base.fatTargetG * 9) / 4,
    },
  };
}

function interaction(
  id: string,
  value: InteractionWithoutId,
): AgentInteraction {
  return { id, ...value } as AgentInteraction;
}

async function searchFoods(input: {
  profileId: "new" | "existing";
  query: string;
  replyLanguage: "Hebrew" | "English";
  preparation: "cooked" | "raw" | "packaged" | null;
  rateIdentity: RateIdentity;
  turnId: string;
  agentTurnLease?: {
    profileId: "new" | "existing";
    commandId: string;
    leaseToken: string;
  };
  onStatus: (value: Status) => void;
}) {
  const existing = await findCatalogFood(input.query);
  if (existing) return { outcome: "existing" as const, food: existing };
  if (input.agentTurnLease) {
    await renewAgentTurnLease(input.agentTurnLease);
  }
  if (!(await recordAndCheckRateLimit(input.rateIdentity))) {
    return {
      outcome: "rate_limited" as const,
      message: "The food-search limit has been reached. Try again later.",
    };
  }
  const lookup = await createLookup(
    {
      profileId: input.profileId,
      query: input.query,
      context: { turnId: input.turnId, preparation: input.preparation },
      status: "searching",
      failureCode: null,
    },
    input.agentTurnLease,
  );
  input.onStatus("searching");
  try {
    const arguments_ = {
      normalizedEnglishQuery: input.query,
      preparation: input.preparation,
    };
    const summaries = await searchUsdaFoodSummaries(arguments_, {
      onStage: (stage, details = {}) =>
        console.info("agent_food_lookup_stage", {
          turnId: input.turnId,
          lookupId: lookup.id,
          stage,
          ...details,
        }),
    });
    const ranking = await rankUsdaCandidates({
      query: input.query,
      replyLanguage: input.replyLanguage,
      candidates: summaries,
    });
    if (ranking.outcome === "clarification") {
      await updateLookup(
        lookup.id,
        {
          status: "failed",
          failureCode: "needs_clarification",
        },
        input.agentTurnLease,
      );
      return {
        outcome: "needs_clarification" as const,
        prompt: ranking.message,
      };
    }
    const summaryById = new Map(
      summaries.map((summary) => [summary.fdcId, summary]),
    );
    const selectedSummaries = ranking.candidateFdcIds.map((fdcId) => {
      const summary = summaryById.get(fdcId);
      if (!summary) {
        throw new Error(
          "The ranked USDA candidate was not in the search pool.",
        );
      }
      return summary;
    });
    const candidates = await resolveUsdaFoodCandidates(selectedSummaries, {
      onStage: (stage, details = {}) =>
        console.info("agent_food_lookup_stage", {
          turnId: input.turnId,
          lookupId: lookup.id,
          stage,
          ...details,
        }),
    });
    await saveCandidates(
      candidates.map((candidate) => ({
        id: candidate.id,
        lookupId: lookup.id,
        sourceUrl: usdaFoodUrl(candidate.fdcId),
        sourceIdentifier: `usda:${candidate.fdcId}`,
        status: "summary" as const,
        data: { ...candidate, toolArguments: arguments_ },
      })),
      input.agentTurnLease,
    );
    await updateLookup(
      lookup.id,
      { status: "ready", failureCode: null },
      input.agentTurnLease,
    );
    return { outcome: "candidates" as const, lookupId: lookup.id, candidates };
  } catch (error) {
    const failureCode =
      error instanceof UsdaUnavailableError ? error.code : "source_unavailable";
    await updateLookup(
      lookup.id,
      { status: "failed", failureCode },
      input.agentTurnLease,
    );
    console.error("agent_food_lookup_failed", {
      turnId: input.turnId,
      lookupId: lookup.id,
      stage: error instanceof UsdaUnavailableError ? error.stage : "usda",
      failureCode,
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return {
      outcome: "unavailable" as const,
      lookupId: lookup.id,
      query: input.query,
      failureCode,
    };
  }
}

export async function executeCoachTurn(input: {
  request: CoachMessageRequest;
  rateIdentity: RateIdentity;
  turnId: string;
  leaseToken: string | null;
  onStatus: (value: Status) => void;
  onText: (delta: string) => void;
}): Promise<CoachTurnResult> {
  const turnLease = input.leaseToken
    ? {
        profileId: input.request.profileId,
        commandId: input.request.commandId,
        leaseToken: input.leaseToken,
      }
    : undefined;
  let profile = await getProfile(input.request.profileId);
  let state = reconcileAgentWorkflowState(structuredClone(profile.state));
  let catalog = await listCatalogFoods();
  let approvedCatalogFood: CatalogFood | undefined;
  let actionSummary: Record<string, unknown> | null = null;
  let requiredCatalogFoodId =
    state.agentSession.planChange?.requiredCatalogFoodIds[0] ?? null;
  let proposalAttempts = 0;
  let toolStatePersisted = false;
  const turnCurrentDate = new Date().toISOString().slice(0, 10);
  let resolvedHistoricalWeightUpsert: ResolvedHistoricalWeightUpsert | null =
    null;
  let resolvedTodayWeightUpsert: number | null = null;
  let resolvedWeightDelete: string | null = null;
  let weightConfirmation: string | null = null;
  const rejectedDraftAttempts: DraftAttemptReview[] = [];
  const executedToolNames: CoachToolName[] = [];

  const activePlanVersion = state.activePlan?.version ?? null;

  const currentInteraction = state.agentSession.pendingInteraction;
  const interactionAtTurnStart = currentInteraction;
  console.info("coach_turn_received", {
    turnId: input.turnId,
    commandId: input.request.commandId,
    profileId: input.request.profileId,
    profileVersion: profile.version,
    inputType: input.request.input.type,
    action:
      input.request.input.type === "interaction"
        ? input.request.input.action
        : "text",
    pendingInteractionId: currentInteraction?.id ?? null,
    pendingInteractionType: currentInteraction?.type ?? null,
    activePlanVersion,
    hasDraft: Boolean(state.draft),
  });
  if (input.request.input.type === "interaction") {
    input.onStatus("validating");
    const action = input.request.input.action;
    const isSessionReview = action === "review_trend";
    const isAdjustmentGeneration = action === "generate_adjustment";
    if (action === "approve_draft" || action === "reject_draft") {
      const pending = currentInteraction;
      if (
        !pending ||
        pending.type !== "draft_approval" ||
        !state.draft ||
        pending.id !== input.request.input.interactionId ||
        pending.proposalId !== state.draft.id
      ) {
        throw new Error("That Draft is no longer awaiting review.");
      }
      if (action === "approve_draft") {
        const authoritativeTargets =
          state.activePlan?.plan.targetSnapshot ??
          calculateTargets(structuredProfileOf(state));
        if (!authoritativeTargets) {
          throw new Error(
            "The Draft is stale or failed deterministic validation.",
          );
        }
        const plan = validateAndBuildPlan({
          candidate: candidateFromPlan(state.draft.plan),
          profile: structuredProfileOf(state),
          targets: authoritativeTargets,
          planId: state.draft.plan.id,
          version: state.draft.plan.version,
          catalog: createCatalogSnapshot(catalog),
        });
        if (
          !plan.validation.valid ||
          state.draft.basePlanVersion !== (state.activePlan?.version ?? null)
        ) {
          throw new Error(
            "The Draft is stale or failed deterministic validation.",
          );
        }
        const nextVersion = (state.activePlan?.version ?? 0) + 1;
        state = setInteraction(
          {
            ...state,
            draft: null,
            agentSession: { ...state.agentSession, planChange: null },
            activePlan: {
              schemaVersion: 1,
              version: nextVersion,
              activatedAt: new Date().toISOString(),
              maintenanceReferenceWeightKg:
                maintenanceReferenceWeightFromRecentMeasurements(
                  measurementsOf(state),
                ) ?? structuredProfileOf(state).currentWeightKg,
              plan,
            },
          },
          null,
        );
        actionSummary = {
          event: "draft_approved",
          activePlanVersion: nextVersion,
        };
      } else {
        const retainedPlanChange = state.agentSession.planChange
          ? retainPlanChangeAfterDraftRejection(
              state.agentSession.planChange,
              state,
            )
          : startPlanChange({ ...state, draft: null });
        state = setInteraction(
          {
            ...state,
            draft: null,
            agentSession: {
              ...state.agentSession,
              planChange: retainedPlanChange,
            },
          },
          interaction(randomUUID(), {
            type: "clarification",
            workflow: "draft",
            prompt: "What would you like changed in the next Draft?",
            quickReplies: [],
            planChangeId: retainedPlanChange.id,
          }),
        );
        actionSummary = { event: "draft_rejected", askWhatToCorrect: true };
      }
    } else if (!isSessionReview) {
      if (
        !currentInteraction ||
        currentInteraction.id !== input.request.input.interactionId
      ) {
        throw new Error(
          "That interaction is no longer active. Reload and try again.",
        );
      }
    }
    if (isSessionReview) {
      if ("profile" in state) {
        throw new Error("The trend review is available in the Existing demo.");
      }
      const expectedId = `existing-session-review-v${state.activePlan.version}`;
      if (input.request.input.interactionId !== expectedId) {
        throw new Error("That session review is no longer current.");
      }
      const adjustment = adjustedTargetsFor(state);
      const reviewedTrend = calculateWeightTrend(state.measurements, {
        activePlanActivatedAt: state.activePlan?.activatedAt,
      });
      if (adjustment && !state.draft && !currentInteraction) {
        state = setInteraction(
          state,
          interaction(`adjustment-offer-v${state.activePlan.version}`, {
            type: "adjustment_offer",
            basePlanVersion: state.activePlan.version,
            direction: adjustment.direction,
            adjustmentKcal: adjustment.adjustmentKcal,
          }),
        );
      }
      actionSummary = {
        event: "existing_session_trend_review",
        trend: reviewedTrend,
        adjustmentAvailable: Boolean(adjustment),
      };
    } else if (isAdjustmentGeneration) {
      const pending = currentInteraction;
      if (
        !pending ||
        pending.type !== "adjustment_offer" ||
        "profile" in state ||
        state.draft ||
        pending.basePlanVersion !== state.activePlan.version
      ) {
        throw new Error("There is no current adjustment offer.");
      }
      actionSummary = {
        event: "generate_adjustment_requested",
        direction: pending.direction,
        adjustmentKcal: pending.adjustmentKcal,
      };
    } else if (action === "select_candidate") {
      const pending = currentInteraction;
      if (
        !pending ||
        pending.type !== "food_candidates" ||
        !input.request.input.candidateId
      )
        throw new Error("Choose one displayed candidate.");
      const selected = await prepareFoodCandidate({
        profileId: input.request.profileId,
        candidateId: input.request.input.candidateId,
        agentTurnLease: turnLease,
      });
      state = setInteraction(
        state,
        interaction(randomUUID(), {
          type: "food_approval",
          candidate: selected,
          planChangeId: pending.planChangeId ?? null,
        }),
      );
      actionSummary = {
        event: "candidate_selected",
        candidate: {
          name: selected.food.displayName,
          nutrientsPer100g: selected.food.nutrientsPer100g,
        },
        approvalRequired: true,
      };
    } else if (action === "approve_food") {
      const pending = currentInteraction;
      if (!pending || pending.type !== "food_approval")
        throw new Error("There is no food awaiting approval.");
      const stored = await getCandidate(pending.candidate.id);
      const result = await approveCatalogFood({
        food: {
          ...pending.candidate.food,
          runtimeApproval: {
            approvedAt: new Date().toISOString(),
            approvedByProfileId: input.request.profileId,
          },
        },
        sourceIdentifier: stored.sourceIdentifier,
        profileId: input.request.profileId,
        expectedVersion: profile.version,
        commandId: `${input.request.commandId}:food`,
        agentTurnLease: turnLease,
      });
      await updateLookup(
        stored.lookupId,
        {
          status: "approved",
          failureCode: null,
        },
        turnLease,
      );
      profile = result.profile;
      const approvedPlanChange =
        pending.planChangeId &&
        profile.state.agentSession.planChange?.id === pending.planChangeId
          ? resolvePlanChangeFood(
              profile.state.agentSession.planChange,
              result.food.id,
            )
          : profile.state.agentSession.planChange;
      state = setInteraction(
        {
          ...profile.state,
          agentSession: {
            ...profile.state.agentSession,
            planChange: approvedPlanChange,
          },
        },
        interaction(randomUUID(), {
          type: "confirm_draft_food",
          foodId: result.food.id,
          displayName: result.food.displayName,
          planChangeId: approvedPlanChange?.id ?? null,
        }),
      );
      catalog = await listCatalogFoods();
      approvedCatalogFood = result.food;
      actionSummary = {
        event: "food_approved",
        food: result.food.displayName,
        askBeforeDraft: true,
      };
    } else if (action === "reject_food") {
      const pending = currentInteraction;
      if (!pending || pending.type !== "food_approval")
        throw new Error("There is no food awaiting review.");
      const stored = await getCandidate(pending.candidate.id);
      const lookup = await getLookup(stored.lookupId);
      await replaceCandidate({ ...stored, status: "rejected" }, turnLease);
      await updateLookup(
        lookup.id,
        { status: "rejected", failureCode: null },
        turnLease,
      );
      state = setInteraction(
        state,
        interaction(randomUUID(), {
          type: "clarification",
          workflow: "food",
          prompt: "What should I correct in the food search?",
          quickReplies: [],
        }),
      );
      actionSummary = { event: "food_rejected", askWhatToCorrect: true };
    } else if (action === "add_existing_food") {
      const pending = currentInteraction;
      if (!pending || pending.type !== "existing_food")
        throw new Error("There is no catalog food awaiting selection.");
      const result = await addExistingFoodToProfile({
        foodId: pending.food.id,
        profileId: input.request.profileId,
        expectedVersion: profile.version,
        commandId: `${input.request.commandId}:existing-food`,
        agentTurnLease: turnLease,
      });
      profile = result.profile;
      const existingPlanChange =
        pending.planChangeId &&
        profile.state.agentSession.planChange?.id === pending.planChangeId
          ? resolvePlanChangeFood(
              profile.state.agentSession.planChange,
              result.food.id,
            )
          : profile.state.agentSession.planChange;
      state = setInteraction(
        {
          ...profile.state,
          agentSession: {
            ...profile.state.agentSession,
            planChange: existingPlanChange,
          },
        },
        interaction(randomUUID(), {
          type: "confirm_draft_food",
          foodId: result.food.id,
          displayName: result.food.displayName,
          planChangeId: existingPlanChange?.id ?? null,
        }),
      );
      actionSummary = {
        event: "existing_food_added",
        food: result.food.displayName,
        askBeforeDraft: true,
      };
    } else if (action === "approve_adjustment") {
      const pending = currentInteraction;
      if (
        !pending ||
        pending.type !== "adjustment_approval" ||
        pending.id !== input.request.input.interactionId ||
        "profile" in state
      )
        throw new Error("There is no adjustment awaiting approval.");
      const draft = pending.draft;
      const adjustment = adjustedTargetsFor(state);
      if (!adjustment) throw new Error("The adjustment is stale or invalid.");
      const validatedPlan = validateAndBuildPlan({
        candidate: candidateFromPlan(draft.plan),
        profile: structuredProfileOf(state),
        targets: adjustment.targets,
        planId: draft.plan.id,
        version: draft.plan.version,
        catalog: createCatalogSnapshot(catalog),
      });
      if (
        draft.basePlanVersion !== state.activePlan.version ||
        !validatedPlan.validation.valid
      )
        throw new Error("The adjustment is stale or invalid.");
      state = setInteraction(
        {
          ...state,
          activePlan: {
            schemaVersion: 1,
            version: validatedPlan.version,
            activatedAt: new Date().toISOString(),
            maintenanceReferenceWeightKg:
              maintenanceReferenceWeightFromRecentMeasurements(
                state.measurements,
              ) ?? state.activePlan.maintenanceReferenceWeightKg,
            plan: validatedPlan,
          },
        },
        null,
      );
      actionSummary = {
        event: "adjustment_approved",
        activePlanVersion: validatedPlan.version,
      };
    } else if (action === "reject_adjustment") {
      const pending = currentInteraction;
      if (
        !pending ||
        pending.type !== "adjustment_approval" ||
        pending.id !== input.request.input.interactionId
      )
        throw new Error("There is no adjustment awaiting review.");
      state = setInteraction(
        state,
        interaction(randomUUID(), {
          type: "clarification",
          workflow: "adjustment",
          prompt: "What did you not like about the proposal?",
          quickReplies: [],
        }),
      );
      actionSummary = { event: "adjustment_rejected", askWhatToCorrect: true };
    } else if (action === "confirm_draft_food") {
      const pending = currentInteraction;
      if (!pending || pending.type !== "confirm_draft_food")
        throw new Error("There is no food continuation awaiting confirmation.");
      requiredCatalogFoodId = pending.foodId;
      const planChange =
        pending.planChangeId &&
        state.agentSession.planChange?.id === pending.planChangeId
          ? makePlanChangeDraftReady(state.agentSession.planChange, {
              requiredFoodId: pending.foodId,
            })
          : startPlanChange(state, {
              status: "ready_for_draft",
              requiredCatalogFoodIds: [pending.foodId],
              mustDiffer: true,
              scope: "food_replacement",
            });
      state = setInteraction(
        {
          ...state,
          agentSession: {
            ...state.agentSession,
            planChange,
          },
        },
        null,
      );
      actionSummary = {
        event: "draft_with_food_requested",
        requiredCatalogFoodId: pending.foodId,
        displayName: pending.displayName,
      };
    } else if (action === "decline_draft_food") {
      const pending = currentInteraction;
      if (!pending || pending.type !== "confirm_draft_food")
        throw new Error(
          "There is no Draft continuation awaiting confirmation.",
        );
      state = setInteraction(
        {
          ...state,
          agentSession: { ...state.agentSession, planChange: null },
        },
        null,
      );
      actionSummary = { event: "draft_continuation_declined" };
    } else if (action === "confirm_ai_estimate") {
      const pending = currentInteraction;
      if (!pending || pending.type !== "source_unavailable")
        throw new Error(
          "There is no failed source lookup awaiting confirmation.",
        );
      const candidate = await prepareAiEstimate({
        profileId: input.request.profileId,
        lookupId: pending.lookupId,
        agentTurnLease: turnLease,
      });
      state = setInteraction(
        state,
        interaction(randomUUID(), { type: "food_approval", candidate }),
      );
      actionSummary = {
        event: "ai_estimate_prepared",
        approvalRequired: true,
        provenance: candidate.sourceLabel,
      };
    } else if (action === "refine_search") {
      const pending = currentInteraction;
      if (!pending || pending.type !== "source_unavailable")
        throw new Error("There is no food search awaiting refinement.");
      state = setInteraction(
        state,
        interaction(randomUUID(), {
          type: "clarification",
          workflow: "food",
          prompt: "How should I refine the food name?",
          quickReplies: [],
        }),
      );
      actionSummary = { event: "search_refinement_requested" };
    }
  }

  if (
    input.request.input.type === "interaction" &&
    !coachInputRequiresModel(input.request.input)
  ) {
    const assistantText = deterministicInteractionText(
      input.request.input,
      actionSummary,
    );
    if (!assistantText) {
      throw new Error(
        "The interaction did not produce a deterministic result.",
      );
    }
    profile = await atTurnStage("profile_persist", () =>
      mutateProfile({
        profileId: input.request.profileId,
        expectedVersion: profile.version,
        commandId: input.request.commandId,
        agentTurnLease: turnLease,
        mutation: () => state,
      }),
    );
    input.onText(assistantText);
    return { profile, catalogFood: approvedCatalogFood, assistantText };
  }

  const executeToolCore = async (
    call: CoachToolCall,
  ): Promise<Record<string, unknown>> => {
    if (call.name !== "search_foods") input.onStatus("validating");
    const args = call.arguments as Record<string, unknown>;
    if (call.name === "submit_onboarding_facts") {
      const handled = submitOnboardingFacts({
        state,
        facts: args.facts as Record<string, unknown>,
        acknowledgement: String(args.acknowledgement),
        supportingMessageId: String(args.supportingMessageId),
        currentMessageId:
          input.request.input.type === "text"
            ? `user-${input.request.commandId}`
            : null,
        currentDate: turnCurrentDate,
        commandId: input.request.commandId,
      });
      state = handled.state;
      return handled.result;
    }
    if (call.name === "remember_preference") {
      const supportingMessageId = String(args.supportingMessageId);
      const recentUserMessages = (
        await listConversationMessages(input.request.profileId)
      )
        .filter((item) => item.role === "user")
        .slice(-6);
      const message = recentUserMessages.find(
        (item) => item.id === supportingMessageId,
      );
      const subject = String(args.subject);
      if (!message || !textValuesOverlap(message.content, subject)) {
        return toolResult(
          "blocked",
          "missing_source_evidence",
          "That preference is not supported by a stored user message.",
        );
      }
      const preference = {
        id: `preference-${randomUUID()}`,
        type: args.type as
          "food" | "meal_distribution" | "meal_timing" | "preparation",
        subject,
        value: String(args.value),
        supportingMessageId,
        createdAt: new Date().toISOString(),
      };
      const withoutPrevious = state.agentSession.preferences.filter(
        (item) =>
          item.type !== preference.type ||
          item.subject.toLocaleLowerCase("en-US") !==
            preference.subject.toLocaleLowerCase("en-US"),
      );
      state = {
        ...state,
        agentSession: {
          ...state.agentSession,
          preferences: [...withoutPrevious, preference].slice(-100),
        },
      };
      input.onStatus("remembering");
      await appendConversationActivity({
        profileId: input.request.profileId,
        id: `activity-${input.turnId}-preference-${state.agentSession.preferences.length}`,
        turnId: input.turnId,
        kind: "remembering_preference",
        label: `Remembering your preference: ${preference.subject} — ${preference.value}`,
        lease: turnLease,
      });
      return {
        saved: true,
        preference: {
          type: preference.type,
          subject: preference.subject,
          value: preference.value,
        },
      };
    }
    if (call.name === "remove_approved_food") {
      const handled = removeApprovedFood({
        state,
        catalog,
        foodId: String(args.catalogFoodId),
        currentText:
          input.request.input.type === "text" ? input.request.input.text : null,
      });
      state = handled.state;
      return handled.result;
    }
    if (call.name === "inspect_food_availability") {
      const requestedQuery = String(args.query);
      input.onStatus("checking_foods");
      const query = requestedQuery.toLocaleLowerCase("en-US");
      const matches = catalog
        .filter((food) =>
          `${food.displayName} ${food.preparation}`
            .toLocaleLowerCase("en-US")
            .includes(query),
        )
        .slice(0, 10)
        .map((food) => ({
          id: food.id,
          name: food.displayName,
          preparation: food.preparation,
          centrallyAvailable: true,
          approvedForProfile: approvedIdsOf(state).includes(food.id),
          ...plansUsingFood(state, food.id),
        }));
      await appendConversationActivity({
        profileId: input.request.profileId,
        id: `activity-${input.turnId}-inspect-${proposalAttempts}`,
        turnId: input.turnId,
        kind: "checking_foods",
        label: "Checking your foods and plans",
        lease: turnLease,
      });
      return toolResult(
        "completed",
        "food_availability_inspected",
        "Food availability was inspected.",
        { query: String(args.query), matches },
      );
    }
    if (call.name === "offer_approved_food_alternatives") {
      const handled = offerApprovedFoodAlternatives({
        state,
        catalog,
        excludedFoodIds: args.excludedCatalogFoodIds as string[],
        evidence: String(args.evidence),
        sourceMessageId: String(args.sourceMessageId),
        currentMessageId:
          input.request.input.type === "text"
            ? `user-${input.request.commandId}`
            : null,
        currentText:
          input.request.input.type === "text" ? input.request.input.text : null,
      });
      state = handled.state;
      return handled.result;
    }
    if (
      call.name === "record_weight" ||
      call.name === "edit_weight" ||
      call.name === "delete_weight"
    ) {
      const handled = executeWeightTool({
        name: call.name,
        state,
        commandId: input.request.commandId,
        currentDate: turnCurrentDate,
        todayWeight: resolvedTodayWeightUpsert,
        historicalWeight: resolvedHistoricalWeightUpsert,
        deleteDate: resolvedWeightDelete,
      });
      state = handled.state;
      weightConfirmation = handled.confirmation;
      return handled.result;
    }
    if (call.name === "search_foods") {
      const requestedFoodPhrase = String(args.requestedFoodPhrase);
      const normalizedEnglishQuery = String(args.normalizedEnglishQuery);
      const purpose = args.purpose as "catalog_only" | "integrate_into_plan";
      if (
        input.request.input.type !== "text" ||
        !textValuesOverlap(input.request.input.text, requestedFoodPhrase)
      ) {
        return toolResult(
          "blocked",
          "missing_source_evidence",
          "The requested food phrase must come from the current message.",
        );
      }
      const planChange =
        purpose === "integrate_into_plan"
          ? startPlanChange(state, {
              status: "resolving_foods",
              sourceMessageId: `user-${input.request.commandId}`,
              requestEvidence: requestedFoodPhrase,
              unresolvedFoodNames: [requestedFoodPhrase],
              scope: "food_replacement",
              mustDiffer: true,
            })
          : null;
      if (planChange) {
        state = {
          ...state,
          agentSession: { ...state.agentSession, planChange },
        };
      }
      const result = await searchFoods({
        profileId: input.request.profileId,
        query: normalizedEnglishQuery,
        replyLanguage:
          input.request.input.type === "text" &&
          /[\u0590-\u05ff]/.test(input.request.input.text)
            ? "Hebrew"
            : "English",
        preparation: null,
        rateIdentity: input.rateIdentity,
        turnId: input.turnId,
        agentTurnLease: turnLease,
        onStatus: input.onStatus,
      });
      input.onStatus("validating");
      if (result.outcome === "rate_limited") {
        return toolResult(
          "blocked",
          "food_search_rate_limited",
          result.message,
        );
      }
      if (result.outcome === "needs_clarification") {
        const next = interaction(randomUUID(), {
          type: "clarification",
          workflow: "food",
          prompt: result.prompt,
          quickReplies: [],
          planChangeId: planChange?.id ?? null,
        });
        state = setInteraction(state, next);
        return toolResult(
          "needs_user_action",
          "food_clarification_required",
          "A focused food clarification is required.",
          { outcome: "needs_clarification", interaction: next },
        );
      }
      if (result.outcome === "existing") {
        const alreadyApproved = approvedIdsOf(state).includes(result.food.id);
        if (planChange && alreadyApproved) {
          const readyPlanChange = makePlanChangeDraftReady(planChange, {
            requiredFoodId: result.food.id,
          });
          state = {
            ...state,
            agentSession: {
              ...state.agentSession,
              planChange: readyPlanChange,
            },
          };
          requiredCatalogFoodId = result.food.id;
          return toolResult(
            "completed",
            "approved_food_resolved",
            "The requested food is already approved and the Plan Change is ready for a Draft.",
            {
              outcome: "existing_approved",
              planChangeId: readyPlanChange.id,
              food: { id: result.food.id, name: result.food.displayName },
            },
          );
        }
        if (!planChange && alreadyApproved) {
          return toolResult(
            "completed",
            "food_already_approved",
            "The food is already approved for this profile.",
            {
              outcome: "existing_approved",
              food: { id: result.food.id, name: result.food.displayName },
            },
          );
        }
        if (planChange) {
          state = {
            ...state,
            agentSession: {
              ...state.agentSession,
              planChange: waitForFoodApproval(planChange),
            },
          };
        }
        const next = interaction(randomUUID(), {
          type: "existing_food",
          food: result.food,
          alreadyApproved,
          planChangeId: planChange?.id ?? null,
        });
        state = setInteraction(state, next);
        return toolResult(
          "needs_user_action",
          "food_approval_required",
          "The catalog food requires a visible user action.",
          { outcome: "existing", interaction: next },
        );
      }
      if (result.outcome === "unavailable") {
        const next = interaction(randomUUID(), {
          type: "source_unavailable",
          lookupId: result.lookupId,
          query: result.query,
          failureCode: result.failureCode,
          planChangeId: planChange?.id ?? null,
        });
        state = setInteraction(state, next);
        return toolResult(
          "needs_user_action",
          "food_source_unavailable",
          "The verified source is unavailable and the user must choose the next step.",
          {
            outcome: "source_unavailable",
            interaction: next,
            aiEstimateRequiresExplicitConfirmation: true,
          },
        );
      }
      if (planChange) {
        state = {
          ...state,
          agentSession: {
            ...state.agentSession,
            planChange: waitForFoodApproval(planChange),
          },
        };
      }
      const next = interaction(randomUUID(), {
        type: "food_candidates",
        lookupId: result.lookupId,
        candidates: result.candidates,
        planChangeId: planChange?.id ?? null,
      });
      state = setInteraction(state, next);
      return toolResult(
        "needs_user_action",
        "food_candidate_selection_required",
        "Food candidates are ready for user selection.",
        {
          outcome: "candidates",
          count: result.candidates.length,
          candidates: result.candidates.map((candidate, index) => ({
            ordinal: index + 1,
            id: candidate.id,
            name: candidate.title,
            dataset: candidate.dataType,
            preparation: candidate.description,
            nutrientsPer100g: candidate.nutrientsPer100g,
          })),
        },
      );
    }
    if (call.name === "select_food_candidate") {
      const pending = state.agentSession.pendingInteraction;
      if (
        !pending ||
        pending.type !== "food_candidates" ||
        !pending.candidates.some(
          (candidate) => candidate.id === args.candidateId,
        )
      )
        return toolResult(
          "blocked",
          "candidate_not_current",
          "Select one of the currently displayed candidates.",
        );
      const selected = await prepareFoodCandidate({
        profileId: input.request.profileId,
        candidateId: String(args.candidateId),
        agentTurnLease: turnLease,
      });
      const next = interaction(randomUUID(), {
        type: "food_approval",
        candidate: selected,
        planChangeId: pending.planChangeId ?? null,
      });
      state = setInteraction(state, next);
      return toolResult(
        "needs_user_action",
        "food_approval_required",
        "The selected food is ready for explicit approval.",
        {
          selected: {
            name: selected.food.displayName,
            nutrientsPer100g: selected.food.nutrientsPer100g,
          },
          approvalRequired: true,
        },
      );
    }
    if (call.name === "submit_draft_proposal") {
      proposalAttempts += 1;
      input.onStatus(state.draft ? "revising_draft" : "creating_draft");
      const proposalArguments = call.arguments as DraftProposalArguments;
      const changeContext =
        proposalArguments.changeContext ??
        (input.request.input.type === "interaction" &&
        input.request.input.action === "confirm_draft_food" &&
        state.agentSession.planChange
          ? {
              kind: "continuation" as const,
              planChangeId: state.agentSession.planChange.id,
              selectedAlternativeFoodId: null,
              retryStrategy: null,
            }
          : null);
      if (!changeContext) {
        return toolResult(
          "blocked",
          "missing_change_context",
          "A Draft proposal must identify a new request or an active Plan Change.",
        );
      }
      if (changeContext.kind === "new_request") {
        if (
          input.request.input.type !== "text" ||
          !textValuesOverlap(input.request.input.text, changeContext.evidence)
        ) {
          return toolResult(
            "blocked",
            "missing_source_evidence",
            "A new Draft request must be supported by the current message.",
          );
        }
        const approvedIds = new Set(approvedIdsOf(state));
        if (
          [
            ...changeContext.requiredCatalogFoodIds,
            ...changeContext.excludedCatalogFoodIds,
          ].some((foodId) => !approvedIds.has(foodId))
        ) {
          return toolResult(
            "blocked",
            "unapproved_plan_constraint",
            "Draft constraints may reference only foods approved for this profile.",
          );
        }
        state = {
          ...state,
          agentSession: {
            ...state.agentSession,
            planChange: startPlanChange(state, {
              status: "ready_for_draft",
              sourceMessageId: `user-${input.request.commandId}`,
              requestEvidence: changeContext.evidence,
              requiredCatalogFoodIds: changeContext.requiredCatalogFoodIds,
              excludedCatalogFoodIds: changeContext.excludedCatalogFoodIds,
              scope: changeContext.scope,
              mustDiffer: Boolean(state.activePlan || state.draft),
            }),
          },
        };
      } else {
        const current = state.agentSession.planChange;
        if (!current || current.id !== changeContext.planChangeId) {
          return toolResult(
            "blocked",
            "stale_plan_change",
            "That Plan Change is no longer active.",
          );
        }
        if (
          changeContext.selectedAlternativeFoodId &&
          !current.offeredAlternativeFoodIds.includes(
            changeContext.selectedAlternativeFoodId,
          )
        ) {
          return toolResult(
            "blocked",
            "invalid_alternative_selection",
            "The selected food was not one of the stored alternatives.",
          );
        }
        state = {
          ...state,
          agentSession: {
            ...state.agentSession,
            planChange: makePlanChangeDraftReady(current, {
              selectedAlternativeFoodId:
                changeContext.selectedAlternativeFoodId,
              retryStrategy: changeContext.retryStrategy,
            }),
          },
        };
      }
      const activePlanChange = state.agentSession.planChange;
      if (
        !activePlanChange ||
        activePlanChange.unresolvedFoodNames.length > 0 ||
        activePlanChange.status !== "ready_for_draft"
      ) {
        return toolResult(
          "blocked",
          "plan_change_not_ready",
          "Resolve the Plan Change prerequisites before submitting a Draft.",
          { planChangeId: activePlanChange?.id ?? null },
        );
      }
      const draftProfile = structuredProfileOf(state);
      const targets =
        state.activePlan?.plan.targetSnapshot ?? calculateTargets(draftProfile);
      if (!targets) {
        return toolResult(
          "blocked",
          "profile_not_ready",
          "The profile is not ready for a Draft.",
        );
      }
      const candidate = draftCandidateFromArguments(proposalArguments);
      const planChangeEvaluation = planChangeCandidateIssues(state, candidate);
      const { includesRequiredFood } = planChangeEvaluation;
      const plan = validateAndBuildPlan({
        candidate,
        profile: draftProfile,
        targets,
        planId: `plan-${input.request.commandId}`,
        version: (state.activePlan?.version ?? 0) + 1,
        catalog: createCatalogSnapshot(catalog),
      });
      const issues = [...planChangeEvaluation.issues, ...plan.validation.issues]
        .map((issue) => issue.trim())
        .filter(Boolean)
        .slice(0, 20);
      console.info("coach_proposal_validated", {
        turnId: input.turnId,
        commandId: input.request.commandId,
        profileId: input.request.profileId,
        proposalKind: "draft",
        attempt: proposalAttempts,
        valid: issues.length === 0,
        issueCount: issues.length,
        requiredFoodSatisfied: includesRequiredFood,
      });
      if (issues.length > 0) {
        const reviewedAttempt = reviewDraftAttempt({
          attempt: proposalAttempts,
          candidate,
          plan,
          profile: draftProfile,
          catalog,
          issues,
        });
        rejectedDraftAttempts.push(reviewedAttempt);
        if (proposalAttempts >= 3) {
          const failedPlanChange = markPlanChangeFailure(activePlanChange);
          state = setInteraction(
            {
              ...state,
              agentSession: {
                ...state.agentSession,
                planChange: failedPlanChange,
              },
            },
            interaction(randomUUID(), {
              type: "draft_failure_review",
              attempts: structuredClone(rejectedDraftAttempts),
              prompt:
                "For the next Draft, should I keep this food structure and use smaller portions, or use a different mix of your approved foods?",
              planChangeId: failedPlanChange.id,
            }),
          );
        }
        return toolResult(
          proposalAttempts >= 3 ? "needs_user_action" : "rejected",
          "draft_validation_failed",
          "The Draft failed deterministic validation.",
          {
            accepted: false,
            attempt: proposalAttempts,
            attemptsRemaining: Math.max(0, 3 - proposalAttempts),
            issues,
            actualTotals: plan.validation.totals,
            requiredTargets: targets,
            repairGuidance: draftRepairGuidance(draftProfile, plan),
            attemptedDraft: reviewedAttempt,
            failedAttempts: structuredClone(rejectedDraftAttempts),
            afterThirdFailure:
              proposalAttempts >= 3
                ? "The visible draft_failure_review contains the complete observable attempt history. Briefly direct the user to it and ask its focused question. Do not omit grams, invent reasoning, or submit another proposal in this turn."
                : null,
          },
        );
      }
      const draft: DraftProposal = {
        schemaVersion: 1,
        id: `draft-${input.request.commandId}`,
        basePlanVersion: state.activePlan?.version ?? null,
        reason: state.activePlan || state.draft ? "modification" : "initial",
        summary: candidate.summary,
        plan,
      };
      state = setInteraction(
        {
          ...state,
          draft,
          agentSession: {
            ...state.agentSession,
            planChange: markPlanChangeDraftPending(activePlanChange, draft.id),
          },
        },
        interaction(draft.id, {
          type: "draft_approval",
          proposalId: draft.id,
          planChangeId: activePlanChange.id,
        }),
      );
      requiredCatalogFoodId = null;
      await appendConversationActivity({
        profileId: input.request.profileId,
        id: `activity-${input.turnId}-draft-${proposalAttempts}`,
        turnId: input.turnId,
        kind: "checking_plan",
        label: "Checking plan safety",
        lease: turnLease,
      });
      return toolResult(
        "needs_user_action",
        "draft_approval_required",
        "The validated Draft is awaiting explicit approval.",
        {
          accepted: true,
          proposalId: draft.id,
          totals: draft.plan.validation.totals,
          approvalRequired: true,
          planChangeId: activePlanChange.id,
        },
      );
    }
    if (call.name === "submit_adjustment_proposal") {
      if ("profile" in state)
        return toolResult(
          "blocked",
          "existing_profile_required",
          "Adjustment is available in the Existing demo.",
        );
      if (state.draft)
        return toolResult(
          "blocked",
          "draft_already_pending",
          "Decline or approve the current Draft before creating an adjustment.",
        );
      proposalAttempts += 1;
      input.onStatus(
        proposalAttempts === 1 ? "creating_draft" : "revising_draft",
      );
      const adjustment = adjustedTargetsFor(state);
      if (!adjustment) {
        return toolResult(
          "blocked",
          "adjustment_not_supported",
          "The deterministic trend does not support an adjustment.",
        );
      }
      const candidate = draftCandidateFromArguments(
        call.arguments as ProposalArguments,
      );
      const adjustmentProfile = structuredProfileOf(state);
      const plan = validateAndBuildPlan({
        candidate,
        profile: adjustmentProfile,
        targets: adjustment.targets,
        planId: `plan-${input.request.commandId}`,
        version: state.activePlan.version + 1,
        catalog: createCatalogSnapshot(catalog),
      });
      console.info("coach_proposal_validated", {
        turnId: input.turnId,
        commandId: input.request.commandId,
        profileId: input.request.profileId,
        proposalKind: "adjustment",
        attempt: proposalAttempts,
        valid: plan.validation.valid,
        issueCount: plan.validation.issues.length,
      });
      if (!plan.validation.valid) {
        const reviewedAttempt = reviewDraftAttempt({
          attempt: proposalAttempts,
          candidate,
          plan,
          profile: adjustmentProfile,
          catalog,
          issues: plan.validation.issues.slice(0, 20),
        });
        rejectedDraftAttempts.push(reviewedAttempt);
        if (proposalAttempts >= 3) {
          state = setInteraction(
            state,
            interaction(randomUUID(), {
              type: "draft_failure_review",
              proposalKind: "adjustment",
              basePlanVersion: state.activePlan.version,
              attempts: structuredClone(rejectedDraftAttempts),
              prompt:
                "For the next adjustment Draft, should I keep the same foods and recalculate portions, or use a different mix of your approved foods?",
            }),
          );
        }
        return {
          accepted: false,
          attempt: proposalAttempts,
          attemptsRemaining: Math.max(0, 3 - proposalAttempts),
          issues: plan.validation.issues.slice(0, 20),
          actualTotals: plan.validation.totals,
          requiredTargets: adjustment.targets,
          requiredDirection: adjustment.direction,
          requiredAdjustmentKcal: adjustment.adjustmentKcal,
          attemptedDraft: reviewedAttempt,
          failedAttempts: structuredClone(rejectedDraftAttempts),
          afterThirdFailure:
            proposalAttempts >= 3
              ? "The visible adjustment failure review contains the complete observable attempt history. Direct the user to it and ask its focused question. Do not submit another proposal in this turn."
              : null,
        };
      }
      const draft: DraftProposal = {
        schemaVersion: 1,
        id: `adjustment-${input.request.commandId}`,
        basePlanVersion: state.activePlan.version,
        reason: "modification",
        summary: candidate.summary,
        plan,
      };
      const next = interaction(randomUUID(), {
        type: "adjustment_approval",
        draft,
      });
      state = setInteraction(state, next);
      return {
        proposal: draft,
        direction: adjustment.direction,
        adjustmentKcal: adjustment.adjustmentKcal,
        approvalRequired: true,
      };
    }
    throw new Error("Unsupported coach tool.");
  };

  let reachedUserDecision = false;
  const executeTool = async (call: CoachToolCall, sequence: number) => {
    console.info("coach_skill_started", {
      turnId: input.turnId,
      commandId: input.request.commandId,
      profileId: input.request.profileId,
      sequence,
      skill: call.name,
      proposalAttempt:
        call.name === "submit_draft_proposal" ||
        call.name === "submit_adjustment_proposal"
          ? proposalAttempts + 1
          : null,
    });
    await recordAgentSkillCall({
      profileId: input.request.profileId,
      commandId: input.request.commandId,
      sequence,
      name: call.name,
      arguments: call.arguments as Record<string, unknown>,
      result: null,
      status: "pending",
      lease: turnLease,
    });
    try {
      const stateBeforeTool = JSON.stringify(state);
      const rawResult = await executeToolCore(call);
      executedToolNames.push(call.name);
      const result: CoachToolResult =
        typeof rawResult.status === "string"
          ? (rawResult as CoachToolResult)
          : rawResult.accepted === false
            ? toolResult(
                proposalAttempts >= 3 ? "needs_user_action" : "rejected",
                `${call.name}_rejected`,
                "The proposal was rejected by deterministic validation.",
                rawResult,
              )
            : toolResult(
                "completed",
                `${call.name}_completed`,
                "The bounded action completed.",
                rawResult,
              );
      if (JSON.stringify(state) !== stateBeforeTool) {
        profile = await atTurnStage("skill_state_persist", () =>
          mutateProfile({
            profileId: input.request.profileId,
            expectedVersion: profile.version,
            commandId: `${input.request.commandId}:skill:${sequence}`,
            agentTurnLease: turnLease,
            mutation: () => state,
          }),
        );
        state = structuredClone(profile.state);
        toolStatePersisted = true;
      }
      reachedUserDecision = result.status === "needs_user_action";
      const rejected = result.status === "rejected";
      await recordAgentSkillCall({
        profileId: input.request.profileId,
        commandId: input.request.commandId,
        sequence,
        name: call.name,
        arguments: call.arguments as Record<string, unknown>,
        result,
        status: rejected ? "rejected" : "completed",
        lease: turnLease,
      });
      console.info("coach_skill_finished", {
        turnId: input.turnId,
        commandId: input.request.commandId,
        profileId: input.request.profileId,
        sequence,
        skill: call.name,
        status: result.status,
        proposalAttempt:
          call.name === "submit_draft_proposal" ||
          call.name === "submit_adjustment_proposal"
            ? proposalAttempts
            : null,
      });
      return result;
    } catch (error) {
      await recordAgentSkillCall({
        profileId: input.request.profileId,
        commandId: input.request.commandId,
        sequence,
        name: call.name,
        arguments: call.arguments as Record<string, unknown>,
        result: { safeFailure: "Skill execution failed safely." },
        status: "failed",
        lease: turnLease,
      });
      console.error("coach_skill_failed", {
        turnId: input.turnId,
        commandId: input.request.commandId,
        profileId: input.request.profileId,
        sequence,
        skill: call.name,
        name: error instanceof Error ? error.name : "UnknownError",
      });
      throw error;
    }
  };

  input.onStatus("thinking");
  const currentProfile = { ...profile, state };
  let loggedAllowedSkills = "";
  const getAllowed = () => {
    if (reachedUserDecision) return [];
    const allowed: CoachToolName[] =
      input.request.input.type === "text"
        ? [...coachToolNames]
        : input.request.input.action === "generate_adjustment"
          ? ["submit_adjustment_proposal"]
          : input.request.input.action === "confirm_draft_food"
            ? ["submit_draft_proposal"]
            : [];
    const signature = allowed.join(",");
    if (signature !== loggedAllowedSkills) {
      loggedAllowedSkills = signature;
      console.info("coach_skills_allowed", {
        turnId: input.turnId,
        commandId: input.request.commandId,
        profileId: input.request.profileId,
        allowedSkills: allowed,
        proposalAttempts,
      });
    }
    return allowed;
  };
  const shouldForceDraftProposal = () =>
    proposalAttempts < 3 &&
    input.request.input.type === "interaction" &&
    input.request.input.action === "confirm_draft_food";
  const shouldForceAdjustmentProposal = () =>
    proposalAttempts < 3 &&
    input.request.input.type === "interaction" &&
    input.request.input.action === "generate_adjustment";
  const contextWithoutDigest = {
    ...contextFor(
      currentProfile,
      catalog,
      input.request.input,
      getAllowed(),
      null,
      requiredCatalogFoodId,
    ),
    latestUserMessageId:
      input.request.input.type === "text"
        ? `user-${input.request.commandId}`
        : null,
    ...(actionSummary ? { completedVisibleControlEvent: actionSummary } : {}),
  };
  const conversation = await atTurnStage("conversation_load", () =>
    conversationForModel({
      profileId: input.request.profileId,
      state,
      contextWithoutDigest,
      currentInput: input.request.input,
      agentTurnLease: turnLease,
    }),
  );
  resolvedHistoricalWeightUpsert = resolveHistoricalWeightUpsert(
    input.request.input,
    conversation.messages,
    turnCurrentDate,
    interactionAtTurnStart?.type === "clarification" &&
      interactionAtTurnStart.workflow === "weight",
  );
  resolvedWeightDelete = resolveWeightDelete(
    input.request.input,
    conversation.messages,
    turnCurrentDate,
    interactionAtTurnStart?.type === "clarification" &&
      interactionAtTurnStart.workflow === "weight",
  );
  if (input.request.input.type === "text") {
    resolvedTodayWeightUpsert = weightFromText(input.request.input.text);
    if (
      resolvedTodayWeightUpsert === null &&
      interactionAtTurnStart?.type === "clarification" &&
      interactionAtTurnStart.workflow === "weight"
    ) {
      resolvedTodayWeightUpsert = standaloneWeightFromText(
        input.request.input.text,
      );
    }
  }
  let finalAgentText = "";
  const result = await runCoachAgent({
    getSystemPrompt: () =>
      buildArnoldSystemPrompt({
        ...contextFor(
          { ...profile, state },
          catalog,
          input.request.input,
          getAllowed(),
          conversation.digest,
          requiredCatalogFoodId,
        ),
        latestUserMessageId:
          input.request.input.type === "text"
            ? `user-${input.request.commandId}`
            : null,
        ...(actionSummary
          ? { completedVisibleControlEvent: actionSummary }
          : {}),
      }),
    conversation: conversation.messages,
    getAllowedTools: getAllowed,
    getRequiredFirstTool: () =>
      shouldForceAdjustmentProposal()
        ? "submit_adjustment_proposal"
        : shouldForceDraftProposal()
          ? "submit_draft_proposal"
          : null,
    onText: (value) => {
      finalAgentText += value;
    },
    onTool: executeTool,
  });
  const onlyWeightToolCompleted =
    executedToolNames.length === 1 &&
    (executedToolNames[0] === "record_weight" ||
      executedToolNames[0] === "edit_weight" ||
      executedToolNames[0] === "delete_weight");
  const assistantText =
    (onlyWeightToolCompleted ? weightConfirmation : finalAgentText.trim()) ||
    result.text.trim() ||
    "Done. What would you like to do next?";
  state = {
    ...state,
    agentSession: {
      ...state.agentSession,
      summary: conversation.digest
        ? JSON.stringify(conversation.digest).slice(0, 4_000)
        : state.agentSession.summary,
    },
  };

  if (
    !toolStatePersisted ||
    JSON.stringify(state) !== JSON.stringify(profile.state)
  ) {
    profile = await atTurnStage("profile_persist", () =>
      mutateProfile({
        profileId: input.request.profileId,
        expectedVersion: profile.version,
        commandId: toolStatePersisted
          ? `${input.request.commandId}:final`
          : input.request.commandId,
        agentTurnLease: turnLease,
        mutation: () => state,
      }),
    );
  }
  input.onText(assistantText);
  console.info("coach_turn_persisted", {
    turnId: input.turnId,
    commandId: input.request.commandId,
    profileId: input.request.profileId,
    profileVersion: profile.version,
    activePlanVersion: profile.state.activePlan?.version ?? null,
    draftId: profile.state.draft?.id ?? null,
    pendingInteractionId:
      profile.state.agentSession.pendingInteraction?.id ?? null,
    pendingInteractionType:
      profile.state.agentSession.pendingInteraction?.type ?? null,
  });
  return { profile, catalogFood: approvedCatalogFood, assistantText };
}
