import { randomUUID } from "node:crypto";
import {
  buildArnoldSystemPrompt,
  runCoachAgent,
  type CoachToolCall,
  type CoachToolName,
  type ProposalArguments,
} from "@/ai/coach-agent";
import { extractOnboardingFacts } from "@/ai/onboarding";
import { interpretTurnDecision } from "@/ai/turn-decision";
import { existingReadyProfile } from "@/data/demo-fixtures";
import type {
  AgentInteraction,
  CoachMessageRequest,
  DraftAttemptReview,
} from "@/domain/agent/types";
import {
  requestsFoodAlternativeOffer,
  type TurnDecision,
} from "@/domain/agent/turn-decision";
import { createCatalogSnapshot } from "@/domain/catalog/snapshot";
import type { CatalogFood } from "@/domain/catalog/types";
import { calculateTargets } from "@/domain/nutrition/calculations";
import {
  buildPlanValidationExplanation,
  candidateFromPlan,
  getExpectedMealIds,
  getPlanNutritionRanges,
  validateAndBuildPlan,
} from "@/domain/plan/validation";
import type { DraftCandidate, DraftProposal } from "@/domain/plan/types";
import {
  applyFactPatch,
  getNextTurn,
  isProfileReady,
} from "@/domain/profile/onboarding";
import type { StructuredProfile } from "@/domain/profile/types";
import { evaluateWeightAdjustmentDecision } from "@/domain/weight/decision";
import {
  calculateWeightTrend,
  currentPlanWeightFromMeasurements,
  formatWeightKg,
  maintenanceReferenceWeightFromInitialMeasurements,
  normalizeWeightKg,
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
  finishNonInteractiveWorkflow,
  interactionWorkflow,
  setInteraction,
} from "./interaction-state";
import {
  applyPlanChangeDecision,
  offeredFoodNames,
  planChangeCandidateIssues,
  startPlanChange,
} from "./plan-change-workflow";
import {
  allowedToolsForDecision,
  coachInputRequiresModel,
  decisionAuthorizesIntent,
  deterministicInteractionText,
} from "./turn-execution-policy";

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

function withMeasurements(
  state: PersistedDemoState,
  measurements: ReturnType<typeof measurementsOf>,
): PersistedDemoState {
  return "profile" in state
    ? { ...state, weightMeasurements: measurements }
    : { ...state, measurements };
}

