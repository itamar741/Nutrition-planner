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
  draftModificationSuccessSchema,
  draftSuccessSchema,
  planFailureSchema,
} from "@/ai/plan-contracts";
import {
  createNewDemoState,
  demoProfileNames,
  existingProfileFoundation,
} from "@/data/demo-fixtures";
import { foodCatalogById } from "@/data/food-catalog";
import { getChecklist } from "@/domain/profile/onboarding";
import type { DemoProfileId, QuickReplyOption } from "@/domain/profile/types";
import { demoReducer, type PendingCommand } from "@/store/demo-reducer";
import {
  clearNewDemoState,
  loadNewDemoState,
  saveNewDemoState,
} from "@/store/local-demo-store";
import { FoodGrid } from "./FoodGrid";
import { PlanPanel } from "./PlanPanel";
import styles from "./CoachWorkspace.module.css";

function createCommandId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `command-${Date.now()}-${Math.random()}`
  );
}

function ExistingFoundation() {
  const profile = existingProfileFoundation;
  return (
    <section className={styles.existingLayout}>
      <p className={styles.kicker}>Prepared profile · foundation checkpoint</p>
      <h1>The adjustment story starts with a trusted baseline.</h1>
      <p>
        This fixed profile is ready for its Active Plan and seeded weight
        history in Turn 3. No historical chat or additional account is created.
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
            ? { commandId: command.id, profile: state.profile }
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
                  <div className={styles.generateBox}>
                    <div>
                      <strong>Your profile and targets are ready.</strong>
                      <p>
                        The coach will compose from your{" "}
                        {state.profile.approvedCatalogFoodIds.length} approved
                        foods, then deterministic checks decide whether the
                        Draft is valid.
                      </p>
                    </div>
                    <button
                      className={styles.primaryAction}
                      disabled={state.status !== "idle"}
                      onClick={() =>
                        void sendPlanCommand(
                          {
                            id: createCommandId(),
                            message: "Generate my Draft Meal Plan",
                          },
                          "draft",
                        )
                      }
                      type="button"
                    >
                      Generate Draft
                    </button>
                  </div>
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
