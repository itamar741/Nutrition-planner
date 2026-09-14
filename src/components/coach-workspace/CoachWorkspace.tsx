"use client";

import Link from "next/link";
import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createNewDemoState,
  createExistingDemoState,
  demoProfileNames,
  existingProfileFoundation,
} from "@/data/demo-fixtures";
import { foodCatalog } from "@/data/food-catalog";
import { getChecklist, isProfileReady } from "@/domain/profile/onboarding";
import {
  normalizeWeightKg,
  type WeightMeasurement,
} from "@/domain/weight/trend";
import { evaluateWeightAdjustmentDecision } from "@/domain/weight/decision";
import type { DemoProfileId, QuickReplyOption } from "@/domain/profile/types";
import {
  CloudStateError,
  loadCloudProfile,
  resetCloudProfile,
  sendCloudAction,
} from "@/store/cloud-demo-client";
import { demoReducer, type DemoAction } from "@/store/demo-reducer";
import type { NewDemoCloudAction } from "@/store/cloud-action-schemas";
import {
  existingDemoReducer,
  type ExistingDemoAction,
} from "@/store/existing-demo-reducer";
import { type ExistingDemoState } from "@/store/existing-demo-store";
import type { CatalogFood } from "@/domain/catalog/types";
import { createCatalogSnapshot } from "@/domain/catalog/snapshot";
import { FoodGrid } from "./FoodGrid";
import { PlanContents, PlanPanel } from "./PlanPanel";
import { WeightTrendChart } from "./WeightTrendChart";
import {
  NutritionTransparencyPanel,
  WeightDecisionPanel,
} from "./NutritionTransparencyPanel";
import { sendCoachMessage, AgentClientError } from "@/store/agent-client";
import type { CoachMessageRequest } from "@/domain/agent/types";
import type { ConversationActivity } from "@/domain/agent/types";
import {
  AGENT_RATE_LIMIT_MESSAGE,
  isAgentRateLimitMessage,
} from "@/domain/agent/rate-limit";
import { AgentInteractionPanel } from "./AgentInteractionPanel";
import { CatalogSection } from "./CatalogSection";
import { FreshActiveDashboard } from "./FreshActiveDashboard";
import {
  ArnoldCapabilitiesPanel,
  type ArnoldCapabilityId,
  type CapabilityAvailability,
} from "./ArnoldCapabilitiesPanel";
import styles from "./CoachWorkspace.module.css";

function capabilityAvailability(input: {
  profileReady: boolean;
  hasDraft: boolean;
  hasActivePlan: boolean;
  isExisting: boolean;
}): Record<ArnoldCapabilityId, CapabilityAvailability> {
  const draftAvailable = input.profileReady && !input.hasDraft;
  return {
    draft: {
      available: draftAvailable,
      note: input.hasDraft
        ? "Review or revise the current Draft first."
        : "Complete onboarding first.",
    },
    foods: {
      available: input.profileReady,
      note: "Complete onboarding and choose your foods first.",
    },
    calculations: {
      available: input.profileReady,
      note: "Complete onboarding first.",
    },
    weight: {
      available: input.hasActivePlan || input.isExisting,
      note: "Available after you approve a plan.",
    },
    trend: {
      available: input.isExisting,
      note: "Available in the Existing profile.",
    },
    goal: {
      available: input.profileReady,
      note: "Complete onboarding first.",
    },
  };
}

function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (
    event.key !== "Enter" ||
    event.shiftKey ||
    event.nativeEvent.isComposing ||
    event.currentTarget.disabled
  ) {
    return;
  }
  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
}

function createCommandId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `command-${Date.now()}-${Math.random()}`
  );
}

function agentStatusLabel(
  status:
    | "thinking"
    | "searching"
    | "validating"
    | "checking_foods"
    | "remembering"
    | "creating_draft"
    | "revising_draft"
    | null,
) {
  if (status === "searching") return "Searching USDA…";
  if (status === "validating") return "Validating nutrition…";
  if (status === "checking_foods") return "Checking your foods and plans…";
  if (status === "remembering") return "Remembering your preference…";
  if (status === "creating_draft") return "Creating Draft…";
  if (status === "revising_draft") return "Revising Draft…";
  return "Thinking…";
}

