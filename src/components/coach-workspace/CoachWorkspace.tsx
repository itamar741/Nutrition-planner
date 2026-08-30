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
  createNewDemoState,
  demoProfileNames,
  existingProfileFoundation,
} from "@/data/demo-fixtures";
import { getChecklist } from "@/domain/profile/onboarding";
import type { DemoProfileId, QuickReplyOption } from "@/domain/profile/types";
import { demoReducer, type PendingCommand } from "@/store/demo-reducer";
import {
  clearNewDemoState,
  loadNewDemoState,
  saveNewDemoState,
} from "@/store/local-demo-store";
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
        This fixed profile is ready for the catalog, Active Plan, and seeded
        weight history in the next approved turns. No historical chat or
        additional account is created.
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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draftMessage.trim();
    if (!message || state.activeTurn.type !== "open_question") return;
    void sendOpenCommand({ id: createCommandId(), message });
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

  function handleReset() {
    turnLock.current = false;
    clearNewDemoState();
    dispatch({ type: "hydrate", state: createNewDemoState() });
    setDraftMessage("");
  }

  const inputEnabled =
    profileId === "new" &&
    state.activeTurn.type === "open_question" &&
    state.status === "idle";

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
                <p className={styles.kicker}>Adaptive onboarding</p>
                <h1>Let’s build your baseline.</h1>
                <p>
                  I’ll keep what you confirm and ask only for what is still
                  missing.
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
                    {isSlow
                      ? "Still reviewing your details—your answer is safely queued."
                      : "Reviewing your details…"}
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
                      onClick={() =>
                        void sendOpenCommand(state.pendingCommand!, true)
                      }
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
                    <div className={styles.foodPlaceholder}>
                      <span aria-hidden="true">▦</span>
                      <p>
                        <strong>Food selection is next.</strong>
                        <br />
                        The closed catalog and five-category grid arrive in Turn
                        2.
                      </p>
                    </div>
                    <DisabledComposer placeholder="Complete food selection above" />
                  </>
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
                      disabled={
                        !inputEnabled || draftMessage.trim().length === 0
                      }
                      type="submit"
                    >
                      Send
                    </button>
                  </form>
                )}
              </div>
            </section>

            <aside className={styles.context} aria-label="Onboarding progress">
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
              <article className={styles.planEmpty}>
                <span>No plan yet</span>
                <h3>Your Draft will appear here.</h3>
                <p>
                  Complete onboarding and food selection first. Nothing becomes
                  Active without your explicit approval.
                </p>
              </article>
            </aside>
          </>
        )}
      </div>
    </main>
  );
}
