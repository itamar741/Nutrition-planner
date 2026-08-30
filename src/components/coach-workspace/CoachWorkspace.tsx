"use client";

import Link from "next/link";
import {
  FormEvent,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  onboardingFailureSchema,
  onboardingSuccessSchema,
} from "@/ai/contracts";
import {
  adjustmentSuccessSchema,
  draftModificationSuccessSchema,
  draftSuccessSchema,
  planFailureSchema,
} from "@/ai/plan-contracts";
import {
  createNewDemoState,
  createExistingActivePlan,
  createExistingWeightHistory,
  demoProfileNames,
  existingProfileFoundation,
  existingReadyProfile,
} from "@/data/demo-fixtures";
import {
  foodCatalog,
  foodCatalogById,
  foodCategoryLabels,
  foodCategoryOrder,
} from "@/data/food-catalog";
import { roundTo25HalfUp } from "@/domain/nutrition/calculations";
import { getChecklist } from "@/domain/profile/onboarding";
import {
  adjustmentDirection,
  calculateWeightTrend,
  normalizeWeightKg,
  parseCurrentWeightMessage,
  type WeightMeasurement,
} from "@/domain/weight/trend";
import type { DemoProfileId, QuickReplyOption } from "@/domain/profile/types";
import { demoReducer, type PendingCommand } from "@/store/demo-reducer";
import {
  clearNewDemoState,
  loadNewDemoState,
  saveNewDemoState,
} from "@/store/local-demo-store";
import {
  clearExistingDemoState,
  loadExistingDemoState,
  saveExistingDemoState,
  type ExistingDemoState,
} from "@/store/existing-demo-store";
import { FoodGrid } from "./FoodGrid";
import { PlanContents, PlanPanel } from "./PlanPanel";
import { WeightTrendChart } from "./WeightTrendChart";
import styles from "./CoachWorkspace.module.css";

function createCommandId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `command-${Date.now()}-${Math.random()}`
  );
}

