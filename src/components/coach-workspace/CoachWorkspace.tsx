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
  demoProfileNames,
  existingProfileFoundation,
  existingReadyProfile,
  existingWeightHistory,
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
} from "@/domain/weight/trend";
import type { DemoProfileId, QuickReplyOption } from "@/domain/profile/types";
import { demoReducer, type PendingCommand } from "@/store/demo-reducer";
import {
  clearNewDemoState,
  loadNewDemoState,
  saveNewDemoState,
} from "@/store/local-demo-store";
import { FoodGrid } from "./FoodGrid";
import { PlanContents, PlanPanel } from "./PlanPanel";
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

function ExistingFoundation() {
  const profile = existingProfileFoundation;
  const [weights, setWeights] = useState(existingWeightHistory);
  const [weightInput, setWeightInput] = useState("");
  const [notice, setNotice] = useState("");
  const trend = useMemo(
    () => calculateWeightTrend(weights, new Date("2026-08-31T12:00:00Z")),
    [weights],
  );
  const [activePlan, setActivePlan] = useState(() =>
    createExistingActivePlan(),
  );
  const [proposalState, setProposalState] = useState<
    "pending" | "approved" | "rejected"
  >("pending");
  const [adjustmentDraft, setAdjustmentDraft] = useState<
    import("@/domain/plan/types").DraftProposal | null
  >(null);
  const [proposalError, setProposalError] = useState("");
  const [isGeneratingProposal, setIsGeneratingProposal] = useState(false);
  const direction =
    trend.evidence === "sufficient"
      ? adjustmentDirection(profile.goal ?? "maintenance", trend.weeklyPercent)
      : null;
  const adjustmentKcal = roundTo25HalfUp(
    activePlan.plan.validation.totals.energyKcal * 0.05,
  );
  function addWeight(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const weightKg = normalizeWeightKg(Number(weightInput));
      const date = new Date().toISOString().slice(0, 10);
      if (weights.some((item) => item.date === date))
        throw new Error("A weight for today is already recorded.");
      setWeights((current) => [...current, { date, weightKg }]);
      setWeightInput("");
      setNotice(
        "Weight recorded. The trend was recalculated deterministically.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Enter a valid weight.",
      );
    }
  }
  function approveAdjustment() {
    if (!adjustmentDraft || proposalState !== "pending") return;
    setActivePlan((current) => ({
      ...current,
      version: adjustmentDraft.plan.version,
      activatedAt: new Date().toISOString(),
      plan: adjustmentDraft.plan,
    }));
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
          activePlan,
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
        history. No historical chat or additional account is created.
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
                        {activePlan.plan.targetSnapshot.energyKcal} kcal
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
                ? `Approved. Active Plan is now version ${activePlan.version}.`
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
            {activePlan.plan.validation.totals.energyKcal.toFixed(0)} kcal/day
          </h3>
          <p>
            Version {activePlan.version}; changes require an explicit approval.
          </p>
          <details className={styles.activePlanDetails}>
            <summary>View active daily plan</summary>
            <PlanContents
              proposal={{
                schemaVersion: 1,
                id: `active-${activePlan.version}`,
                basePlanVersion: activePlan.version,
                reason: "initial",
                summary: "Your approved repeatable day.",
                plan: activePlan.plan,
              }}
            />
          </details>
        </article>
        <article className={styles.existingCard}>
          <span>Weight trend</span>
          <h3>
            {trend.evidence === "sufficient"
              ? `${trend.weeklyPercent.toFixed(2)}% / week`
              : "Insufficient evidence"}
          </h3>
          <p>
            {trend.measurementCount} measurements across{" "}
            {trend.spanDays.toFixed(0)} days.
          </p>
        </article>
        <article className={styles.existingCard}>
          <span>Record weight</span>
          <form onSubmit={addWeight}>
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
              Add
            </button>
          </form>
          {notice ? <p role="status">{notice}</p> : null}
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
