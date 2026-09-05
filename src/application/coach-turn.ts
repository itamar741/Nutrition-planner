import { randomUUID } from "node:crypto";
import {
  buildArnoldSystemPrompt,
  runCoachAgent,
  type CoachToolCall,
  type CoachToolName,
  type ProposalArguments,
} from "@/ai/coach-agent";
import { existingReadyProfile } from "@/data/demo-fixtures";
import type {
  AgentInteraction,
  CoachMessageRequest,
} from "@/domain/agent/types";
import { createCatalogSnapshot } from "@/domain/catalog/snapshot";
import type { CatalogFood } from "@/domain/catalog/types";
import {
  calculateTargets,
  roundTo25HalfUp,
} from "@/domain/nutrition/calculations";
import { revalidatePlan, validateAndBuildPlan } from "@/domain/plan/validation";
import type { DraftCandidate, DraftProposal } from "@/domain/plan/types";
import { isProfileReady } from "@/domain/profile/onboarding";
import type { StructuredProfile } from "@/domain/profile/types";
import {
  adjustmentDirection,
  calculateWeightTrend,
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
  replaceCandidate,
  saveCandidates,
  saveConversationSummary,
  updateLookup,
  type PersistedDemoState,
  type VersionedProfile,
} from "@/persistence/repository";
import {
  searchUsdaFoods,
  UsdaUnavailableError,
  usdaFoodUrl,
} from "@/sources/usda";
import { prepareAiEstimate, prepareFoodCandidate } from "./food-candidates";

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
  return "profile" in state
    ? state.profile
    : {
        ...existingReadyProfile,
        approvedCatalogFoodIds: state.approvedCatalogFoodIds,
      };
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
  const structuredProfile = structuredProfileOf(state);
  const approved = approvedCatalog(catalog, approvedIdsOf(state));
  const targets =
    "profile" in state ? state.targets : state.activePlan.plan.targetSnapshot;
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
    currentDate: new Date().toISOString().slice(0, 10),
    profileId: profile.profileId,
    profileVersion: profile.version,
    structuredProfile,
    nutritionTargets: targets,
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
    pendingInteraction: state.agentSession.pendingInteraction,
    pausedInteraction: state.agentSession.pausedInteraction,
  };
  if ("profile" in state) {
    return { ...base, currentDraft: state.draft, activePlan: state.activePlan };
  }
  const trend = calculateWeightTrend(state.measurements, {
    activePlanActivatedAt: state.activePlan.activatedAt,
  });
  const adjustment = adjustedTargetsFor(state);
  return {
    ...base,
    activePlan: state.activePlan,
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

async function conversationForModel(input: {
  profileId: "new" | "existing";
  state: PersistedDemoState;
  contextWithoutDigest: Record<string, unknown>;
  currentInput: CoachMessageRequest["input"];
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

function plansUsingFood(state: PersistedDemoState, foodId: string) {
  const hasFood = (plan: {
    meals: Array<{ items: Array<{ catalogFoodId: string }> }>;
  }) =>
    plan.meals.some((meal) =>
      meal.items.some((item) => item.catalogFoodId === foodId),
    );
  return {
    inDraft:
      "profile" in state && state.draft ? hasFood(state.draft.plan) : false,
    inActivePlan: state.activePlan ? hasFood(state.activePlan.plan) : false,
  };
}

function adjustedTargetsFor(
  state: Exclude<PersistedDemoState, { profile: unknown }>,
) {
  const trend = calculateWeightTrend(state.measurements, {
    activePlanActivatedAt: state.activePlan.activatedAt,
  });
  const direction =
    trend.evidence === "sufficient"
      ? adjustmentDirection(existingReadyProfile.goal!, trend.weeklyPercent)
      : null;
  if (!direction) return null;
  const adjustmentKcal = Math.max(
    100,
    Math.min(
      200,
      roundTo25HalfUp(
        state.activePlan.plan.validation.totals.energyKcal * 0.05,
      ),
    ),
  );
  const base = state.activePlan.plan.targetSnapshot;
  const energyKcal =
    base.energyKcal +
    (direction === "increase" ? adjustmentKcal : -adjustmentKcal);
  return {
    trend,
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
): CoachToolName[] {
  const common: CoachToolName[] = [
    "remember_preference",
    "remove_approved_food",
    "inspect_food_availability",
    "search_foods",
    "select_food_candidate",
  ];
  if ("profile" in state) {
    if (isProfileReady(state.profile) && proposalAttempts < 3) {
      common.push("submit_draft_proposal");
    }
  } else {
    common.push("record_weight", "edit_weight");
    const pending = state.agentSession.pendingInteraction;
    const adjustmentRequested =
      input.type === "interaction" && input.action === "generate_adjustment";
    const adjustmentFeedback =
      pending?.type === "clarification" && pending.workflow === "adjustment";
    if ((adjustmentRequested || adjustmentFeedback) && proposalAttempts < 3) {
      common.push("submit_adjustment_proposal");
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

type Workflow = Extract<
  AgentInteraction,
  { type: "clarification" }
>["workflow"];

function interactionWorkflow(value: AgentInteraction): Workflow {
  if (value.type === "clarification") return value.workflow;
  if (
    value.type === "food_candidates" ||
    value.type === "food_approval" ||
    value.type === "existing_food" ||
    value.type === "confirm_draft_food" ||
    value.type === "source_unavailable"
  )
    return "food";
  return "adjustment";
}

function setInteraction(
  state: PersistedDemoState,
  next: AgentInteraction | null,
) {
  const current = state.agentSession.pendingInteraction;
  const foodFlow = new Set([
    "food_candidates",
    "food_approval",
    "existing_food",
    "confirm_draft_food",
    "source_unavailable",
  ]);
  const sameWorkflow = Boolean(
    current &&
    next &&
    ((foodFlow.has(current.type) && foodFlow.has(next.type)) ||
      interactionWorkflow(current) === interactionWorkflow(next) ||
      current.id === next.id),
  );
  return {
    ...state,
    agentSession: {
      ...state.agentSession,
      pendingInteraction: next,
      pausedInteraction:
        current && next && !sameWorkflow
          ? current
          : state.agentSession.pausedInteraction,
    },
  };
}

function finishNonInteractiveWorkflow(
  state: PersistedDemoState,
  workflow: Workflow,
) {
  const current = state.agentSession.pendingInteraction;
  if (!current) return state;
  const continuingCurrent = interactionWorkflow(current) === workflow;
  return {
    ...state,
    agentSession: {
      ...state.agentSession,
      pendingInteraction: null,
      pausedInteraction: continuingCurrent
        ? state.agentSession.pausedInteraction
        : current,
    },
  };
}

async function searchFoods(input: {
  profileId: "new" | "existing";
  query: string;
  preparation: "cooked" | "raw" | "packaged";
  rateIdentity: RateIdentity;
  turnId: string;
  onStatus: (value: Status) => void;
}) {
  const existing = await findCatalogFood(input.query);
  if (existing) return { outcome: "existing" as const, food: existing };
  if (!(await recordAndCheckRateLimit(input.rateIdentity))) {
    throw new Error("The food-search limit has been reached. Try again later.");
  }
  const lookup = await createLookup({
    profileId: input.profileId,
    query: input.query,
    context: { turnId: input.turnId, preparation: input.preparation },
    status: "searching",
    failureCode: null,
  });
  input.onStatus("searching");
  try {
    const arguments_ = {
      normalizedEnglishQuery: input.query,
      preparation: input.preparation,
    };
    const candidates = await searchUsdaFoods(arguments_, {
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
    );
    await updateLookup(lookup.id, { status: "ready", failureCode: null });
    return { outcome: "candidates" as const, lookupId: lookup.id, candidates };
  } catch (error) {
    const failureCode =
      error instanceof UsdaUnavailableError ? error.code : "source_unavailable";
    await updateLookup(lookup.id, { status: "failed", failureCode });
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
  onStatus: (value: Status) => void;
  onText: (delta: string) => void;
}): Promise<CoachTurnResult> {
  let profile = await getProfile(input.request.profileId);
  let state = structuredClone(profile.state);
  let catalog = await listCatalogFoods();
  let approvedCatalogFood: CatalogFood | undefined;
  let actionSummary: Record<string, unknown> | null = null;
  let requiredCatalogFoodId: string | null = null;
  let proposalAttempts = 0;

  const currentInteraction = state.agentSession.pendingInteraction;
  if (input.request.input.type === "interaction") {
    input.onStatus("validating");
    const action = input.request.input.action;
    const isSessionReview = action === "review_trend";
    const isAdjustmentGeneration = action === "generate_adjustment";
    if (action === "approve_draft" || action === "reject_draft") {
      if (
        !("profile" in state) ||
        !state.draft ||
        state.draft.id !== input.request.input.interactionId
      ) {
        throw new Error("That Draft is no longer awaiting review.");
      }
      if (action === "approve_draft") {
        const plan = revalidatePlan(
          state.draft.plan,
          state.profile,
          createCatalogSnapshot(catalog),
        );
        if (
          !plan.validation.valid ||
          state.draft.basePlanVersion !== (state.activePlan?.version ?? null)
        ) {
          throw new Error(
            "The Draft is stale or failed deterministic validation.",
          );
        }
        const nextVersion = (state.activePlan?.version ?? 0) + 1;
        state = {
          ...state,
          draft: null,
          activePlan: {
            schemaVersion: 1,
            version: nextVersion,
            activatedAt: new Date().toISOString(),
            plan,
          },
        };
        actionSummary = {
          event: "draft_approved",
          activePlanVersion: nextVersion,
        };
      } else {
        state = setInteraction(
          { ...state, draft: null },
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
        activePlanActivatedAt: state.activePlan.activatedAt,
      });
      if (adjustment) {
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
      });
      await updateLookup(stored.lookupId, {
        status: "approved",
        failureCode: null,
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
      await replaceCandidate({ ...stored, status: "rejected" });
      await updateLookup(lookup.id, { status: "rejected", failureCode: null });
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
        "profile" in state
      )
        throw new Error("There is no adjustment awaiting approval.");
      const draft = pending.draft;
      const validatedPlan = revalidatePlan(
        draft.plan,
        structuredProfileOf(state),
        createCatalogSnapshot(catalog),
      );
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
      if (!pending || pending.type !== "adjustment_approval")
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
      if (
        !pending ||
        pending.type !== "confirm_draft_food" ||
        !("profile" in state)
      )
        throw new Error("There is no food continuation awaiting confirmation.");
      requiredCatalogFoodId = pending.foodId;
      state = setInteraction(state, null);
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
      state = setInteraction(state, null);
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
          prompt: "How should I refine the food name or preparation?",
          quickReplies: [],
        }),
      );
      actionSummary = { event: "search_refinement_requested" };
    }
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
      });
      return { query: String(args.query), matches };
    }
    if (call.name === "record_weight") {
      if ("profile" in state)
        throw new Error("Weight history is available in the Existing demo.");
      const date = new Date().toISOString().slice(0, 10);
      if (state.measurements.some((item) => item.date === date))
        throw new Error("Today's weight already exists; edit it instead.");
      const weightKg = normalizeWeightKg(Number(args.weightKg));
      const measurements = [
        ...state.measurements,
        {
          id: `weight-${input.request.commandId}`,
          date,
          weightKg,
          commandId: input.request.commandId,
        },
      ];
      const trend = calculateWeightTrend(measurements, {
        activePlanActivatedAt: state.activePlan.activatedAt,
      });
      state = finishNonInteractiveWorkflow(
        {
          ...state,
          measurements,
        },
        "weight",
      );
      return {
        recorded: { date, weightKg },
        trend,
      };
    }
    if (call.name === "edit_weight") {
      if ("profile" in state)
        throw new Error("Weight history is available in the Existing demo.");
      const date = String(args.date);
      if (!state.measurements.some((item) => item.date === date))
        throw new Error("No weight is recorded for that date.");
      const weightKg = normalizeWeightKg(Number(args.weightKg));
      const measurements = state.measurements.map((item) =>
        item.date === date
          ? { ...item, weightKg, commandId: input.request.commandId }
          : item,
      );
      const trend = calculateWeightTrend(measurements, {
        activePlanActivatedAt: state.activePlan.activatedAt,
      });
      state = finishNonInteractiveWorkflow(
        {
          ...state,
          measurements,
        },
        "weight",
      );
      return {
        updated: { date, weightKg },
        trend,
      };
    }
    if (call.name === "search_foods") {
      const result = await searchFoods({
        profileId: input.request.profileId,
        query: String(args.normalizedEnglishQuery),
        preparation: args.preparation as "cooked" | "raw" | "packaged",
        rateIdentity: input.rateIdentity,
        turnId: input.turnId,
        onStatus: input.onStatus,
      });
      input.onStatus("validating");
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
      if (!("profile" in state))
        throw new Error("Draft creation is available in the Fresh demo.");
      proposalAttempts += 1;
      input.onStatus(state.draft ? "revising_draft" : "creating_draft");
      const targets = calculateTargets(state.profile);
      if (!targets) throw new Error("The profile is not ready for a Draft.");
      const candidate = draftCandidateFromArguments(
        call.arguments as ProposalArguments,
      );
      const includesRequiredFood =
        !requiredCatalogFoodId ||
        candidate.meals.some((meal) =>
          meal.items.some(
            (item) => item.catalogFoodId === requiredCatalogFoodId,
          ),
        );
      const plan = validateAndBuildPlan({
        candidate,
        profile: state.profile,
        targets,
        planId: `plan-${input.request.commandId}`,
        version: (state.draft?.plan.version ?? 0) + 1,
        catalog: createCatalogSnapshot(catalog),
      });
      const issues = [
        ...(includesRequiredFood
          ? []
          : [`The Draft must include approved food ${requiredCatalogFoodId}.`]),
        ...plan.validation.issues,
      ].slice(0, 20);
      if (issues.length > 0) {
        return {
          accepted: false,
          attempt: proposalAttempts,
          attemptsRemaining: Math.max(0, 3 - proposalAttempts),
          issues,
          actualTotals: plan.validation.totals,
          requiredTargets: targets,
          afterThirdFailure:
            proposalAttempts >= 3
              ? "Ask one focused user question. Do not submit another proposal in this turn."
              : null,
        };
      }
      const draft: DraftProposal = {
        schemaVersion: 1,
        id: `draft-${input.request.commandId}`,
        basePlanVersion: state.activePlan?.version ?? null,
        reason: state.draft ? "modification" : "initial",
        summary: candidate.summary,
        plan,
      };
      state = finishNonInteractiveWorkflow({ ...state, draft }, "draft");
      await appendConversationActivity({
        profileId: input.request.profileId,
        id: `activity-${input.turnId}-draft-${proposalAttempts}`,
        turnId: input.turnId,
        kind: "checking_plan",
        label: "Checking plan safety",
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

  const executeTool = async (call: CoachToolCall, sequence: number) => {
    await recordAgentSkillCall({
      profileId: input.request.profileId,
      commandId: input.request.commandId,
      sequence,
      name: call.name,
      arguments: call.arguments as Record<string, unknown>,
      result: null,
      status: "pending",
    });
    try {
      const result = await executeToolCore(call);
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
  const getAllowed = () =>
    protectedButtonOnly
      ? []
      : allowedTools(state, input.request.input, proposalAttempts);
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
    }),
  );
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
    onText: input.onText,
    onTool: executeTool,
  });
  const assistantText =
    result.text.trim() || "Done. What would you like to do next?";
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
      mutation: () => state,
    }),
  );
  return { profile, catalogFood: approvedCatalogFood, assistantText };
}
