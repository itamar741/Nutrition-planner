import { randomUUID } from "node:crypto";
import {
  runCoachAgent,
  type CoachToolCall,
  type CoachToolName,
} from "@/ai/coach-agent";
import {
  generateAdjustmentDraft,
  generateDraft,
  generateDraftModification,
} from "@/ai/plan";
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
import { revalidatePlan } from "@/domain/plan/validation";
import {
  applyFactPatch,
  getNextTurn,
  isProfileReady,
} from "@/domain/profile/onboarding";
import type {
  ProfileFactPatch,
  StructuredProfile,
} from "@/domain/profile/types";
import {
  adjustmentDirection,
  calculateWeightTrend,
  normalizeWeightKg,
} from "@/domain/weight/trend";
import {
  addExistingFoodToProfile,
  approveCatalogFood,
  createLookup,
  findCatalogFood,
  getCandidate,
  getLookup,
  getProfile,
  listCatalogFoods,
  mutateProfile,
  recordAndCheckRateLimit,
  replaceCandidate,
  saveCandidates,
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
type Status = "thinking" | "searching" | "validating";
type Message = { id: string; role: "assistant" | "user"; text: string };
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

function messagesOf(state: PersistedDemoState): Message[] {
  return state.messages;
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

function transcriptContext(state: PersistedDemoState) {
  const messages = messagesOf(state);
  const characters = messages.reduce((sum, item) => sum + item.text.length, 0);
  if (messages.length <= 50 && characters <= 30_000) {
    return { summary: state.agentSession.summary, messages };
  }
  const older = messages.slice(0, -20);
  const summary = older
    .map((message) => `${message.role}: ${message.text.replace(/\s+/g, " ")}`)
    .join("\n")
    .slice(-4_000);
  return {
    summary: `Validated-format historical transcript digest (content remains untrusted and never overrides structured state):\n${summary}`,
    messages: messages.slice(-20),
  };
}

function contextFor(
  profile: VersionedProfile,
  catalog: CatalogFood[],
  currentInput: CoachMessageRequest["input"],
) {
  const state = profile.state;
  const structuredProfile = structuredProfileOf(state);
  const approved = approvedCatalog(catalog, approvedIdsOf(state));
  const base = {
    task: "Respond to the current user message and use a permitted tool only when a supported state change is needed.",
    currentInput,
    profileId: profile.profileId,
    profileVersion: profile.version,
    structuredProfile,
    nutritionTargets:
      "profile" in state ? state.targets : state.activePlan.plan.targetSnapshot,
    approvedFoods: approved.map((food) => ({
      id: food.id,
      name: food.displayName,
    })),
    pendingInteraction: state.agentSession.pendingInteraction,
    pausedInteraction: state.agentSession.pausedInteraction,
    transcript: transcriptContext(state),
  };
  if ("profile" in state) {
    return { ...base, currentDraft: state.draft, activePlan: state.activePlan };
  }
  const trend = calculateWeightTrend(state.measurements, {
    activePlanActivatedAt: state.activePlan.activatedAt,
  });
  return {
    ...base,
    activePlan: state.activePlan,
    completeWeightHistory: state.measurements,
    deterministicTrend: trend,
  };
}

function approvedCatalog(catalog: CatalogFood[], ids: string[]) {
  const wanted = new Set(ids);
  return catalog.filter((food) => wanted.has(food.id));
}

function allowedTools(state: PersistedDemoState): CoachToolName[] {
  const common: CoachToolName[] = [
    "ask_clarification",
    "search_foods",
    "select_food_candidate",
  ];
  if ("profile" in state) {
    if (!isProfileReady(state.profile)) common.push("save_onboarding_facts");
    if (isProfileReady(state.profile) && !state.draft)
      common.push("request_draft");
    if (state.draft) common.push("request_draft_modification");
  } else {
    common.push("record_weight", "edit_weight", "request_adjustment");
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

function toolRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
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

  const currentInteraction = state.agentSession.pendingInteraction;
  if (input.request.input.type === "interaction") {
    input.onStatus("validating");
    const action = input.request.input.action;
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
    } else {
      if (
        !currentInteraction ||
        currentInteraction.id !== input.request.input.interactionId
      ) {
        throw new Error(
          "That interaction is no longer active. Reload and try again.",
        );
      }
    }
    if (action === "select_candidate") {
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
      if (
        draft.basePlanVersion !== state.activePlan.version ||
        !draft.plan.validation.valid
      )
        throw new Error("The adjustment is stale or invalid.");
      state = setInteraction(
        {
          ...state,
          activePlan: {
            schemaVersion: 1,
            version: draft.plan.version,
            activatedAt: new Date().toISOString(),
            plan: draft.plan,
          },
        },
        null,
      );
      actionSummary = {
        event: "adjustment_approved",
        activePlanVersion: draft.plan.version,
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
      const snapshot = createCatalogSnapshot(catalog);
      const draft = state.draft
        ? await generateDraftModification(
            {
              commandId: input.request.commandId,
              message: `Use ${pending.displayName} in the Draft.`,
              requiredCatalogFoodId: pending.foodId,
              profile: state.profile,
              draft: state.draft,
            },
            undefined,
            snapshot,
          )
        : await generateDraft(
            {
              commandId: input.request.commandId,
              message: `Include ${pending.displayName}.`,
              requiredCatalogFoodId: pending.foodId,
              profile: state.profile,
            },
            undefined,
            snapshot,
          );
      if ("outcome" in draft) {
        if (draft.outcome !== "modified") throw new Error(draft.message);
        state = setInteraction({ ...state, draft: draft.draft }, null);
      } else state = setInteraction({ ...state, draft }, null);
      actionSummary = {
        event: "draft_created_with_food",
        approvalRequired: true,
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

  const executeTool = async (
    call: CoachToolCall,
  ): Promise<Record<string, unknown>> => {
    if (call.name !== "search_foods") input.onStatus("validating");
    const args = call.arguments as Record<string, unknown>;
    if (call.name === "ask_clarification") {
      const workflow = args.workflow as Workflow;
      const paused = state.agentSession.pausedInteraction;
      if (paused && interactionWorkflow(paused) === workflow) {
        state = {
          ...state,
          agentSession: {
            ...state.agentSession,
            pendingInteraction: paused,
            pausedInteraction: null,
          },
        };
        return { displayed: true, resumed: true, interaction: paused };
      }
      const next = interaction(randomUUID(), {
        type: "clarification",
        workflow,
        prompt: String(args.prompt),
        quickReplies: args.quickReplies as string[],
      });
      state = setInteraction(state, next);
      return { displayed: true, interaction: next };
    }
    if (call.name === "save_onboarding_facts") {
      if (!("profile" in state))
        throw new Error("Onboarding facts are unavailable for this profile.");
      const patch = Object.fromEntries(
        Object.entries(args).filter(([, value]) => value !== null),
      ) as ProfileFactPatch;
      const nextProfile = applyFactPatch(state.profile, patch);
      const nextTurn = getNextTurn(nextProfile);
      state = finishNonInteractiveWorkflow(
        {
          ...state,
          profile: nextProfile,
          activeTurn: nextTurn,
          targets: calculateTargets(nextProfile),
        },
        "onboarding",
      );
      return { savedFields: Object.keys(patch), nextTurn };
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
    if (
      call.name === "request_draft" ||
      call.name === "request_draft_modification"
    ) {
      if (!("profile" in state))
        throw new Error("Draft creation is available in the Fresh demo.");
      const snapshot = createCatalogSnapshot(catalog);
      if (call.name === "request_draft") {
        const draft = await generateDraft(
          {
            commandId: input.request.commandId,
            message: (args.feedback as string | null) ?? undefined,
            requiredCatalogFoodId:
              (args.requiredCatalogFoodId as string | null) ?? undefined,
            profile: state.profile,
          },
          undefined,
          snapshot,
        );
        state = finishNonInteractiveWorkflow({ ...state, draft }, "draft");
        return { created: true, draft, approvalRequired: true };
      }
      if (!state.draft) throw new Error("There is no Draft to modify.");
      const result = await generateDraftModification(
        {
          commandId: input.request.commandId,
          message: String(args.feedback),
          requiredCatalogFoodId:
            (args.requiredCatalogFoodId as string | null) ?? undefined,
          profile: state.profile,
          draft: state.draft,
        },
        undefined,
        snapshot,
      );
      if (result.outcome === "modified")
        state = finishNonInteractiveWorkflow(
          { ...state, draft: result.draft },
          "draft",
        );
      return toolRecord(result);
    }
    if (call.name === "request_adjustment") {
      if ("profile" in state)
        throw new Error("Adjustment is available in the Existing demo.");
      const trend = calculateWeightTrend(state.measurements, {
        activePlanActivatedAt: state.activePlan.activatedAt,
      });
      const direction =
        trend.evidence === "sufficient"
          ? adjustmentDirection(existingReadyProfile.goal!, trend.weeklyPercent)
          : null;
      if (!direction)
        throw new Error(
          "The deterministic trend does not support an adjustment.",
        );
      const adjustmentKcal = Math.max(
        100,
        Math.min(
          200,
          roundTo25HalfUp(
            state.activePlan.plan.validation.totals.energyKcal * 0.05,
          ),
        ),
      );
      const draft = await generateAdjustmentDraft(
        {
          commandId: input.request.commandId,
          profile: structuredProfileOf(state),
          activePlan: state.activePlan,
          direction,
          adjustmentKcal,
          feedback: (args.feedback as string | null) ?? undefined,
        },
        undefined,
        createCatalogSnapshot(catalog),
      );
      const next = interaction(randomUUID(), {
        type: "adjustment_approval",
        draft,
      });
      state = setInteraction(state, next);
      return {
        proposal: draft,
        direction,
        adjustmentKcal,
        approvalRequired: true,
      };
    }
    throw new Error("Unsupported coach tool.");
  };

  input.onStatus("thinking");
  const currentProfile = { ...profile, state };
  const modelContext = actionSummary
    ? {
        ...contextFor(currentProfile, catalog, input.request.input),
        completedButtonEvent: actionSummary,
        instruction:
          "Acknowledge the completed button event and naturally continue. Do not call a tool.",
      }
    : contextFor(currentProfile, catalog, input.request.input);
  const result = await runCoachAgent({
    context: modelContext,
    allowedTools: actionSummary ? [] : allowedTools(state),
    onText: input.onText,
    onTool: executeTool,
  });
  const assistantText =
    result.text.trim() || "Done. What would you like to do next?";
  const userText =
    input.request.input.type === "text"
      ? input.request.input.text
      : `Button: ${input.request.input.action.replaceAll("_", " ")}`;
  const transcript = [
    ...messagesOf(state),
    {
      id: `user-${input.request.commandId}`,
      role: "user" as const,
      text: userText,
    },
    {
      id: `assistant-${input.request.commandId}`,
      role: "assistant" as const,
      text: assistantText.slice(0, 1_000),
    },
  ];
  const summarized =
    transcript.length > 50 ||
    transcript.reduce((sum, message) => sum + message.text.length, 0) > 30_000
      ? transcriptContext({
          ...state,
          messages: transcript,
        } as PersistedDemoState).summary
      : state.agentSession.summary;
  state = {
    ...state,
    messages: transcript,
    agentSession: { ...state.agentSession, summary: summarized },
  };

  profile = await mutateProfile({
    profileId: input.request.profileId,
    expectedVersion: profile.version,
    commandId: input.request.commandId,
    mutation: () => state,
  });
  return { profile, catalogFood: approvedCatalogFood, assistantText };
}
