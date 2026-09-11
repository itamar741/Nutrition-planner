import { useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import type {
  CoachMessageRequest,
  ConversationActivity,
} from "@/domain/agent/types";
import type { CatalogFood } from "@/domain/catalog/types";
import { evaluateWeightAdjustmentDecision } from "@/domain/weight/decision";
import { normalizeWeightKg } from "@/domain/weight/trend";
import type { DemoState } from "@/store/demo-reducer";
import { AgentInteractionPanel } from "./AgentInteractionPanel";
import { ArnoldCapabilitiesPanel } from "./ArnoldCapabilitiesPanel";
import { CatalogSection } from "./CatalogSection";
import {
  NutritionTransparencyPanel,
  WeightDecisionPanel,
} from "./NutritionTransparencyPanel";
import { PlanContents, PlanPanel } from "./PlanPanel";
import { WeightTrendChart } from "./WeightTrendChart";
import styles from "./CoachWorkspace.module.css";

const goalLabels = {
  fat_loss: "Fat loss",
  maintenance: "Maintenance",
  muscle_gain: "Muscle gain",
} as const;

function activityLabel(value: string) {
  return value
    .replace("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function submitComposerOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
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

export function FreshActiveDashboard({
  state,
  catalog,
  activities,
  cloudError,
  agentBusy,
  agentStatusText,
  pendingAgentText,
  streamingText,
  messageInput,
  onMessageInput,
  onSendMessage,
  onAgentAction,
  onReset,
  onApprove,
  onReject,
  onRecordWeight,
  onEditWeight,
  onDeleteWeight,
}: {
  state: DemoState;
  catalog: CatalogFood[];
  activities: ConversationActivity[];
  cloudError: string;
  agentBusy: boolean;
  agentStatusText: string;
  pendingAgentText: string;
  streamingText: string;
  messageInput: string;
  onMessageInput: (value: string) => void;
  onSendMessage: (event: FormEvent<HTMLFormElement>) => void;
  onAgentAction: (input: CoachMessageRequest["input"]) => void;
  onReset: () => void;
  onApprove: () => void;
  onReject: () => void;
  onRecordWeight: (weightKg: number) => void;
  onEditWeight: (date: string, weightKg: number) => void;
  onDeleteWeight: (date: string) => void;
}) {
  const [weightInput, setWeightInput] = useState("");
  const [weightError, setWeightError] = useState("");
  const activePlan = state.activePlan;
  const decision = useMemo(
    () =>
      activePlan && state.profile.goal
        ? evaluateWeightAdjustmentDecision({
            goal: state.profile.goal,
            measurements: state.weightMeasurements,
            activePlan,
          })
        : null,
    [activePlan, state.profile.goal, state.weightMeasurements],
  );
  if (!activePlan || !decision || !state.profile.goal) return null;

  function submitWeight(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const weightKg = normalizeWeightKg(Number(weightInput));
      onRecordWeight(weightKg);
      setWeightInput("");
      setWeightError("");
    } catch (error) {
      setWeightError(
        error instanceof Error ? error.message : "Enter a valid weight.",
      );
    }
  }

  return (
    <section className={styles.existingLayout}>
      <p className={styles.kicker}>Personal profile · active plan</p>
      <h1>Your approved plan and progress, in one place.</h1>
      <p>
        This dashboard uses the profile, foods, plan, and weight history you
        created during onboarding.
      </p>
      {cloudError ? (
        <div className={styles.errorBox} role="alert">
          <p>{cloudError}</p>
        </div>
      ) : null}
      <div className={styles.existingGrid}>
        {state.draft ? (
          <PlanPanel
            activePlan={activePlan}
            catalog={catalog}
            disabled={agentBusy}
            draft={state.draft}
            onApprove={onApprove}
            onReject={onReject}
            showActions={false}
            targets={state.targets}
          />
        ) : null}
        <article className={styles.existingCard}>
          <span>Profile</span>
          <h3>
            {state.profile.age} ·{" "}
            {state.profile.equationSex === "male" ? "Male" : "Female"} ·{" "}
            {state.profile.heightCm} cm
          </h3>
          <p>Your confirmed onboarding facts.</p>
        </article>
        <article className={styles.existingCard}>
          <span>Fixed goal</span>
          <h3>{goalLabels[state.profile.goal]}</h3>
          <p>Restart onboarding to choose a different goal.</p>
        </article>
        <article className={styles.existingCard}>
          <span>Activity basis</span>
          <h3>{activityLabel(activePlan.plan.targetSnapshot.palCategory)}</h3>
          <p>
            Your confirmed daily routine and weekly exercise determine this
            activity category.
          </p>
        </article>
      </div>
      <NutritionTransparencyPanel
        plan={state.draft?.plan ?? activePlan.plan}
        profile={state.profile}
        targetSnapshot={
          state.draft?.plan.targetSnapshot ?? activePlan.plan.targetSnapshot
        }
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
              onClick={onReset}
              type="button"
            >
              Reset demo
            </button>
          </div>
          <WeightTrendChart
            disabled={agentBusy}
            footer={
              <form className={styles.recordWeightForm} onSubmit={submitWeight}>
                <label className={styles.srOnly} htmlFor="fresh-weight">
                  Weight in kilograms
                </label>
                <input
                  aria-label="Weight in kilograms"
                  disabled={agentBusy}
                  id="fresh-weight"
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
            measurements={state.weightMeasurements}
            onDelete={onDeleteWeight}
            onEdit={onEditWeight}
            trend={decision.trend}
          />
          {weightError ? (
            <p className={styles.errorBox} role="alert">
              {weightError}
            </p>
          ) : null}
          <WeightDecisionPanel decision={decision} />
        </article>
        <article
          className={`${styles.existingCard} ${styles.weightActivePlan}`}
        >
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
              catalog={catalog}
              proposal={{
                schemaVersion: 1,
                id: "active-" + activePlan.version,
                basePlanVersion: activePlan.version,
                reason: "initial",
                summary: "Your approved repeatable day.",
                plan: activePlan.plan,
              }}
            />
          </details>
        </article>
        <article className={styles.weightChatCard}>
          <span>Coach conversation</span>
          <ArnoldCapabilitiesPanel
            availability={{
              draft: {
                available: !state.draft,
                note: "Review or revise the current Draft first.",
              },
              foods: { available: true },
              calculations: { available: true },
              weight: { available: true },
              trend: {
                available: false,
                note: "Available in the Existing profile.",
              },
              goal: { available: true },
            }}
            onSelect={onMessageInput}
          />
          <div className={styles.weightMessages} aria-live="polite">
            {state.messages.map((message) => (
              <div
                className={
                  message.role === "assistant"
                    ? styles.weightAssistantMessage
                    : styles.weightUserMessage
                }
                data-role={message.role}
                key={message.id}
              >
                {message.text}
              </div>
            ))}
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
            {state.agentSession.pendingInteraction ? (
              <AgentInteractionPanel
                catalog={catalog}
                disabled={agentBusy}
                interaction={state.agentSession.pendingInteraction}
                onAction={onAgentAction}
                onQuickReply={(text) => onAgentAction({ type: "text", text })}
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
                {agentStatusText}
              </div>
            ) : null}
          </div>
          {state.draft ? (
            <section
              aria-label="Draft approval actions"
              className={styles.draftApprovalDock}
            >
              <div>
                <strong>Validated Draft ready</strong>
                <small>
                  Review the Draft above, then approve or decline it here.
                </small>
              </div>
              <div className={styles.approvalActions}>
                <button
                  className={styles.primaryAction}
                  disabled={agentBusy}
                  onClick={onApprove}
                  type="button"
                >
                  Approve &amp; activate
                </button>
                <button
                  className={styles.secondaryAction}
                  disabled={agentBusy}
                  onClick={onReject}
                  type="button"
                >
                  Decline Draft
                </button>
              </div>
            </section>
          ) : null}
          <form className={styles.composer} onSubmit={onSendMessage}>
            <textarea
              aria-label="Message to nutrition coach"
              disabled={agentBusy}
              maxLength={1000}
              onChange={(event) => onMessageInput(event.target.value)}
              onKeyDown={submitComposerOnEnter}
              placeholder="Add a food, record feedback, or ask about your plan"
              rows={2}
              value={messageInput}
            />
            <button
              className={styles.sendButton}
              disabled={!messageInput.trim() || agentBusy}
              type="submit"
            >
              Send
            </button>
          </form>
        </article>
      </section>
      <CatalogSection
        approvedIds={state.profile.approvedCatalogFoodIds}
        catalog={catalog}
      />
    </section>
  );
}