export function formatRateLimitCountdown(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.ceil(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

interface RateLimitWindow {
  observedAt: number;
  retryAt: number;
}

function useRateLimitCountdown(window: RateLimitWindow | null) {
  const [clock, setClock] = useState<{
    retryAt: number;
    current: number;
  } | null>(null);
  useEffect(() => {
    if (window === null) return;
    const timer = globalThis.window.setInterval(() => {
      const current = Date.now();
      setClock({ retryAt: window.retryAt, current });
      if (current >= window.retryAt) globalThis.window.clearInterval(timer);
    }, 250);
    return () => globalThis.window.clearInterval(timer);
  }, [window]);
  if (window === null) return null;
  const current =
    clock?.retryAt === window.retryAt ? clock.current : window.observedAt;
  return Math.max(0, Math.ceil((window.retryAt - current) / 1_000));
}

function RateLimitCountdown({ remaining }: { remaining: number | null }) {
  if (remaining === null) return null;
  return (
    <p className={styles.rateLimitTimer} role="timer">
      {remaining > 0
        ? `Available again in ${formatRateLimitCountdown(remaining)}.`
        : "The limit has reset. You can try again now."}
    </p>
  );
}

function RateLimitChatMessage({
  className,
  disabled,
  onRetry,
  remaining,
}: {
  className: string;
  disabled: boolean;
  onRetry: () => void;
  remaining: number | null;
}) {
  return (
    <div className={`${className} ${styles.rateLimitMessage}`} role="alert">
      <p>{AGENT_RATE_LIMIT_MESSAGE}</p>
      <RateLimitCountdown remaining={remaining} />
      <button
        className={styles.retryButton}
        disabled={disabled || (remaining ?? 0) > 0}
        onClick={onRetry}
        type="button"
      >
        Retry
      </button>
    </div>
  );
}

function ExistingFoundation() {
  const profile = existingProfileFoundation;
  const [existing, setExisting] = useState<ExistingDemoState>(
    createExistingDemoState,
  );
  const [catalog, setCatalog] = useState<CatalogFood[]>([...foodCatalog]);
  const [activities, setActivities] = useState<ConversationActivity[]>([]);
  const [cloudError, setCloudError] = useState("");
  const [rateLimitWindow, setRateLimitWindow] =
    useState<RateLimitWindow | null>(null);
  const rateLimitRemaining = useRateLimitCountdown(rateLimitWindow);
  const cloudVersion = useRef(1);
  const cloudQueue = useRef<Promise<void>>(Promise.resolve());
  const [weightInput, setWeightInput] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [proposalError, setProposalError] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentStatus, setAgentStatus] = useState<
    | "thinking"
    | "searching"
    | "validating"
    | "checking_foods"
    | "remembering"
    | "creating_draft"
    | "revising_draft"
    | null
  >(null);
  const [streamingText, setStreamingText] = useState("");
  const [pendingAgentText, setPendingAgentText] = useState("");
  const [agentDiagnostics, setAgentDiagnostics] = useState<Record<
    string,
    string
  > | null>(null);
  const [lastAgentRequest, setLastAgentRequest] = useState<{
    input: CoachMessageRequest["input"];
    commandId: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadCloudProfile<ExistingDemoState>("existing")
      .then((result) => {
        if (cancelled) return;
        cloudVersion.current = result.profile.version;
        setExisting(result.profile.state);
        setActivities(result.profile.activityEvents ?? []);
        if (result.catalog.length > 0) setCatalog(result.catalog);
        const reviewKey = "arnold-trend-review:existing";
        if (!window.sessionStorage.getItem(reviewKey)) {
          window.sessionStorage.setItem(reviewKey, "started");
          void sendExistingAgent(
            {
              type: "interaction",
              interactionId: `existing-session-review-v${result.profile.state.activePlan.version}`,
              action: "review_trend",
            },
            createCommandId(),
          );
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setCloudError(
            error instanceof Error
              ? error.message
              : "The cloud demo state is unavailable.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
    // The opening review is intentionally bound to the first hydration only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function dispatchExisting(action: ExistingDemoAction) {
    setExisting((current) => existingDemoReducer(current, action));
    cloudQueue.current = cloudQueue.current.then(async () => {
      try {
        const profile = await sendCloudAction<ExistingDemoState>({
          profileId: "existing",
          expectedVersion: cloudVersion.current,
          commandId: action.commandId,
          action,
        });
        cloudVersion.current = profile.version;
        setExisting(profile.state);
        setCloudError("");
      } catch (error) {
        if (error instanceof CloudStateError && error.current) {
          cloudVersion.current = error.current.version;
          setExisting(error.current.state as ExistingDemoState);
        }
        setCloudError(
          error instanceof Error
            ? error.message
            : "The cloud demo state is unavailable.",
        );
      }
    });
  }

  const weightDecision = useMemo(
    () =>
      evaluateWeightAdjustmentDecision({
        goal: profile.goal ?? "maintenance",
        measurements: existing.measurements,
        activePlan: existing.activePlan,
      }),
    [existing.activePlan, existing.measurements, profile.goal],
  );
  const trend = weightDecision.trend;
  async function sendExistingAgent(
    agentInput: CoachMessageRequest["input"],
    commandId = createCommandId(),
  ) {
    if (agentBusy) return;
    setLastAgentRequest({ input: agentInput, commandId });
    setAgentBusy(true);
    setStreamingText("");
    setPendingAgentText(
      agentInput.type === "text"
        ? agentInput.text
        : agentInput.action.replaceAll("_", " "),
    );
    setCloudError("");
    setRateLimitWindow(null);
    setAgentDiagnostics(null);
    try {
      await cloudQueue.current;
      const result = await sendCoachMessage({
        request: {
          profileId: "existing",
          expectedVersion: cloudVersion.current,
          commandId,
          input: agentInput,
        },
        onStatus: setAgentStatus,
        onText: (delta) => setStreamingText((current) => current + delta),
      });
      cloudVersion.current = result.profile.version;
      setExisting(result.profile.state as ExistingDemoState);
      setActivities(result.profile.activityEvents ?? []);
      if (result.catalogFood) {
        setCatalog((current) => [
          ...current.filter((food) => food.id !== result.catalogFood!.id),
          result.catalogFood!,
        ]);
      }
      setChatInput("");
      setStreamingText("");
      setPendingAgentText("");
    } catch (error) {
      if (error instanceof AgentClientError && error.current) {
        cloudVersion.current = error.current.version;
        setExisting(error.current.state as ExistingDemoState);
      }
      if (error instanceof AgentClientError) {
        setAgentDiagnostics(error.diagnostics ?? null);
        if (error.code === "rate_limited") {
          const observedAt = Date.now();
          setRateLimitWindow({
            observedAt,
            retryAt: observedAt + (error.retryAfterSeconds ?? 60) * 1_000,
          });
        } else {
          setRateLimitWindow(null);
        }
      } else {
        setRateLimitWindow(null);
      }
      try {
        const latest = await loadCloudProfile<ExistingDemoState>("existing");
        cloudVersion.current = latest.profile.version;
        setExisting(latest.profile.state);
        setActivities(latest.profile.activityEvents ?? []);
      } catch {
        // Keep the last confirmed render when reload is also unavailable.
      }
      setPendingAgentText("");
      setStreamingText("");
      setCloudError(
        error instanceof Error
          ? error.message
          : "The coach could not complete this message.",
      );
    } finally {
      setAgentBusy(false);
      setAgentStatus(null);
    }
  }
  function approveExistingDraft() {
    if (!existing.draft || agentBusy) return;
    void sendExistingAgent({
      type: "interaction",
      interactionId: existing.draft.id,
      action: "approve_draft",
    });
  }

  function rejectExistingDraft() {
    if (!existing.draft || agentBusy) return;
    void sendExistingAgent({
      type: "interaction",
      interactionId: existing.draft.id,
      action: "reject_draft",
    });
  }
  function saveTodayWeight(weightKg: number) {
    const date = new Date().toISOString().slice(0, 10);
    if (existing.measurements.some((item) => item.date === date)) {
      setProposalError(
        "Today’s weight is already recorded. Select its chart point to edit it.",
      );
      return;
    }
    const commandId = createCommandId();
    const measurement: WeightMeasurement = {
      id: `weight-${commandId}`,
      date,
      weightKg,
      commandId,
    };
    dispatchExisting({
      type: "record_weight",
      commandId,
      measurement,
    });
    setProposalError("");
  }
  function submitWeightChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = chatInput.trim();
    if (!message) return;
    void sendExistingAgent({ type: "text", text: message });
  }
  function submitWeightForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (agentBusy) return;
    try {
      saveTodayWeight(normalizeWeightKg(Number(weightInput)));
      setWeightInput("");
    } catch (error) {
      setProposalError(
        error instanceof Error ? error.message : "Enter a valid weight.",
      );
    }
  }
  function editExistingWeight(date: string, weightKg: number) {
    if (agentBusy) return;
    const commandId = createCommandId();
    dispatchExisting({
      type: "edit_weight",
      commandId,
      date,
      weightKg,
    });
    setProposalError("");
  }
  function deleteExistingWeight(date: string) {
    if (agentBusy) return;
    const commandId = createCommandId();
    dispatchExisting({
      type: "delete_weight",
      commandId,
      date,
    });
    setProposalError("");
  }
  async function resetExistingDemo() {
    if (agentBusy) return;
    if (!window.confirm("Reset only the Existing demo to its seeded state?")) {
      return;
    }
    try {
      const profile = await resetCloudProfile<ExistingDemoState>({
        profileId: "existing",
        expectedVersion: cloudVersion.current,
        commandId: createCommandId(),
      });
      cloudVersion.current = profile.version;
      setExisting(profile.state);
      setCloudError("");
    } catch (error) {
      if (error instanceof CloudStateError && error.current) {
        cloudVersion.current = error.current.version;
        setExisting(error.current.state as ExistingDemoState);
      }
      setCloudError(error instanceof Error ? error.message : "Reset failed.");
      return;
    }
    setProposalError("");
  }
  return (
    <section className={styles.existingLayout}>
      <p className={styles.kicker}>Prepared profile · foundation checkpoint</p>
      <h1>The adjustment story starts with a trusted baseline.</h1>
      <p>
        This fixed profile includes an Active Plan and a seeded two-month weight
        history. No additional account is created.
      </p>
      {cloudError && rateLimitWindow === null ? (
        <div className={styles.errorBox} role="alert">
          <div className={styles.errorCopy}>
            <p>{cloudError}</p>
            <RateLimitCountdown remaining={rateLimitRemaining} />
          </div>
          {agentDiagnostics ? (
            <details>
              <summary>Technical details</summary>
              <p>
                {Object.entries(agentDiagnostics)
                  .map(([key, value]) => `${key}: ${value}`)
                  .join(" · ")}
              </p>
            </details>
          ) : null}
          {lastAgentRequest ? (
            <button
              className={styles.retryButton}
              disabled={agentBusy || (rateLimitRemaining ?? 0) > 0}
              onClick={() =>
                void sendExistingAgent(
                  lastAgentRequest.input,
                  rateLimitWindow === null
                    ? lastAgentRequest.commandId
                    : createCommandId(),
                )
              }
              type="button"
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
      <div className={styles.existingGrid}>
        {existing.draft ? (
          <PlanPanel
            activePlan={existing.activePlan}
            catalog={catalog}
            disabled={agentBusy}
            draft={existing.draft}
            onApprove={approveExistingDraft}
            onReject={rejectExistingDraft}
            targets={existing.activePlan.plan.targetSnapshot}
          />
        ) : null}
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
      <NutritionTransparencyPanel
        plan={existing.activePlan.plan}
        profile={profile}
        targetSnapshot={existing.activePlan.plan.targetSnapshot}
      />
      <section className={styles.weightWorkspace} aria-label="Weight tracking">
        <article className={styles.weightChartCard}>
          <div className={styles.weightCardHeader}>
            <div>
              <span>Weight history</span>
              <h2>Your recorded weights</h2>
            </div>
            <button
              className={styles.resetButton}
              disabled={agentBusy}
              onClick={resetExistingDemo}
              type="button"
            >
              Reset demo
            </button>
          </div>
          <WeightTrendChart
            disabled={agentBusy}
            footer={
              <form
                className={styles.recordWeightForm}
                onSubmit={submitWeightForm}
              >
                <label className={styles.srOnly} htmlFor="record-weight">
                  Weight in kilograms
                </label>
                <input
                  aria-label="Weight in kilograms"
                  disabled={agentBusy}
                  id="record-weight"
                  inputMode="decimal"
                  min="1"
                  onChange={(event) => setWeightInput(event.target.value)}
                  placeholder="kg"
                  step="0.01"
                  type="number"
                  value={weightInput}
                />
                <button
                  className={styles.primaryAction}
                  disabled={agentBusy}
                  type="submit"
                >
                  Save today
                </button>
              </form>
            }
            measurements={existing.measurements}
            onDelete={deleteExistingWeight}
            onEdit={editExistingWeight}
            trend={trend}
          />
          <WeightDecisionPanel decision={weightDecision} />
        </article>
        <article
          className={`${styles.existingCard} ${styles.weightActivePlan}`}
        >
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
              catalog={catalog}
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
        <article className={styles.weightChatCard}>
          <span>Coach conversation</span>
          <ArnoldCapabilitiesPanel
            availability={capabilityAvailability({
              profileReady: true,
              hasDraft: Boolean(existing.draft),
              hasActivePlan: true,
              isExisting: true,
            })}
            onSelect={setChatInput}
          />
          <div className={styles.weightMessages} aria-live="polite">
            {existing.messages
              .filter((message) => !isAgentRateLimitMessage(message.text))
              .map((message) => (
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
            {rateLimitWindow && lastAgentRequest ? (
              <RateLimitChatMessage
                className={styles.weightAssistantMessage}
                disabled={agentBusy}
                onRetry={() =>
                  void sendExistingAgent(
                    lastAgentRequest.input,
                    createCommandId(),
                  )
                }
                remaining={rateLimitRemaining}
              />
            ) : null}
            {pendingAgentText ? (
              <div className={styles.weightUserMessage}>{pendingAgentText}</div>
            ) : null}
            {activities
              .filter((activity) => activity.status === "pending")
              .map((activity) => (
                <div className={styles.processing} key={activity.id}>
                  <span className={styles.pulse} aria-hidden="true" />
                  {activity.label}
                </div>
              ))}
            {proposalError ? (
              <p className={styles.errorBox} role="alert">
                {proposalError}
              </p>
            ) : null}
            {existing.agentSession.pendingInteraction ? (
              <AgentInteractionPanel
                catalog={catalog}
                disabled={agentBusy}
                interaction={existing.agentSession.pendingInteraction}
                onAction={(value) => void sendExistingAgent(value)}
                onQuickReply={(text) =>
                  void sendExistingAgent({ type: "text", text })
                }
              />
            ) : null}
            {streamingText ? (
              <div className={styles.weightAssistantMessage}>
                {streamingText}
              </div>
            ) : null}
            {agentBusy ? (
              <div className={styles.processing} role="status">
                <span className={styles.pulse} />
                {agentStatusLabel(agentStatus)}
              </div>
            ) : null}
          </div>
          <form className={styles.composer} onSubmit={submitWeightChat}>
            <textarea
              aria-label="Message to nutrition coach"
              disabled={agentBusy}
              maxLength={1_000}
              onKeyDown={handleComposerKeyDown}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder="Add a food, record a weight, or ask about your plan"
              rows={2}
              value={chatInput}
            />
            <button
              className={styles.sendButton}
              disabled={!chatInput.trim() || agentBusy}
              type="submit"
            >
              Send
            </button>
          </form>
        </article>
      </section>
      <CatalogSection
        approvedIds={existing.approvedCatalogFoodIds}
        catalog={catalog}
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
  const [state, setState] = useState(createNewDemoState);
  const stateRef = useRef(state);
  const [catalog, setCatalog] = useState<CatalogFood[]>([...foodCatalog]);
  const [activities, setActivities] = useState<ConversationActivity[]>([]);
  const [cloudError, setCloudError] = useState("");
  const [rateLimitWindow, setRateLimitWindow] =
    useState<RateLimitWindow | null>(null);
  const rateLimitRemaining = useRateLimitCountdown(rateLimitWindow);
  const cloudVersion = useRef(1);
  const cloudQueue = useRef<Promise<void>>(Promise.resolve());
  const [draftMessage, setDraftMessage] = useState("");
  const [selectedFoodIds, setSelectedFoodIds] = useState<string[]>([]);
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentStatus, setAgentStatus] = useState<
    | "thinking"
    | "searching"
    | "validating"
    | "checking_foods"
    | "remembering"
    | "creating_draft"
    | "revising_draft"
    | null
  >(null);
  const [streamingText, setStreamingText] = useState("");
  const [pendingAgentText, setPendingAgentText] = useState("");
  const [agentDiagnostics, setAgentDiagnostics] = useState<Record<
    string,
    string
  > | null>(null);
  const [lastAgentRequest, setLastAgentRequest] = useState<{
    input: CoachMessageRequest["input"];
    commandId: string;
  } | null>(null);
  const turnLock = useRef(false);
  const messagesEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (profileId !== "new") return;
    let cancelled = false;
    void loadCloudProfile<import("@/store/demo-reducer").DemoState>("new")
      .then((result) => {
        if (cancelled) return;
        cloudVersion.current = result.profile.version;
        stateRef.current = result.profile.state;
        setState(result.profile.state);
        setActivities(result.profile.activityEvents ?? []);
        if (result.catalog.length > 0) setCatalog(result.catalog);
      })
      .catch((error) => {
        if (!cancelled) {
          setCloudError(
            error instanceof Error
              ? error.message
              : "The cloud demo state is unavailable.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  function dispatch(action: DemoAction) {
    if (action.type === "hydrate") {
      stateRef.current = action.state;
      setState(action.state);
      return;
    }
    setState((current) => {
      const next = demoReducer(current, action, createCatalogSnapshot(catalog));
      stateRef.current = next;
      return next;
    });
    if (profileId !== "new") return;
    let cloudAction: NewDemoCloudAction | null = null;
    switch (action.type) {
      case "apply_closed":
        cloudAction = {
          type: "apply_closed",
          optionId: action.optionId,
        };
        break;
      case "apply_food_selection":
      case "record_weight":
      case "edit_weight":
      case "delete_weight":
        cloudAction = action;
        break;
    }
    if (!cloudAction) return;
    cloudQueue.current = cloudQueue.current.then(async () => {
      try {
        const profile = await sendCloudAction<
          import("@/store/demo-reducer").DemoState
        >({
          profileId: "new",
          expectedVersion: cloudVersion.current,
          commandId:
            globalThis.crypto?.randomUUID?.() ??
            `cloud-mutation-${Date.now()}-${Math.random()}`,
          action: cloudAction,
        });
        cloudVersion.current = profile.version;
        stateRef.current = profile.state;
        setState(profile.state);
        setCloudError("");
      } catch (error) {
        if (error instanceof CloudStateError && error.current) {
          cloudVersion.current = error.current.version;
          stateRef.current = error.current
            .state as import("@/store/demo-reducer").DemoState;
          setState(
            error.current.state as import("@/store/demo-reducer").DemoState,
          );
        }
        setCloudError(
          error instanceof Error
            ? error.message
            : "The cloud demo state is unavailable.",
        );
      }
    });
  }

  async function sendFreshAgent(
    agentInput: CoachMessageRequest["input"],
    commandId = createCommandId(),
  ) {
    if (agentBusy) return;
    setLastAgentRequest({ input: agentInput, commandId });
    setAgentBusy(true);
    setStreamingText("");
    setPendingAgentText(
      agentInput.type === "text"
        ? agentInput.text
        : agentInput.action.replaceAll("_", " "),
    );
    setCloudError("");
    setRateLimitWindow(null);
    setAgentDiagnostics(null);
    try {
      await cloudQueue.current;
      const result = await sendCoachMessage({
        request: {
          profileId: "new",
          expectedVersion: cloudVersion.current,
          commandId,
          input: agentInput,
        },
        onStatus: setAgentStatus,
        onText: (delta) => setStreamingText((current) => current + delta),
      });
      cloudVersion.current = result.profile.version;
      stateRef.current = result.profile
        .state as import("@/store/demo-reducer").DemoState;
      setState(
        result.profile.state as import("@/store/demo-reducer").DemoState,
      );
      setActivities(result.profile.activityEvents ?? []);
      if (result.catalogFood) {
        setCatalog((current) => [
          ...current.filter((food) => food.id !== result.catalogFood!.id),
          result.catalogFood!,
        ]);
      }
      setDraftMessage("");
      setStreamingText("");
      setPendingAgentText("");
    } catch (error) {
      if (error instanceof AgentClientError && error.current) {
        cloudVersion.current = error.current.version;
        stateRef.current = error.current
          .state as import("@/store/demo-reducer").DemoState;
        setState(
          error.current.state as import("@/store/demo-reducer").DemoState,
        );
      }
      if (error instanceof AgentClientError) {
        setAgentDiagnostics(error.diagnostics ?? null);
        if (error.code === "rate_limited") {
          const observedAt = Date.now();
          setRateLimitWindow({
            observedAt,
            retryAt: observedAt + (error.retryAfterSeconds ?? 60) * 1_000,
          });
        } else {
          setRateLimitWindow(null);
        }
      } else {
        setRateLimitWindow(null);
      }
      try {
        const latest =
          await loadCloudProfile<import("@/store/demo-reducer").DemoState>(
            "new",
          );
        cloudVersion.current = latest.profile.version;
        stateRef.current = latest.profile.state;
        setState(latest.profile.state);
        setActivities(latest.profile.activityEvents ?? []);
      } catch {
        // Keep the last confirmed render when reload is also unavailable.
      }
      setPendingAgentText("");
      setStreamingText("");
      setCloudError(
        error instanceof Error
          ? error.message
          : "The coach could not complete this message.",
      );
    } finally {
      setAgentBusy(false);
      setAgentStatus(null);
    }
  }

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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draftMessage.trim();
    if (!message) return;
    void sendFreshAgent({ type: "text", text: message });
  }

  function handleDraftRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draftMessage.trim() || "Generate my Draft Meal Plan";
    void sendFreshAgent({ type: "text", text: message });
  }

  function handleQuickReply(option: QuickReplyOption) {
    if (turnLock.current || state.status !== "idle") return;
    turnLock.current = true;
    dispatch({
      type: "apply_closed",
      commandId: createCommandId(),
      optionId: option.id,
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
    if (!state.pendingCommand) return;
    void sendFreshAgent(
      { type: "text", text: state.pendingCommand.message },
      state.pendingCommand.id,
    );
  }

  async function handleReset() {
    if (agentBusy) return;
    if (
      !window.confirm("Reset only the Fresh demo to its empty starting state?")
    ) {
      return;
    }
    turnLock.current = false;
    try {
      const profile = await resetCloudProfile<
        import("@/store/demo-reducer").DemoState
      >({
        profileId: "new",
        expectedVersion: cloudVersion.current,
        commandId: createCommandId(),
      });
      cloudVersion.current = profile.version;
      stateRef.current = profile.state;
      setState(profile.state);
      setCloudError("");
    } catch (error) {
      if (error instanceof CloudStateError && error.current) {
        cloudVersion.current = error.current.version;
        stateRef.current = error.current
          .state as import("@/store/demo-reducer").DemoState;
        setState(
          error.current.state as import("@/store/demo-reducer").DemoState,
        );
      }
      setCloudError(error instanceof Error ? error.message : "Reset failed.");
      return;
    }
    setDraftMessage("");
    setSelectedFoodIds([]);
  }

  function handleApprove() {
    if (!state.draft || turnLock.current || state.status !== "idle") return;
    void sendFreshAgent({
      type: "interaction",
      interactionId: state.draft.id,
      action: "approve_draft",
    });
  }

  function handleReject() {
    if (!state.draft || turnLock.current || state.status !== "idle") return;
    void sendFreshAgent({
      type: "interaction",
      interactionId: state.draft.id,
      action: "reject_draft",
    });
  }

  function recordFreshWeight(weightKg: number) {
    const date = new Date().toISOString().slice(0, 10);
    if (
      stateRef.current.weightMeasurements.some((item) => item.date === date)
    ) {
      throw new Error(
        "Today's weight already exists; select its point to edit it.",
      );
    }
    const commandId = createCommandId();
    dispatch({
      type: "record_weight",
      commandId,
      measurement: {
        id: `weight-${commandId}`,
        date,
        weightKg,
        commandId,
      },
    });
  }

  function editFreshWeight(date: string, weightKg: number) {
    dispatch({
      type: "edit_weight",
      commandId: createCommandId(),
      date,
      weightKg,
    });
  }

  function deleteFreshWeight(date: string) {
    dispatch({
      type: "delete_weight",
      commandId: createCommandId(),
      date,
    });
  }

  const inputEnabled =
    profileId === "new" &&
    state.status === "idle" &&
    !agentBusy &&
    state.activeTurn.type !== "closed_question" &&
    state.activeTurn.type !== "food_grid";
  const draftWasDeclined = state.messages.some((message) =>
    message.text.startsWith("The Draft was declined."),
  );
  const processingText =
    state.pendingOperation === "draft"
      ? "Building and validating your Draft…"
      : state.pendingOperation === "modification"
        ? "Checking that Draft change…"
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
        ) : state.activePlan ? (
          <FreshActiveDashboard
            activities={activities}
            agentBusy={agentBusy}
            agentStatusText={agentStatusLabel(agentStatus)}
            catalog={catalog}
            cloudError={cloudError}
            messageInput={draftMessage}
            onAgentAction={(input) => void sendFreshAgent(input)}
            onApprove={handleApprove}
            onDeleteWeight={deleteFreshWeight}
            onEditWeight={editFreshWeight}
            onMessageInput={setDraftMessage}
            onRecordWeight={recordFreshWeight}
            onReject={handleReject}
            onReset={() => void handleReset()}
            onSendMessage={handleSubmit}
            pendingAgentText={pendingAgentText}
            state={state}
            streamingText={streamingText}
          />
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
                <ArnoldCapabilitiesPanel
                  availability={capabilityAvailability({
                    profileReady: isProfileReady(state.profile),
                    hasDraft: Boolean(state.draft),
                    hasActivePlan: Boolean(state.activePlan),
                    isExisting: false,
                  })}
                  onSelect={setDraftMessage}
                />
              </header>

              {cloudError && rateLimitWindow === null ? (
                <div className={styles.errorBox} role="alert">
                  <div className={styles.errorCopy}>
                    <p>{cloudError}</p>
                    <RateLimitCountdown remaining={rateLimitRemaining} />
                  </div>
                  {agentDiagnostics ? (
                    <details>
                      <summary>Technical details</summary>
                      <p>
                        {Object.entries(agentDiagnostics)
                          .map(([key, value]) => `${key}: ${value}`)
                          .join(" · ")}
                      </p>
                    </details>
                  ) : null}
                  {lastAgentRequest ? (
                    <button
                      className={styles.retryButton}
                      disabled={agentBusy || (rateLimitRemaining ?? 0) > 0}
                      onClick={() =>
                        void sendFreshAgent(
                          lastAgentRequest.input,
                          rateLimitWindow === null
                            ? lastAgentRequest.commandId
                            : createCommandId(),
                        )
                      }
                      type="button"
                    >
                      Retry
                    </button>
                  ) : null}
                </div>
              ) : null}

              <div className={styles.messages} aria-live="polite">
                {state.messages
                  .filter((message) => !isAgentRateLimitMessage(message.text))
                  .map((message) => (
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
                {rateLimitWindow && lastAgentRequest ? (
                  <RateLimitChatMessage
                    className={`${styles.message} ${styles.assistantMessage}`}
                    disabled={agentBusy}
                    onRetry={() =>
                      void sendFreshAgent(
                        lastAgentRequest.input,
                        createCommandId(),
                      )
                    }
                    remaining={rateLimitRemaining}
                  />
                ) : null}
                {pendingAgentText ? (
                  <div
                    className={`${styles.message} ${styles.userMessage}`}
                    data-role="user"
                  >
                    {pendingAgentText}
                  </div>
                ) : null}
                {state.status === "processing" ? (
                  <div className={styles.processing} role="status">
                    <span className={styles.pulse} aria-hidden="true" />
                    {processingText}
                  </div>
                ) : null}
                {state.agentSession.pendingInteraction ? (
                  <AgentInteractionPanel
                    catalog={catalog}
                    disabled={agentBusy}
                    interaction={state.agentSession.pendingInteraction}
                    onAction={(value) => void sendFreshAgent(value)}
                    onQuickReply={(text) =>
                      void sendFreshAgent({ type: "text", text })
                    }
                  />
                ) : null}
                {activities
                  .filter((activity) => activity.status === "pending")
                  .map((activity) => (
                    <div className={styles.processing} key={activity.id}>
                      <span className={styles.pulse} aria-hidden="true" />
                      {activity.label}
                    </div>
                  ))}
                {streamingText ? (
                  <div
                    className={`${styles.message} ${styles.assistantMessage}`}
                  >
                    {streamingText}
                  </div>
                ) : null}
                {agentBusy ? (
                  <div className={styles.processing} role="status">
                    <span className={styles.pulse} aria-hidden="true" />
                    {agentStatusLabel(agentStatus)}
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
                      catalog={catalog}
                      disabled={state.status !== "idle"}
                      onSubmit={submitFoodSelection}
                      onToggle={toggleFood}
                      selectedIds={selectedFoodIds}
                    />
                    <DisabledComposer placeholder="Complete food selection above" />
                  </>
                ) : state.draft ? (
                  <>
                    <section
                      aria-label="Draft approval actions"
                      className={styles.draftApprovalDock}
                    >
                      <div>
                        <strong>Validated Draft ready</strong>
                        <small>
                          Review the plan beside the conversation, then approve
                          or decline it here.
                        </small>
                      </div>
                      <div className={styles.approvalActions}>
                        <button
                          className={styles.primaryAction}
                          disabled={agentBusy}
                          onClick={handleApprove}
                          type="button"
                        >
                          Approve &amp; activate
                        </button>
                        <button
                          className={styles.secondaryAction}
                          disabled={agentBusy}
                          onClick={handleReject}
                          type="button"
                        >
                          Decline Draft
                        </button>
                      </div>
                    </section>
                    <form className={styles.composer} onSubmit={handleSubmit}>
                      <textarea
                        aria-label="Message to nutrition coach"
                        disabled={!inputEnabled}
                        maxLength={1_000}
                        onKeyDown={handleComposerKeyDown}
                        onChange={(event) =>
                          setDraftMessage(event.target.value)
                        }
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
                  </>
                ) : state.activePlan ? (
                  <form className={styles.composer} onSubmit={handleSubmit}>
                    <textarea
                      aria-label="Message to nutrition coach"
                      disabled={!inputEnabled}
                      maxLength={1_000}
                      onKeyDown={handleComposerKeyDown}
                      onChange={(event) => setDraftMessage(event.target.value)}
                      placeholder="Ask about your plan, record feedback, or add a food…"
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
                        onKeyDown={handleComposerKeyDown}
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
                        : draftMessage.trim()
                          ? "Send"
                          : "Generate Draft"}
                    </button>
                  </form>
                ) : (
                  <form className={styles.composer} onSubmit={handleSubmit}>
                    <textarea
                      aria-label="Message to nutrition coach"
                      disabled={!inputEnabled}
                      maxLength={1_000}
                      onKeyDown={handleComposerKeyDown}
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
                  disabled={agentBusy}
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
                      .map(
                        (id) =>
                          catalog.find((food) => food.id === id)?.displayName ??
                          id,
                      )
                      .join(" · ")}
                  </p>
                </details>
              ) : null}
              {state.targets ? (
                <NutritionTransparencyPanel
                  plan={state.draft?.plan ?? null}
                  profile={state.profile}
                  targetSnapshot={
                    state.draft?.plan.targetSnapshot ?? state.targets
                  }
                />
              ) : null}
              <PlanPanel
                activePlan={state.activePlan}
                catalog={catalog}
                disabled={state.status !== "idle" || agentBusy}
                draft={state.draft}
                onApprove={handleApprove}
                onReject={handleReject}
                targets={state.targets}
                showActions={!state.draft}
              />
            </aside>
          </>
        )}
      </div>
    </main>
  );
}