function contextFor(
  profile: VersionedProfile,
  catalog: CatalogFood[],
  currentInput: CoachMessageRequest["input"],
  allowed: CoachToolName[],
  conversationDigest: Record<string, unknown> | null,
  requiredCatalogFoodId: string | null,
  turnDecision: TurnDecision | null,
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
    turnDecision,
    foodAlternativeRequest:
      turnDecision && requestsFoodAlternativeOffer(turnDecision)
        ? {
            responseMode: "offer_approved_options_only",
            offeredFoodIds:
              state.agentSession.planChange?.offeredAlternativeFoodIds ?? [],
            rules: [
              "Offer concise relevant choices matching offeredFoodIds only.",
              "Exclude the food the user dislikes from the offered choices.",
              "Ask which option the user prefers.",
              "Do not persist a preference, remove a food, create a Draft, or change the Active Plan in this turn.",
            ],
          }
        : null,
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

const genericFoodSubjects = new Set([
  "food",
  "a food",
  "foods",
  "something",
  "אוכל",
  "מזון",
]);

function explicitFoodRequestSubject(text: string) {
  const match = text.match(
    /(?:\b(?:add|find|search|lookup|look\s+up)\b|(?:להוסיף|לחפש|חפש|מצא|תמצא))\s+(?:for\s+)?(.+)/iu,
  );
  if (!match) return null;
  return match[1]
    .replace(/\b(?:to|in)\s+(?:my\s+)?(?:food\s+)?catalog\b.*$/iu, "")
    .trim()
    .toLocaleLowerCase("en-US");
}

function requestsFoodWithoutName(input: CoachMessageRequest["input"]) {
  if (input.type !== "text") return false;
  const subject = explicitFoodRequestSubject(input.text);
  return subject !== null && genericFoodSubjects.has(subject);
}

function requiresImmediateFoodSearch(
  input: CoachMessageRequest["input"],
  pending: AgentInteraction | null,
) {
  if (input.type !== "text") return false;
  const text = input.text.trim();
  if (/^(?:never mind|cancel|stop|no thanks|לא משנה|בטל|עצור)\b/iu.test(text)) {
    return false;
  }
  if (pending?.type === "clarification" && pending.workflow === "food") {
    return (
      text.length >= 2 &&
      (/^[\p{L}][\p{L}\s'’%.-]{1,119}$/u.test(text) ||
        explicitFoodRequestSubject(text) !== null)
    );
  }
  const subject = explicitFoodRequestSubject(text);
  return subject !== null && !genericFoodSubjects.has(subject);
}

function requestsDraftIntegration(input: CoachMessageRequest["input"]) {
  if (input.type !== "text") return false;
  const text = input.text.trim();
  return (
    /\b(?:add|put|include|use|integrate|create|make|propose|generate|build|draft)\b[\s\S]{0,80}\b(?:plan|draft|menu)\b/iu.test(
      text,
    ) || /(?:הוסף|להוסיף|לשלב)[\s\S]{0,80}(?:לתפריט|בתפריט|לטיוטה)/u.test(text)
  );
}

function requestsTodayWeightUpsert(input: CoachMessageRequest["input"]) {
  if (input.type !== "text") return false;
  const text = input.text.trim();
  const number = "\\d{1,3}(?:[.,]\\d{1,2})?";
  return new RegExp(
    `(?:\\bi\\s+weigh\\s+${number}(?:\\s*kg)?(?:\\s+today)?\\b|\\btoday(?:'s|s)?\\s+weight\\s+(?:is\\s+)?${number}(?:\\s*kg)?\\b|^${number}\\s*kg\\s+today$)`,
    "iu",
  ).test(text);
}

function requestsContextualTodayWeightUpsert(
  input: CoachMessageRequest["input"],
  conversation: Array<{ role: "assistant" | "user"; content: string }>,
) {
  if (
    input.type !== "text" ||
    !/\b(?:edit|update|replace|change)\b[\s\S]{0,40}\b(?:it|today|weight)\b/iu.test(
      input.text,
    )
  ) {
    return false;
  }
  return conversation
    .slice(-8)
    .some(
      (message) =>
        message.role === "user" &&
        requestsTodayWeightUpsert({ type: "text", text: message.content }),
    );
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
  if (iso && !Number.isNaN(Date.parse(`${iso}T12:00:00Z`))) return iso;
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
  return candidate.toISOString().slice(0, 10);
}

function resolveWeightDelete(
  input: CoachMessageRequest["input"],
  conversation: Array<{ role: "assistant" | "user"; content: string }>,
  currentDate: string,
) {
  if (
    input.type !== "text" ||
    !/\b(?:delete|remove|erase)\b/iu.test(input.text)
  ) {
    return null;
  }
  const explicitDate = historicalDateFromText(input.text, currentDate);
  if (explicitDate) return explicitDate;
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

function resolveHistoricalWeightUpsert(
  input: CoachMessageRequest["input"],
  conversation: Array<{ role: "assistant" | "user"; content: string }>,
  currentDate: string,
): ResolvedHistoricalWeightUpsert | null {
  if (input.type !== "text") return null;
  const currentDateValue = historicalDateFromText(input.text, currentDate);
  const currentWeight = weightFromText(input.text);
  if (currentDateValue && currentWeight !== null) {
    return { date: currentDateValue, weightKg: currentWeight };
  }

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

function requiresImmediateDraftProposal(
  input: CoachMessageRequest["input"],
  state: PersistedDemoState,
) {
  if ("profile" in state && !isProfileReady(state.profile)) return false;
  if (input.type === "interaction" && input.action === "confirm_draft_food") {
    return true;
  }
  return Boolean(
    state.agentSession.planChange?.requiredCatalogFoodIds.length &&
    requestsDraftIntegration(input),
  );
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

function allowedTools(
  state: PersistedDemoState,
  input: CoachMessageRequest["input"],
  proposalAttempts: number,
  allowOrdinaryDraftProposal: boolean,
): CoachToolName[] {
  const common: CoachToolName[] = [
    "remember_preference",
    "remove_approved_food",
    "inspect_food_availability",
    "search_foods",
    "select_food_candidate",
  ];
  if ("profile" in state) {
    if (state.activePlan)
      common.push("record_weight", "edit_weight", "delete_weight");
    if (
      isProfileReady(state.profile) &&
      allowOrdinaryDraftProposal &&
      proposalAttempts < 3
    ) {
      common.push("submit_draft_proposal");
    }
  } else {
    common.push("record_weight", "edit_weight", "delete_weight");
    const pending = state.agentSession.pendingInteraction;
    const adjustmentRequested =
      input.type === "interaction" && input.action === "generate_adjustment";
    const adjustmentFeedback =
      pending?.type === "clarification" && pending.workflow === "adjustment";
    const adjustmentPending =
      pending?.type === "adjustment_offer" ||
      pending?.type === "adjustment_approval" ||
      adjustmentFeedback;
    if (
      !state.draft &&
      (adjustmentRequested || adjustmentFeedback) &&
      proposalAttempts < 3
    ) {
      common.push("submit_adjustment_proposal");
    } else if (
      !adjustmentPending &&
      allowOrdinaryDraftProposal &&
      proposalAttempts < 3
    ) {
      common.push("submit_draft_proposal");
    }
  }
  return common;
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
    throw new Error("The food-search limit has been reached. Try again later.");
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
  let state = structuredClone(profile.state);
  let catalog = await listCatalogFoods();
  let approvedCatalogFood: CatalogFood | undefined;
  let actionSummary: Record<string, unknown> | null = null;
  let requiredCatalogFoodId =
    state.agentSession.planChange?.requiredCatalogFoodIds[0] ?? null;
  let selectedAlternativeFood: CatalogFood | null = null;
  let turnDecision: TurnDecision | null = null;
  let planMutationAuthorized = false;
  let proposalAttempts = 0;
  const turnCurrentDate = new Date().toISOString().slice(0, 10);
  let resolvedHistoricalWeightUpsert: ResolvedHistoricalWeightUpsert | null =
    null;
  let resolvedWeightDelete: string | null = null;
  let weightConfirmation: string | null = null;
  const rejectedDraftAttempts: DraftAttemptReview[] = [];
  const foodNameMissing = requestsFoodWithoutName(input.request.input);

  const activePlanVersion = state.activePlan?.version ?? null;
  if (
    state.agentSession.planChange &&
    state.agentSession.planChange.basePlanVersion !== activePlanVersion
  ) {
    state = {
      ...state,
      agentSession: { ...state.agentSession, planChange: null },
    };
    requiredCatalogFoodId = null;
  }

  let currentInteraction = state.agentSession.pendingInteraction;
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
  if (
    input.request.input.type === "text" &&
    !("profile" in state && !isProfileReady(state.profile))
  ) {
    const currentText = input.request.input.text;
    const recentConversation = (
      await listConversationMessages(input.request.profileId)
    )
      .filter(
        (message) =>
          message.content.length > 0 &&
          (message.role === "user" || message.status !== "pending"),
      )
      .slice(-6)
      .map(({ role, content }) => ({ role, content }));
    turnDecision = await atTurnStage("turn_decision", () =>
      interpretTurnDecision({
        message: currentText,
        hasActivePlan: Boolean(state.activePlan),
        hasDraft: Boolean(state.draft),
        onboardingRequired:
          "profile" in state && !isProfileReady(state.profile),
        recentConversation,
        pendingInteraction: currentInteraction
          ? {
              type: currentInteraction.type,
              workflow: interactionWorkflow(currentInteraction),
              offeredFoodNames: offeredFoodNames(state, catalog),
            }
          : null,
      }),
    );
    const planChangeResult = applyPlanChangeDecision({
      state,
      catalog,
      decision: turnDecision,
      currentInteraction,
    });
    state = planChangeResult.state;
    currentInteraction = planChangeResult.currentInteraction;
    selectedAlternativeFood = planChangeResult.selectedAlternativeFood;
    requiredCatalogFoodId =
      planChangeResult.requiredCatalogFoodId ?? requiredCatalogFoodId;
    planMutationAuthorized = planChangeResult.planMutationAuthorized;
  }
  if (
    "profile" in state &&
    !isProfileReady(state.profile) &&
    !state.agentSession.pendingInteraction &&
    input.request.input.type === "text"
  ) {
    const onboardingState = state;
    const onboardingInput = input.request.input;
    input.onStatus("thinking");
    const extraction = await atTurnStage("onboarding_extraction", () =>
      extractOnboardingFacts({
        commandId: input.request.commandId,
        message: onboardingInput.text,
        profile: onboardingState.profile,
      }),
    );
    if (Object.keys(extraction.patch).length > 0) {
      const nextProfile = applyFactPatch(
        onboardingState.profile,
        extraction.patch,
      );
      const activeTurn = getNextTurn(nextProfile);
      const measurements =
        onboardingState.weightMeasurements.length > 0 ||
        nextProfile.currentWeightKg === null
          ? onboardingState.weightMeasurements
          : [
              {
                id: `weight-onboarding-${input.request.commandId}`,
                date: turnCurrentDate,
                weightKg: nextProfile.currentWeightKg,
                commandId: input.request.commandId,
              },
            ];
      state = {
        ...onboardingState,
        profile: nextProfile,
        activeTurn,
        targets: calculateTargets(nextProfile),
        weightMeasurements: measurements,
        status: "idle",
        pendingCommand: null,
        pendingOperation: null,
        processedCommandIds: onboardingState.processedCommandIds.includes(
          input.request.commandId,
        )
          ? onboardingState.processedCommandIds
          : [...onboardingState.processedCommandIds, input.request.commandId],
        error: null,
      };
      const assistantText =
        `${extraction.acknowledgement} ${activeTurn.prompt}`.trim();
      input.onText(assistantText);
      profile = await atTurnStage("profile_persist", () =>
        mutateProfile({
          profileId: input.request.profileId,
          expectedVersion: profile.version,
          commandId: input.request.commandId,
          agentTurnLease: turnLease,
          mutation: () => state,
        }),
      );
      return { profile, assistantText };
    }
  }
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
                state.activePlan?.maintenanceReferenceWeightKg ??
                maintenanceReferenceWeightFromInitialMeasurements(
                  measurementsOf(state),
                ) ??
                structuredProfileOf(state).currentWeightKg,
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
        state = setInteraction(
          {
            ...state,
            draft: null,
            agentSession: {
              ...state.agentSession,
              planChange: startPlanChange({ ...state, draft: null }),
            },
          },
          interaction(randomUUID(), {
            type: "clarification",
            workflow: "draft",
            prompt: "What would you like changed in the next Draft?",
            quickReplies: [],
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
      state = setInteraction(
        profile.state,
        interaction(randomUUID(), {
          type: "confirm_draft_food",
          foodId: result.food.id,
          displayName: result.food.displayName,
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
      state = setInteraction(
        profile.state,
        interaction(randomUUID(), {
          type: "confirm_draft_food",
          foodId: result.food.id,
          displayName: result.food.displayName,
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
              state.activePlan.maintenanceReferenceWeightKg,
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
      state = setInteraction(
        {
          ...state,
          agentSession: {
            ...state.agentSession,
            planChange: startPlanChange(state, {
              requiredCatalogFoodIds: [pending.foodId],
              mustDiffer: true,
              scope: "food_replacement",
              selectedAlternativeFoodId: pending.foodId,
            }),
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
    input.onText(assistantText);
    profile = await atTurnStage("profile_persist", () =>
      mutateProfile({
        profileId: input.request.profileId,
        expectedVersion: profile.version,
        commandId: input.request.commandId,
        agentTurnLease: turnLease,
        mutation: () => state,
      }),
    );
    return { profile, catalogFood: approvedCatalogFood, assistantText };
  }

  if (
    foodNameMissing &&
    !(
      state.agentSession.pendingInteraction?.type === "clarification" &&
      state.agentSession.pendingInteraction.workflow === "food"
    )
  ) {
    const hebrew =
      input.request.input.type === "text" &&
      /[\u0590-\u05ff]/.test(input.request.input.text);
    state = setInteraction(
      state,
      interaction(randomUUID(), {
        type: "clarification",
        workflow: "food",
        prompt: hebrew
          ? "איזה מזון בסיסי תרצה להוסיף?"
          : "Which basic food would you like to add?",
        quickReplies: [],
      }),
    );
    actionSummary = { event: "food_name_required" };
  }

  const executeToolCore = async (
    call: CoachToolCall,
  ): Promise<Record<string, unknown>> => {
    if (call.name !== "search_foods") input.onStatus("validating");
    const args = call.arguments as Record<string, unknown>;
    if (call.name === "remember_preference") {
      const supportingMessageId = String(args.supportingMessageId);
      const message = (
        await listConversationMessages(input.request.profileId)
      ).find((item) => item.id === supportingMessageId && item.role === "user");
      if (!message) {
        throw new Error(
          "That preference is not supported by a stored user message.",
        );
      }
      const preference = {
        id: `preference-${randomUUID()}`,
        type: args.type as
          "food" | "meal_distribution" | "meal_timing" | "preparation",
        subject: String(args.subject),
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
      const foodId = String(args.catalogFoodId);
      const food = catalog.find((item) => item.id === foodId);
      if (!food || !approvedIdsOf(state).includes(foodId)) {
        throw new Error("That food is not approved for this profile.");
      }
      const use = plansUsingFood(state, foodId);
      state =
        "profile" in state
          ? {
              ...state,
              profile: {
                ...state.profile,
                approvedCatalogFoodIds:
                  state.profile.approvedCatalogFoodIds.filter(
                    (id) => id !== foodId,
                  ),
              },
            }
          : {
              ...state,
              approvedCatalogFoodIds: state.approvedCatalogFoodIds.filter(
                (id) => id !== foodId,
              ),
            };
      return {
        removedFromFutureDrafts: true,
        food: { id: food.id, name: food.displayName },
        activePlanUnchanged: true,
        ...use,
      };
    }
    if (call.name === "inspect_food_availability") {
      input.onStatus("checking_foods");
      const query = String(args.query).toLocaleLowerCase("en-US");
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
      return { query: String(args.query), matches };
    }
    if (call.name === "record_weight") {
      if ("profile" in state && !state.activePlan)
        throw new Error("Activate your first plan before recording weight.");
      const date = turnCurrentDate;
      const existingMeasurements = measurementsOf(state);
      const weightKg = normalizeWeightKg(Number(args.weightKg));
      const existingForDate = existingMeasurements.filter(
        (item) => item.date === date,
      );
      const previous = existingForDate.at(-1) ?? null;
      const measurement = previous
        ? { ...previous, weightKg, commandId: input.request.commandId }
        : {
            id: `weight-${input.request.commandId}`,
            date,
            weightKg,
            commandId: input.request.commandId,
          };
      const measurements = [
        ...existingMeasurements.filter((item) => item.date !== date),
        measurement,
      ].sort((a, b) => a.date.localeCompare(b.date));
      const trend = calculateWeightTrend(measurements, {
        activePlanActivatedAt: state.activePlan?.activatedAt,
      });
      state = finishNonInteractiveWorkflow(
        withMeasurements(state, measurements),
        "weight",
      );
      weightConfirmation = previous
        ? `Updated today’s weight from ${formatWeightKg(previous.weightKg)} kg to ${formatWeightKg(weightKg)} kg.`
        : `Recorded ${formatWeightKg(weightKg)} kg for today.`;
      return {
        operation: previous ? "updated" : "created",
        previousWeightKg: previous?.weightKg ?? null,
        measurement: { date, weightKg },
        trend,
      };
    }
    if (call.name === "edit_weight") {
      if ("profile" in state && !state.activePlan)
        throw new Error("Activate your first plan before editing weight.");
      const date = resolvedHistoricalWeightUpsert?.date ?? String(args.date);
      const existingMeasurements = measurementsOf(state);
      const weightKg = normalizeWeightKg(
        resolvedHistoricalWeightUpsert?.weightKg ?? Number(args.weightKg),
      );
      const existingForDate = existingMeasurements.filter(
        (item) => item.date === date,
      );
      const previous = existingForDate.at(-1) ?? null;
      const measurement = previous
        ? { ...previous, weightKg, commandId: input.request.commandId }
        : {
            id: `weight-${input.request.commandId}`,
            date,
            weightKg,
            commandId: input.request.commandId,
          };
      const measurements = [
        ...existingMeasurements.filter((item) => item.date !== date),
        measurement,
      ].sort((a, b) => a.date.localeCompare(b.date));
      const trend = calculateWeightTrend(measurements, {
        activePlanActivatedAt: state.activePlan?.activatedAt,
      });
      state = finishNonInteractiveWorkflow(
        withMeasurements(state, measurements),
        "weight",
      );
      weightConfirmation = previous
        ? `Updated ${date} from ${formatWeightKg(previous.weightKg)} kg to ${formatWeightKg(weightKg)} kg.`
        : `Recorded ${formatWeightKg(weightKg)} kg for ${date}.`;
      return {
        operation: previous ? "updated" : "created",
        previousWeightKg: previous?.weightKg ?? null,
        measurement: { date, weightKg },
        trend,
      };
    }
    if (call.name === "delete_weight") {
      if ("profile" in state && !state.activePlan)
        throw new Error("Activate your first plan before deleting weight.");
      const date = resolvedWeightDelete ?? String(args.date);
      const existingMeasurements = measurementsOf(state);
      const deleted = existingMeasurements.filter((item) => item.date === date);
      if (deleted.length === 0)
        throw new Error("No weight is recorded for that date.");
      const measurements = existingMeasurements.filter(
        (item) => item.date !== date,
      );
      const trend = calculateWeightTrend(measurements, {
        activePlanActivatedAt: state.activePlan?.activatedAt,
      });
      state = finishNonInteractiveWorkflow(
        withMeasurements(state, measurements),
        "weight",
      );
      weightConfirmation = `Deleted the ${formatWeightKg(deleted.at(-1)!.weightKg)} kg measurement for ${date === turnCurrentDate ? "today" : date}.`;
      return {
        deleted: {
          date,
          weightKg: deleted.at(-1)?.weightKg,
        },
        trend,
      };
    }
    if (call.name === "search_foods") {
      const result = await searchFoods({
        profileId: input.request.profileId,
        query: String(args.normalizedEnglishQuery),
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
      if (result.outcome === "needs_clarification") {
        const next = interaction(randomUUID(), {
          type: "clarification",
          workflow: "food",
          prompt: result.prompt,
          quickReplies: [],
        });
        state = setInteraction(state, next);
        return { outcome: "needs_clarification", interaction: next };
      }
      if (result.outcome === "existing") {
        const next = interaction(randomUUID(), {
          type: "existing_food",
          food: result.food,
          alreadyApproved: approvedIdsOf(state).includes(result.food.id),
        });
        state = setInteraction(state, next);
        return { outcome: "existing", interaction: next };
      }
      if (result.outcome === "unavailable") {
        const next = interaction(randomUUID(), {
          type: "source_unavailable",
          lookupId: result.lookupId,
          query: result.query,
          failureCode: result.failureCode,
        });
        state = setInteraction(state, next);
        return {
          outcome: "source_unavailable",
          interaction: next,
          aiEstimateRequiresExplicitConfirmation: true,
        };
      }
      const next = interaction(randomUUID(), {
        type: "food_candidates",
        lookupId: result.lookupId,
        candidates: result.candidates,
      });
      state = setInteraction(state, next);
      return {
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
      };
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
        throw new Error("Select one of the currently displayed candidates.");
      const selected = await prepareFoodCandidate({
        profileId: input.request.profileId,
        candidateId: String(args.candidateId),
        agentTurnLease: turnLease,
      });
      const next = interaction(randomUUID(), {
        type: "food_approval",
        candidate: selected,
      });
      state = setInteraction(state, next);
      return {
        selected: {
          name: selected.food.displayName,
          nutrientsPer100g: selected.food.nutrientsPer100g,
        },
        approvalRequired: true,
      };
    }
    if (call.name === "submit_draft_proposal") {
      proposalAttempts += 1;
      input.onStatus(state.draft ? "revising_draft" : "creating_draft");
      const draftProfile = structuredProfileOf(state);
      const targets =
        state.activePlan?.plan.targetSnapshot ?? calculateTargets(draftProfile);
      if (!targets) throw new Error("The profile is not ready for a Draft.");
      const candidate = draftCandidateFromArguments(
        call.arguments as ProposalArguments,
      );
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
          state = setInteraction(
            state,
            interaction(randomUUID(), {
              type: "draft_failure_review",
              attempts: structuredClone(rejectedDraftAttempts),
              prompt:
                "For the next Draft, should I keep this food structure and use smaller portions, or use a different mix of your approved foods?",
            }),
          );
        }
        return {
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
        };
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
          agentSession: { ...state.agentSession, planChange: null },
        },
        interaction(draft.id, {
          type: "draft_approval",
          proposalId: draft.id,
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
      return {
        accepted: true,
        proposalId: draft.id,
        totals: draft.plan.validation.totals,
        approvalRequired: true,
      };
    }
    if (call.name === "submit_adjustment_proposal") {
      if ("profile" in state)
        throw new Error("Adjustment is available in the Existing demo.");
      if (state.draft)
        throw new Error(
          "Decline or approve the current Draft before creating an adjustment.",
        );
      proposalAttempts += 1;
      input.onStatus(
        proposalAttempts === 1 ? "creating_draft" : "revising_draft",
      );
      const adjustment = adjustedTargetsFor(state);
      if (!adjustment) {
        throw new Error(
          "The deterministic trend does not support an adjustment.",
        );
      }
      const candidate = draftCandidateFromArguments(
        call.arguments as ProposalArguments,
      );
      const plan = validateAndBuildPlan({
        candidate,
        profile: structuredProfileOf(state),
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
        return {
          accepted: false,
          attempt: proposalAttempts,
          attemptsRemaining: Math.max(0, 3 - proposalAttempts),
          issues: plan.validation.issues.slice(0, 20),
          actualTotals: plan.validation.totals,
          requiredTargets: adjustment.targets,
          requiredDirection: adjustment.direction,
          requiredAdjustmentKcal: adjustment.adjustmentKcal,
          afterThirdFailure:
            proposalAttempts >= 3
              ? "Ask one focused user question. Do not submit another proposal in this turn."
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
      const interactionBeforeTool = state.agentSession.pendingInteraction?.id;
      const result = await executeToolCore(call);
      const interactionAfterTool = state.agentSession.pendingInteraction?.id;
      reachedUserDecision = Boolean(
        interactionAfterTool && interactionAfterTool !== interactionBeforeTool,
      );
      const rejected =
        (call.name === "submit_draft_proposal" ||
          call.name === "submit_adjustment_proposal") &&
        result.accepted === false;
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
        status: rejected ? "rejected" : "completed",
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
  const protectedButtonOnly =
    input.request.input.type === "interaction" &&
    !["generate_adjustment", "confirm_draft_food"].includes(
      input.request.input.action,
    );
  let loggedAllowedSkills = "";
  const getAllowed = () => {
    if (reachedUserDecision) return [];
    const allowOrdinaryDraftProposal =
      planMutationAuthorized ||
      requiresImmediateDraftProposal(input.request.input, state);
    const allowed = protectedButtonOnly
      ? []
      : allowedTools(
          state,
          input.request.input,
          proposalAttempts,
          allowOrdinaryDraftProposal,
        );
    let policyAllowed = allowedToolsForDecision(allowed, turnDecision);
    if (foodNameMissing) {
      policyAllowed = policyAllowed.filter((name) => name !== "search_foods");
    }
    if (
      planMutationAuthorized ||
      requiresImmediateDraftProposal(input.request.input, state)
    ) {
      policyAllowed = policyAllowed.filter(
        (name) => name === "submit_draft_proposal",
      );
    } else if (
      input.request.input.type === "interaction" &&
      input.request.input.action === "generate_adjustment"
    ) {
      policyAllowed = policyAllowed.filter(
        (name) => name === "submit_adjustment_proposal",
      );
    }
    const signature = policyAllowed.join(",");
    if (signature !== loggedAllowedSkills) {
      loggedAllowedSkills = signature;
      console.info("coach_skills_allowed", {
        turnId: input.turnId,
        commandId: input.request.commandId,
        profileId: input.request.profileId,
        allowedSkills: policyAllowed,
        proposalAttempts,
      });
    }
    return policyAllowed;
  };
  const shouldForceDraftProposal = () => {
    if (proposalAttempts >= 3) return false;
    const revisingCurrentDraft = Boolean(
      state.draft &&
      state.agentSession.planChange?.mode === "revise_pending" &&
      state.agentSession.planChange.baseDraftId === state.draft.id,
    );
    if (state.draft && !revisingCurrentDraft) return false;
    return (
      planMutationAuthorized ||
      requiresImmediateDraftProposal(input.request.input, state) ||
      selectedAlternativeFood !== null
    );
  };
  const contextWithoutDigest = {
    ...contextFor(
      currentProfile,
      catalog,
      input.request.input,
      getAllowed(),
      null,
      requiredCatalogFoodId,
      turnDecision,
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
  );
  resolvedWeightDelete = resolveWeightDelete(
    input.request.input,
    conversation.messages,
    turnCurrentDate,
  );
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
          turnDecision,
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
      input.request.input.type === "interaction" &&
      input.request.input.action === "generate_adjustment"
        ? "submit_adjustment_proposal"
        : !("profile" in state && !state.activePlan) &&
            decisionAuthorizesIntent(turnDecision, "weight_record") &&
            (requestsTodayWeightUpsert(input.request.input) ||
              requestsContextualTodayWeightUpsert(
                input.request.input,
                conversation.messages,
              ))
          ? "record_weight"
          : !("profile" in state && !state.activePlan) &&
              decisionAuthorizesIntent(turnDecision, "weight_delete") &&
              resolvedWeightDelete
            ? "delete_weight"
            : !("profile" in state && !state.activePlan) &&
                decisionAuthorizesIntent(turnDecision, "weight_edit") &&
                resolvedHistoricalWeightUpsert
              ? "edit_weight"
              : shouldForceDraftProposal()
                ? "submit_draft_proposal"
                : requiresImmediateFoodSearch(
                      input.request.input,
                      currentInteraction,
                    ) && decisionAuthorizesIntent(turnDecision, "food_search")
                  ? "search_foods"
                  : null,
    getRequiredTool: (sequence) =>
      sequence > 1 && shouldForceDraftProposal()
        ? "submit_draft_proposal"
        : null,
    onText: (value) => {
      finalAgentText += value;
    },
    onTool: executeTool,
  });
  const assistantText =
    (weightConfirmation ?? finalAgentText.trim()) ||
    result.text.trim() ||
    "Done. What would you like to do next?";
  input.onText(assistantText);
  state = {
    ...state,
    agentSession: {
      ...state.agentSession,
      summary: conversation.digest
        ? JSON.stringify(conversation.digest).slice(0, 4_000)
        : state.agentSession.summary,
    },
  };

  profile = await atTurnStage("profile_persist", () =>
    mutateProfile({
      profileId: input.request.profileId,
      expectedVersion: profile.version,
      commandId: input.request.commandId,
      agentTurnLease: turnLease,
      mutation: () => state,
    }),
  );
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