function CatalogSection({ approvedIds }: { approvedIds: string[] }) {
  const approvedFoods = foodCatalog.filter((food) =>
    approvedIds.includes(food.id),
  );
  return (
    <article className={styles.catalogCard}>
      <span>This demo profile’s food preferences</span>
      <h3>{approvedFoods.length} approved foods</h3>
      <p>
        These are the foods this demo user said they like. Plans can use only
        this subset, not every food in the catalog.
      </p>
      <div className={styles.catalogGroups}>
        {foodCategoryOrder.map((category) => (
          <section key={category}>
            <h4>{foodCategoryLabels[category]}</h4>
            <ul>
              {approvedFoods
                .filter((food) => food.category === category)
                .map((food) => (
                  <li key={food.id}>{food.displayName}</li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </article>
  );
}

function createExistingFixture(): ExistingDemoState {
  const now = new Date();
  return {
    schemaVersion: 1,
    activePlan: createExistingActivePlan(now),
    measurements: createExistingWeightHistory(now),
    messages: [
      {
        id: "existing-welcome",
        role: "assistant",
        text: "Your weight history is ready. Send today’s weight in kilograms, or use the form beside the chart.",
      },
    ],
  };
}

function ExistingFoundation() {
  const profile = existingProfileFoundation;
  const [existing, setExisting] = useState<ExistingDemoState>(
    createExistingFixture,
  );
  const [storageReady, setStorageReady] = useState(false);
  const [weightInput, setWeightInput] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [editingMeasurement, setEditingMeasurement] =
    useState<WeightMeasurement | null>(null);
  const [editingWeight, setEditingWeight] = useState("");
  const [proposalState, setProposalState] = useState<
    "pending" | "approved" | "rejected"
  >("pending");
  const [adjustmentDraft, setAdjustmentDraft] = useState<
    import("@/domain/plan/types").DraftProposal | null
  >(null);
  const [proposalError, setProposalError] = useState("");
  const [isGeneratingProposal, setIsGeneratingProposal] = useState(false);

  useEffect(() => {
    const stored = loadExistingDemoState();
    if (stored) setExisting(stored);
    setStorageReady(true);
  }, []);
  useEffect(() => {
    if (storageReady) saveExistingDemoState(existing);
  }, [existing, storageReady]);

  const trend = useMemo(
    () =>
      calculateWeightTrend(existing.measurements, {
        activePlanActivatedAt: existing.activePlan.activatedAt,
      }),
    [existing.activePlan.activatedAt, existing.measurements],
  );
  const direction =
    trend.evidence === "sufficient"
      ? adjustmentDirection(profile.goal ?? "maintenance", trend.weeklyPercent)
      : null;
  const adjustmentKcal = roundTo25HalfUp(
    existing.activePlan.plan.validation.totals.energyKcal * 0.05,
  );

  function appendChat(role: "assistant" | "user", text: string) {
    return { id: `${role}-${createCommandId()}`, role, text };
  }
  function saveTodayWeight(weightKg: number, source: "chat" | "form") {
    const date = new Date().toISOString().slice(0, 10);
    if (existing.measurements.some((item) => item.date === date)) {
      setExisting((current) => ({
        ...current,
        messages: [
          ...current.messages,
          appendChat(
            "assistant",
            "Today’s weight is already recorded. Select its chart point to edit it.",
          ),
        ],
      }));
      return;
    }
    const commandId = createCommandId();
    const measurement: WeightMeasurement = {
      id: `weight-${commandId}`,
      date,
      weightKg,
      commandId,
    };
    setExisting((current) => ({
      ...current,
      measurements: [...current.measurements, measurement],
      messages: [
        ...current.messages,
        ...(source === "chat" ? [appendChat("user", `${weightKg} kg`)] : []),
        appendChat(
          "assistant",
          `Recorded ${weightKg.toFixed(1)} kg for today. Your trend was recalculated.`,
        ),
      ],
    }));
    setAdjustmentDraft(null);
    setProposalState("pending");
    setProposalError("");
  }
  function submitWeightChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = chatInput.trim();
    if (!message) return;
    setChatInput("");
    const weightKg = parseCurrentWeightMessage(message);
    if (weightKg === null) {
      setExisting((current) => ({
        ...current,
        messages: [
          ...current.messages,
          appendChat("user", message),
          appendChat(
            "assistant",
            "Please send only today’s weight in kilograms, for example 80.4 kg.",
          ),
        ],
      }));
      return;
    }
    saveTodayWeight(weightKg, "chat");
  }
  function submitWeightForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      saveTodayWeight(normalizeWeightKg(Number(weightInput)), "form");
      setWeightInput("");
    } catch (error) {
      setExisting((current) => ({
        ...current,
        messages: [
          ...current.messages,
          appendChat(
            "assistant",
            error instanceof Error ? error.message : "Enter a valid weight.",
          ),
        ],
      }));
    }
  }
  function startEditing(measurement: WeightMeasurement) {
    setEditingMeasurement(measurement);
    setEditingWeight(String(measurement.weightKg));
  }
  function saveEditedWeight(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingMeasurement) return;
    try {
      const weightKg = normalizeWeightKg(Number(editingWeight));
      const commandId = createCommandId();
      setExisting((current) => ({
        ...current,
        measurements: current.measurements.map((item) =>
          item.date === editingMeasurement.date
            ? { ...item, weightKg, commandId }
            : item,
        ),
        messages: [
          ...current.messages,
          appendChat(
            "assistant",
            `Updated ${editingMeasurement.date} to ${weightKg.toFixed(1)} kg. Your trend was recalculated.`,
          ),
        ],
      }));
      setEditingMeasurement(null);
      setAdjustmentDraft(null);
      setProposalState("pending");
      setProposalError("");
    } catch (error) {
      setProposalError(
        error instanceof Error ? error.message : "Enter a valid weight.",
      );
    }
  }
  function resetExistingDemo() {
    clearExistingDemoState();
    setExisting(createExistingFixture());
    setEditingMeasurement(null);
    setAdjustmentDraft(null);
    setProposalError("");
    setProposalState("pending");
  }
  function approveAdjustment() {
    if (!adjustmentDraft || proposalState !== "pending") return;
    setExisting((current) => ({
      ...current,
      activePlan: {
        ...current.activePlan,
        version: adjustmentDraft.plan.version,
        activatedAt: new Date().toISOString(),
        plan: adjustmentDraft.plan,
      },
    }));
    setAdjustmentDraft(null);
    setProposalState("approved");
  }
  async function generateAdjustmentProposal() {
    if (!direction || isGeneratingProposal || proposalState !== "pending")
      return;
    setIsGeneratingProposal(true);
    setProposalError("");
    try {
      const response = await fetch("/api/coach/adjustment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commandId: createCommandId(),
          profile: existingReadyProfile,
          activePlan: existing.activePlan,
          direction,
          adjustmentKcal,
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const failure = planFailureSchema.safeParse(body);
        throw new Error(
          failure.success
            ? failure.data.message
            : "The adjustment proposal could not be created.",
        );
      }
      setAdjustmentDraft(adjustmentSuccessSchema.parse(body).draft);
    } catch (error) {
      setProposalError(
        error instanceof Error
          ? error.message
          : "The adjustment proposal could not be created.",
      );
    } finally {
      setIsGeneratingProposal(false);
    }
  }
  return (
    <section className={styles.existingLayout}>
      <p className={styles.kicker}>Prepared profile · foundation checkpoint</p>
      <h1>The adjustment story starts with a trusted baseline.</h1>
      <p>
        This fixed profile includes an Active Plan and a seeded two-month weight
        history. No additional account is created.
      </p>
      <div className={styles.existingGrid}>
        <article className={styles.existingCard}>
          <span>Profile</span>
          <h3>
            {profile.age} · Male · {profile.heightCm} cm
          </h3>
          <p>Reference-fixture facts, stored as deterministic demo data.</p>
        </article>
        <article className={styles.existingCard}>
          <span>Fixed goal</span>
          <h3>Maintenance</h3>
          <p>The goal cannot switch after onboarding.</p>
        </article>
        <article className={styles.existingCard}>
          <span>Activity basis</span>
          <h3>Low active</h3>
          <p>
            Mostly seated plus three 60-minute resistance sessions each week.
          </p>
        </article>
      </div>
      <section className={styles.weightWorkspace} aria-label="Weight tracking">
        <article className={styles.weightChartCard}>
          <div className={styles.weightCardHeader}>
            <div>
              <span>Weight history</span>
              <h2>Your recorded weights</h2>
            </div>
            <button
              className={styles.resetButton}
              onClick={resetExistingDemo}
              type="button"
            >
              Reset demo
            </button>
          </div>
          <WeightTrendChart
            measurements={existing.measurements}
            onSelect={startEditing}
            trend={trend}
          />
          <div className={styles.trendStats}>
            <span>
              <strong>{trend.weeklyKg.toFixed(2)} kg</strong>
              weekly change
            </span>
            <span>
              <strong>{trend.weeklyPercent.toFixed(2)}%</strong>
              weekly percentage
            </span>
            <span>
              <strong>
                {trend.evidence === "sufficient"
                  ? "Evidence ready"
                  : "More data needed"}
              </strong>
              {trend.evidence === "sufficient"
                ? "Trend can be evaluated"
                : trend.evidenceReason === "active_plan_changed"
                  ? "The Active Plan changed in this window"
                  : "28 measurements across 28 days are required"}
            </span>
          </div>
        </article>
        <article className={styles.existingCard}>
          <span>Record today’s weight</span>
          <form onSubmit={submitWeightForm}>
            <input
              aria-label="Weight in kilograms"
              inputMode="decimal"
              min="1"
              onChange={(event) => setWeightInput(event.target.value)}
              placeholder="kg"
              step="0.1"
              type="number"
              value={weightInput}
            />
            <button className={styles.primaryAction} type="submit">
              Save today
            </button>
          </form>
          <p>To correct an earlier day, select its point on the chart.</p>
        </article>
        <article className={styles.weightChatCard}>
          <span>Coach conversation</span>
          <div className={styles.weightMessages} aria-live="polite">
            {existing.messages.map((message) => (
              <div
                className={
                  message.role === "assistant"
                    ? styles.weightAssistantMessage
                    : styles.weightUserMessage
                }
                key={message.id}
              >
                {message.text}
              </div>
            ))}
          </div>
          <form className={styles.composer} onSubmit={submitWeightChat}>
            <textarea
              aria-label="Today’s weight message"
              maxLength={100}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder="Example: 80.4 kg"
              rows={2}
              value={chatInput}
            />
            <button
              className={styles.sendButton}
              disabled={!chatInput.trim()}
              type="submit"
            >
              Send
            </button>
          </form>
        </article>
      </section>
      {editingMeasurement ? (
        <section
          className={styles.editWeightPanel}
          aria-label="Edit weight measurement"
        >
          <span>Edit recorded weight</span>
          <h3>{editingMeasurement.date}</h3>
          <form onSubmit={saveEditedWeight}>
            <input
              aria-label="Replacement weight in kilograms"
              inputMode="decimal"
              min="1"
              onChange={(event) => setEditingWeight(event.target.value)}
              step="0.1"
              type="number"
              value={editingWeight}
            />
            <button className={styles.primaryAction} type="submit">
              Save replacement
            </button>
            <button
              className={styles.secondaryAction}
              onClick={() => setEditingMeasurement(null)}
              type="button"
            >
              Cancel
            </button>
          </form>
        </section>
      ) : null}
      {direction ? (
        <article className={styles.existingCard}>
          <span>AI adjustment proposal · Draft</span>
          <h3>
            {direction === "increase" ? "Increase" : "Decrease"} by{" "}
            {adjustmentKcal} kcal/day
          </h3>
          <p>
            The proposal is bounded by the deterministic trend result. The
            Active Plan changes only after approval.
          </p>
          {proposalState === "pending" ? (
            <div className={styles.quickReplies}>
              {adjustmentDraft ? (
                <>
                  <p>{adjustmentDraft.summary}</p>
                  <div className={styles.adjustmentComparison}>
                    <span>
                      Current target{" "}
                      <strong>
                        {existing.activePlan.plan.targetSnapshot.energyKcal}{" "}
                        kcal
                      </strong>
                    </span>
                    <span aria-hidden="true">→</span>
                    <span>
                      Proposed target{" "}
                      <strong>
                        {adjustmentDraft.plan.targetSnapshot.energyKcal} kcal
                      </strong>
                    </span>
                  </div>
                  <div className={styles.adjustmentPlanDetails}>
                    <p className={styles.adjustmentDetailsTitle}>
                      Proposed daily plan
                    </p>
                    <PlanContents proposal={adjustmentDraft} />
                  </div>
                  <button
                    className={styles.primaryAction}
                    onClick={approveAdjustment}
                    type="button"
                  >
                    Approve proposal
                  </button>
                </>
              ) : (
                <button
                  className={styles.primaryAction}
                  disabled={isGeneratingProposal}
                  onClick={generateAdjustmentProposal}
                  type="button"
                >
                  {isGeneratingProposal
                    ? "Creating validated proposal…"
                    : "Generate AI proposal"}
                </button>
              )}
              <button
                className={styles.resetButton}
                onClick={() => setProposalState("rejected")}
                type="button"
              >
                Decline
              </button>
            </div>
          ) : (
            <p role="status">
              {proposalState === "approved"
                ? `Approved. Active Plan is now version ${existing.activePlan.version}.`
                : "Declined. Active Plan was unchanged."}
            </p>
          )}
          {proposalError ? (
            <p className={styles.errorBox} role="alert">
              {proposalError}
            </p>
          ) : null}
        </article>
      ) : null}
      <div className={styles.existingGrid}>
        <article className={styles.existingCard}>
          <span>Active Plan</span>
          <h3>
            {existing.activePlan.plan.validation.totals.energyKcal.toFixed(0)}{" "}
            kcal/day
          </h3>
          <p>
            Version {existing.activePlan.version}; changes require an explicit
            approval.
          </p>
          <details className={styles.activePlanDetails}>
            <summary>View active daily plan</summary>
            <PlanContents
              proposal={{
                schemaVersion: 1,
                id: `active-${existing.activePlan.version}`,
                basePlanVersion: existing.activePlan.version,
                reason: "initial",
                summary: "Your approved repeatable day.",
                plan: existing.activePlan.plan,
              }}
            />
          </details>
        </article>
      </div>
      <CatalogSection
        approvedIds={existingReadyProfile.approvedCatalogFoodIds}
      />
    </section>
  );
}

function DisabledComposer({ placeholder }: { placeholder: string }) {
  return (
    <div className={styles.composer} aria-label="Text input unavailable">
      <textarea
        aria-label="Message to nutrition coach"
        disabled
        placeholder={placeholder}
        rows={2}
      />
      <button className={styles.sendButton} disabled type="button">
        Send
      </button>
    </div>
  );
}

export function CoachWorkspace({ profileId }: { profileId: DemoProfileId }) {
  const [state, dispatch] = useReducer(
    demoReducer,
    undefined,
    createNewDemoState,
  );
  const [draftMessage, setDraftMessage] = useState("");
  const [selectedFoodIds, setSelectedFoodIds] = useState<string[]>([]);
  const [isSlow, setIsSlow] = useState(false);
  const turnLock = useRef(false);
  const hasSeenInitialState = useRef(false);
  const messagesEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (profileId === "new") {
      const stored = loadNewDemoState();
      if (stored) dispatch({ type: "hydrate", state: stored });
    }
  }, [profileId]);

  useEffect(() => {
    if (!hasSeenInitialState.current) {
      hasSeenInitialState.current = true;
      return;
    }
    if (profileId === "new" && state.status === "idle") {
      saveNewDemoState(state);
    }
  }, [profileId, state]);

  useEffect(() => {
    if (typeof messagesEnd.current?.scrollIntoView === "function") {
      messagesEnd.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [state.messages, state.status]);

  const checklist = useMemo(() => getChecklist(state.profile), [state.profile]);
  const completeCount = checklist.filter((item) => item.complete).length;
  const progress = Math.round((completeCount / checklist.length) * 100);

  async function sendOpenCommand(command: PendingCommand, retry = false) {
    if (turnLock.current || state.status === "processing") return;
    turnLock.current = true;
    setIsSlow(false);
    if (retry) {
      dispatch({ type: "retry_open", commandId: command.id });
    } else {
      dispatch({ type: "start_open", command });
    }

    const slowTimer = window.setTimeout(() => setIsSlow(true), 1_200);
    try {
      const response = await fetch("/api/coach/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commandId: command.id,
          message: command.message,
          profile: state.profile,
        }),
      });
      const body: unknown = await response.json();

      if (!response.ok) {
        const failure = onboardingFailureSchema.safeParse(body);
        throw new Error(
          failure.success
            ? failure.data.message
            : "The coach could not process that message.",
        );
      }

      const result = onboardingSuccessSchema.parse(body);
      dispatch({
        type: "complete_open",
        commandId: command.id,
        profile: result.profile,
        activeTurn: result.activeTurn,
        acknowledgement: result.acknowledgement,
        targets: result.targets,
      });
      setDraftMessage("");
    } catch (error) {
      dispatch({
        type: "fail_open",
        commandId: command.id,
        message:
          error instanceof Error
            ? error.message
            : "The coach could not process that message.",
      });
    } finally {
      window.clearTimeout(slowTimer);
      setIsSlow(false);
      turnLock.current = false;
    }
  }

  async function sendPlanCommand(
    command: PendingCommand,
    operation: "draft" | "modification",
    retry = false,
  ) {
    if (turnLock.current || state.status === "processing") return;
    turnLock.current = true;
    setIsSlow(false);
    if (retry) {
      dispatch({ type: "retry_plan", commandId: command.id });
    } else {
      dispatch({ type: "start_plan", command, operation });
    }

    const slowTimer = window.setTimeout(() => setIsSlow(true), 1_200);
    try {
      const endpoint =
        operation === "draft"
          ? "/api/coach/draft"
          : "/api/coach/draft-modification";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          operation === "draft"
            ? {
                commandId: command.id,
                message: command.message,
                profile: state.profile,
              }
            : {
                commandId: command.id,
                message: command.message,
                profile: state.profile,
                draft: state.draft,
              },
        ),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const failure = planFailureSchema.safeParse(body);
        throw new Error(
          failure.success
            ? failure.data.message
            : "The plan operation could not be completed.",
        );
      }

      if (operation === "draft") {
        const result = draftSuccessSchema.parse(body);
        dispatch({
          type: "complete_draft",
          commandId: command.id,
          draft: result.draft,
        });
      } else {
        const result = draftModificationSuccessSchema.parse(body);
        if (result.outcome === "modified") {
          dispatch({
            type: "complete_modification",
            commandId: command.id,
            draft: result.draft,
            message: result.message,
          });
        } else {
          dispatch({
            type: "complete_unsupported",
            commandId: command.id,
            message: result.message,
          });
        }
      }
      setDraftMessage("");
    } catch (error) {
      dispatch({
        type: "fail_plan",
        commandId: command.id,
        message:
          error instanceof Error
            ? error.message
            : "The plan operation could not be completed.",
      });
    } finally {
      window.clearTimeout(slowTimer);
      setIsSlow(false);
      turnLock.current = false;
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draftMessage.trim();
    if (!message) return;
    const command = { id: createCommandId(), message };
    if (state.draft) {
      void sendPlanCommand(command, "modification");
    } else if (state.activeTurn.type === "open_question") {
      void sendOpenCommand(command);
    }
  }

  function handleDraftRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draftMessage.trim() || "Generate my Draft Meal Plan";
    void sendPlanCommand({ id: createCommandId(), message }, "draft");
  }

  function handleQuickReply(option: QuickReplyOption) {
    if (turnLock.current || state.status !== "idle") return;
    turnLock.current = true;
    dispatch({
      type: "apply_closed",
      commandId: createCommandId(),
      label: option.label,
      patch: option.patch,
    });
    window.setTimeout(() => {
      turnLock.current = false;
    }, 250);
  }

  function toggleFood(id: string) {
    if (turnLock.current || state.status !== "idle") return;
    setSelectedFoodIds((current) =>
      current.includes(id)
        ? current.filter((candidate) => candidate !== id)
        : [...current, id],
    );
  }

  function submitFoodSelection() {
    if (turnLock.current || state.status !== "idle") return;
    turnLock.current = true;
    dispatch({
      type: "apply_food_selection",
      commandId: createCommandId(),
      ids: selectedFoodIds,
    });
    window.setTimeout(() => {
      turnLock.current = false;
    }, 250);
  }

  function handleRetry() {
    if (!state.pendingCommand || !state.pendingOperation) return;
    if (state.pendingOperation === "onboarding") {
      void sendOpenCommand(state.pendingCommand, true);
    } else {
      void sendPlanCommand(state.pendingCommand, state.pendingOperation, true);
    }
  }

  function handleReset() {
    turnLock.current = false;
    clearNewDemoState();
    dispatch({ type: "hydrate", state: createNewDemoState() });
    setDraftMessage("");
    setSelectedFoodIds([]);
  }

  function handleApprove() {
    if (!state.draft || turnLock.current || state.status !== "idle") return;
    turnLock.current = true;
    dispatch({
      type: "activate_draft",
      commandId: createCommandId(),
      proposalId: state.draft.id,
      activatedAt: new Date().toISOString(),
    });
    window.setTimeout(() => {
      turnLock.current = false;
    }, 250);
  }

  function handleReject() {
    if (!state.draft || turnLock.current || state.status !== "idle") return;
    turnLock.current = true;
    dispatch({
      type: "reject_draft",
      commandId: createCommandId(),
      proposalId: state.draft.id,
    });
    window.setTimeout(() => {
      turnLock.current = false;
    }, 250);
  }

  const inputEnabled =
    profileId === "new" &&
    state.status === "idle" &&
    (Boolean(state.draft) || state.activeTurn.type === "open_question");
  const draftWasDeclined = state.messages.some((message) =>
    message.text.startsWith("The Draft was declined."),
  );
  const processingText =
    state.pendingOperation === "draft"
      ? isSlow
        ? "Still composing and validating your Draft—your request is safely queued."
        : "Building and validating your Draft…"
      : state.pendingOperation === "modification"
        ? isSlow
          ? "Still validating the change—the current Draft is unchanged."
          : "Checking that Draft change…"
        : isSlow
          ? "Still reviewing your details—your answer is safely queued."
          : "Reviewing your details…";

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link className={styles.back} href="/">
          <span aria-hidden="true">←</span> Profiles
        </Link>
        <div className={styles.profileLabel}>
          <span className={styles.profileDot} aria-hidden="true" />
          {demoProfileNames[profileId]}
        </div>
      </header>

      <div className={styles.workspace}>
        {profileId === "existing" ? (
          <ExistingFoundation />
        ) : (
          <>
            <section
              className={styles.conversation}
              aria-label="Coach conversation"
            >
              <header className={styles.conversationHeader}>
                <p className={styles.kicker}>Adaptive nutrition coach</p>
                <h1>
                  {state.draft
                    ? "Your Draft is ready to review."
                    : state.activePlan
                      ? "Your plan is Active."
                      : "Let’s build your baseline."}
                </h1>
                <p>
                  {state.draft
                    ? "Ask for one food replacement or portion change, or approve the exact Draft."
                    : state.activePlan
                      ? "This exact validated plan is now your approved baseline."
                      : "I’ll keep what you confirm and ask only for what is still missing."}
                </p>
              </header>

              <div className={styles.messages} aria-live="polite">
                {state.messages.map((message) => (
                  <div
                    className={`${styles.message} ${
                      message.role === "assistant"
                        ? styles.assistantMessage
                        : styles.userMessage
                    }`}
                    data-role={message.role}
                    key={message.id}
                  >
                    {message.text}
                  </div>
                ))}
                {state.status === "processing" ? (
                  <div className={styles.processing} role="status">
                    <span className={styles.pulse} aria-hidden="true" />
                    {processingText}
                  </div>
                ) : null}
                <div ref={messagesEnd} />
              </div>

              <div className={styles.controls}>
                {state.status === "failed" && state.pendingCommand ? (
                  <div className={styles.errorBox} role="alert">
                    <p>{state.error}</p>
                    <button
                      className={styles.retryButton}
                      onClick={handleRetry}
                      type="button"
                    >
                      Retry
                    </button>
                  </div>
                ) : state.activeTurn.type === "closed_question" ? (
                  <>
                    <div
                      className={styles.quickReplies}
                      aria-label="Quick replies"
                    >
                      {state.activeTurn.options.map((option) => (
                        <button
                          className={styles.quickReply}
                          disabled={state.status !== "idle"}
                          key={option.id}
                          onClick={() => handleQuickReply(option)}
                          type="button"
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    <DisabledComposer placeholder="Choose one quick reply above" />
                  </>
                ) : state.activeTurn.type === "food_grid" ? (
                  <>
                    <FoodGrid
                      disabled={state.status !== "idle"}
                      onSubmit={submitFoodSelection}
                      onToggle={toggleFood}
                      selectedIds={selectedFoodIds}
                    />
                    <DisabledComposer placeholder="Complete food selection above" />
                  </>
                ) : state.draft ? (
                  <form className={styles.composer} onSubmit={handleSubmit}>
                    <textarea
                      aria-label="Message to nutrition coach"
                      disabled={!inputEnabled}
                      maxLength={1_000}
                      onChange={(event) => setDraftMessage(event.target.value)}
                      placeholder="Try: replace one food, or change one portion…"
                      rows={2}
                      value={draftMessage}
                    />
                    <button
                      className={styles.sendButton}
                      disabled={!inputEnabled || !draftMessage.trim()}
                      type="submit"
                    >
                      Request change
                    </button>
                  </form>
                ) : state.activePlan ? (
                  <DisabledComposer placeholder="Your plan is Active" />
                ) : state.targets ? (
                  <form
                    className={styles.generateBox}
                    onSubmit={handleDraftRequest}
                  >
                    <div>
                      <strong>
                        {draftWasDeclined
                          ? "Tell the coach what you would like different."
                          : "Your profile and targets are ready."}
                      </strong>
                      <p>
                        {draftWasDeclined
                          ? "Your feedback will guide a new validated Draft; it will not change anything until you approve it."
                          : "The coach will compose from your "}
                        {!draftWasDeclined ? (
                          <>
                            {state.profile.approvedCatalogFoodIds.length}{" "}
                            approved foods, then deterministic checks decide
                            whether the Draft is valid.
                          </>
                        ) : null}
                      </p>
                      <textarea
                        aria-label="Message to nutrition coach"
                        className={styles.feedbackInput}
                        disabled={state.status !== "idle"}
                        maxLength={1_000}
                        onChange={(event) =>
                          setDraftMessage(event.target.value)
                        }
                        placeholder="Optional: tell the coach what to change…"
                        rows={2}
                        value={draftMessage}
                      />
                    </div>
                    <button
                      className={styles.primaryAction}
                      disabled={state.status !== "idle"}
                      type="submit"
                    >
                      {draftWasDeclined
                        ? "Generate revised Draft"
                        : "Generate Draft"}
                    </button>
                  </form>
                ) : (
                  <form className={styles.composer} onSubmit={handleSubmit}>
                    <textarea
                      aria-label="Message to nutrition coach"
                      disabled={!inputEnabled}
                      maxLength={1_000}
                      onChange={(event) => setDraftMessage(event.target.value)}
                      placeholder={
                        inputEnabled
                          ? "Type your answer…"
                          : "Choose an option above"
                      }
                      rows={2}
                      value={draftMessage}
                    />
                    <button
                      className={styles.sendButton}
                      disabled={!inputEnabled || !draftMessage.trim()}
                      type="submit"
                    >
                      Send
                    </button>
                  </form>
                )}
              </div>
            </section>

            <aside className={styles.context} aria-label="Plan and progress">
              <div className={styles.contextHeader}>
                <div>
                  <p className={styles.kicker}>Your progress</p>
                  <h2>{progress}% complete</h2>
                </div>
                <button
                  className={styles.resetButton}
                  onClick={handleReset}
                  type="button"
                >
                  Reset demo
                </button>
              </div>
              <div
                aria-label={`${progress}% of onboarding complete`}
                className={styles.progressTrack}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
              >
                <div
                  className={styles.progressBar}
                  style={{ width: `${progress}%` }}
                />
              </div>
              <ul className={styles.checklist}>
                {checklist.map((item) => (
                  <li
                    className={`${styles.checkItem} ${
                      item.complete ? styles.checkItemComplete : ""
                    }`}
                    key={item.key}
                  >
                    <span className={styles.checkMark} aria-hidden="true">
                      ✓
                    </span>
                    <span>{item.label}</span>
                  </li>
                ))}
              </ul>
              {state.profile.approvedCatalogFoodIds.length > 0 ? (
                <details className={styles.approvedFoods}>
                  <summary>
                    {state.profile.approvedCatalogFoodIds.length} approved foods
                  </summary>
                  <p>
                    {state.profile.approvedCatalogFoodIds
                      .map((id) => foodCatalogById.get(id)?.displayName ?? id)
                      .join(" · ")}
                  </p>
                </details>
              ) : null}
              <PlanPanel
                activePlan={state.activePlan}
                disabled={state.status !== "idle"}
                draft={state.draft}
                onApprove={handleApprove}
                onReject={handleReject}
                targets={state.targets}
              />
            </aside>
          </>
        )}
      </div>
    </main>
  );
}
