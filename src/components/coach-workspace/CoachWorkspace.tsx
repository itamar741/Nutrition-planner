"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
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
  createExistingDemoState,
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
  formatWeightKg,
  normalizeWeightKg,
  parseCurrentWeightMessage,
  type WeightMeasurement,
} from "@/domain/weight/trend";
import type { DemoProfileId, QuickReplyOption } from "@/domain/profile/types";
import type { DraftProposal, MealPlan } from "@/domain/plan/types";
import {
  CloudStateError,
  loadCloudProfile,
  resetCloudProfile,
  sendCloudAction,
} from "@/store/cloud-demo-client";
import {
  demoReducer,
  type DemoAction,
  type PendingCommand,
} from "@/store/demo-reducer";
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
import { RuntimeFoodAssistant } from "@/components/RuntimeFoodAssistant";
import styles from "./CoachWorkspace.module.css";

function createCommandId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `command-${Date.now()}-${Math.random()}`
  );
}

function describePlanChanges(current: MealPlan, proposed: MealPlan) {
  const changes: string[] = [];
  for (const proposedMeal of proposed.meals) {
    const currentMeal = current.meals.find(
      (meal) => meal.id === proposedMeal.id,
    );
    const count = Math.max(
      currentMeal?.items.length ?? 0,
      proposedMeal.items.length,
    );
    for (let index = 0; index < count; index += 1) {
      const before = currentMeal?.items[index];
      const after = proposedMeal.items[index];
      if (!before && after) {
        const food = foodCatalogById.get(after.catalogFoodId);
        changes.push(
          `${proposedMeal.name}: add ${food?.displayName ?? after.catalogFoodId} ${after.grams} g`,
        );
      } else if (before && !after) {
        const food = foodCatalogById.get(before.catalogFoodId);
        changes.push(
          `${proposedMeal.name}: remove ${food?.displayName ?? before.catalogFoodId} ${before.grams} g`,
        );
      } else if (
        before &&
        after &&
        before.catalogFoodId !== after.catalogFoodId
      ) {
        const beforeFood = foodCatalogById.get(before.catalogFoodId);
        const afterFood = foodCatalogById.get(after.catalogFoodId);
        changes.push(
          `${proposedMeal.name}: ${beforeFood?.displayName ?? before.catalogFoodId} ${before.grams} g → ${afterFood?.displayName ?? after.catalogFoodId} ${after.grams} g`,
        );
      } else if (before && after && before.grams !== after.grams) {
        const food = foodCatalogById.get(after.catalogFoodId);
        changes.push(
          `${proposedMeal.name}: ${food?.displayName ?? after.catalogFoodId} ${before.grams} g → ${after.grams} g`,
        );
      }
    }
  }
  return changes;
}

function CatalogSection({
  approvedIds,
  catalog,
}: {
  approvedIds: string[];
  catalog: readonly CatalogFood[];
}) {
  const approvedFoods = catalog.filter((food) => approvedIds.includes(food.id));
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
  const [existing, setExisting] = useState<ExistingDemoState>(
    createExistingDemoState,
  );
  const [catalog, setCatalog] = useState<CatalogFood[]>([...foodCatalog]);
  const [cloudError, setCloudError] = useState("");
  const cloudVersion = useRef(1);
  const cloudQueue = useRef<Promise<void>>(Promise.resolve());
  const [weightInput, setWeightInput] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [editingMeasurement, setEditingMeasurement] =
    useState<WeightMeasurement | null>(null);
  const [editingWeight, setEditingWeight] = useState("");
  const [proposalState, setProposalState] = useState<
    "pending" | "awaiting_feedback" | "approved"
  >("pending");
  const [adjustmentDraft, setAdjustmentDraft] = useState<DraftProposal | null>(
    null,
  );
  const [proposalError, setProposalError] = useState("");
  const [isGeneratingProposal, setIsGeneratingProposal] = useState(false);
  const [catalogMode, setCatalogMode] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadCloudProfile<ExistingDemoState>("existing")
      .then((result) => {
        if (cancelled) return;
        cloudVersion.current = result.profile.version;
        setExisting(result.profile.state);
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
      const commandId = createCommandId();
      dispatchExisting({
        type: "add_messages",
        commandId,
        messages: [
          appendChat(
            "assistant",
            "Today’s weight is already recorded. Select its chart point to edit it.",
          ),
        ],
      });
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
      messages: [
        ...(source === "chat"
          ? [appendChat("user", `${formatWeightKg(weightKg)} kg`)]
          : []),
        appendChat(
          "assistant",
          `Recorded ${formatWeightKg(weightKg)} kg for today. Your trend was recalculated.`,
        ),
      ],
    });
    setAdjustmentDraft(null);
    setProposalState("pending");
    setCatalogMode(false);
    setProposalError("");
  }
  function submitWeightChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = chatInput.trim();
    if (!message) return;
    setChatInput("");
    if (proposalState === "awaiting_feedback") {
      const commandId = createCommandId();
      dispatchExisting({
        type: "add_messages",
        commandId,
        messages: [appendChat("user", message)],
      });
      setProposalState("pending");
      void generateAdjustmentProposal(message);
      return;
    }
    const weightKg = parseCurrentWeightMessage(message);
    if (weightKg === null) {
      const commandId = createCommandId();
      dispatchExisting({
        type: "add_messages",
        commandId,
        messages: [
          appendChat("user", message),
          appendChat(
            "assistant",
            "Please send only today’s weight in kilograms, for example 80.4 kg.",
          ),
        ],
      });
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
      const commandId = createCommandId();
      dispatchExisting({
        type: "add_messages",
        commandId,
        messages: [
          appendChat(
            "assistant",
            error instanceof Error ? error.message : "Enter a valid weight.",
          ),
        ],
      });
    }
  }
  function startEditing(measurement: WeightMeasurement) {
    setEditingMeasurement(measurement);
    setEditingWeight(formatWeightKg(measurement.weightKg));
  }
  function saveEditedWeight(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingMeasurement) return;
    try {
      const weightKg = normalizeWeightKg(Number(editingWeight));
      const commandId = createCommandId();
      dispatchExisting({
        type: "edit_weight",
        commandId,
        date: editingMeasurement.date,
        weightKg,
        messages: [
          appendChat(
            "assistant",
            `Updated ${editingMeasurement.date} to ${formatWeightKg(weightKg)} kg. Your trend was recalculated.`,
          ),
        ],
      });
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
  async function resetExistingDemo() {
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
    setEditingMeasurement(null);
    setAdjustmentDraft(null);
    setProposalError("");
    setProposalState("pending");
  }
  function approveAdjustment() {
    if (!adjustmentDraft || proposalState !== "pending") return;
    const commandId = createCommandId();
    dispatchExisting({
      type: "approve_adjustment",
      commandId,
      draft: adjustmentDraft,
      activatedAt: new Date().toISOString(),
      messages: [
        appendChat("user", "Approve proposal"),
        appendChat(
          "assistant",
          `Approved. Your Active Plan is now version ${adjustmentDraft.plan.version}.`,
        ),
      ],
    });
    setAdjustmentDraft(null);
    setProposalState("approved");
  }
  function declineAdjustment() {
    if (!adjustmentDraft || proposalState !== "pending") return;
    setAdjustmentDraft(null);
    setProposalState("awaiting_feedback");
    const commandId = createCommandId();
    dispatchExisting({
      type: "add_messages",
      commandId,
      messages: [
        appendChat("user", "Decline proposal"),
        appendChat(
          "assistant",
          "Your Active Plan was not changed. What did you not like about the proposal? I can prepare one new bounded Draft using your approved foods.",
        ),
      ],
    });
  }
  async function generateAdjustmentProposal(feedback?: string) {
    if (
      !direction ||
      isGeneratingProposal ||
      (proposalState !== "pending" && !feedback)
    )
      return;
    setIsGeneratingProposal(true);
    setProposalError("");
    try {
      const response = await fetch("/api/coach/adjustment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commandId: createCommandId(),
          ...(feedback ? { feedback } : {}),
          profile: {
            ...existingReadyProfile,
            approvedCatalogFoodIds: existing.approvedCatalogFoodIds,
          },
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
      const draft = adjustmentSuccessSchema.parse(body).draft;
      setAdjustmentDraft(draft);
      const messageCommandId = createCommandId();
      dispatchExisting({
        type: "add_messages",
        commandId: messageCommandId,
        messages: [
          appendChat(
            "assistant",
            feedback
              ? "I used your feedback to prepare another validated Draft. Review the exact changes below."
              : "I prepared a validated adjustment Draft. Review the exact changes below before deciding.",
          ),
        ],
      });
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
  const adjustmentChanges = adjustmentDraft
    ? describePlanChanges(existing.activePlan.plan, adjustmentDraft.plan)
    : [];
  return (
    <section className={styles.existingLayout}>
      <p className={styles.kicker}>Prepared profile · foundation checkpoint</p>
      <h1>The adjustment story starts with a trusted baseline.</h1>
      <p>
        This fixed profile includes an Active Plan and a seeded two-month weight
        history. No additional account is created.
      </p>
      {cloudError ? (
        <p className={styles.errorBox} role="alert">
          {cloudError}
        </p>
      ) : null}
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
              step="0.01"
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
            {direction && proposalState === "pending" ? (
              adjustmentDraft ? (
                <div className={styles.adjustmentChatProposal}>
                  <span>AI adjustment proposal · Draft</span>
                  <h3>
                    {direction === "increase" ? "Increase" : "Decrease"} by{" "}
                    {adjustmentKcal} kcal/day
                  </h3>
                  <p>{adjustmentDraft.summary}</p>
                  <div className={styles.adjustmentComparison}>
                    <span>
                      Current target
                      <strong>
                        {existing.activePlan.plan.targetSnapshot.energyKcal}{" "}
                        kcal
                      </strong>
                    </span>
                    <span aria-hidden="true">→</span>
                    <span>
                      Proposed target
                      <strong>
                        {adjustmentDraft.plan.targetSnapshot.energyKcal} kcal
                      </strong>
                    </span>
                  </div>
                  <div className={styles.adjustmentChanges}>
                    <strong>Exact proposed changes</strong>
                    {adjustmentChanges.length > 0 ? (
                      <ul>
                        {adjustmentChanges.map((change) => (
                          <li key={change}>{change}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>The daily composition is unchanged.</p>
                    )}
                  </div>
                  <details className={styles.adjustmentPlanDetails}>
                    <summary>View full proposed daily plan</summary>
                    <PlanContents
                      catalog={catalog}
                      proposal={adjustmentDraft}
                    />
                  </details>
                  <div className={styles.approvalActions}>
                    <button
                      className={styles.primaryAction}
                      onClick={approveAdjustment}
                      type="button"
                    >
                      Approve proposal
                    </button>
                    <button
                      className={styles.secondaryAction}
                      onClick={declineAdjustment}
                      type="button"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ) : (
                <div className={styles.weightAssistantMessage}>
                  <p>
                    Your deterministic trend supports a bounded {direction} of{" "}
                    {adjustmentKcal} kcal/day.
                  </p>
                  <button
                    className={styles.primaryAction}
                    disabled={isGeneratingProposal}
                    onClick={() => void generateAdjustmentProposal()}
                    type="button"
                  >
                    {isGeneratingProposal
                      ? "Creating validated proposal…"
                      : "Generate AI proposal"}
                  </button>
                </div>
              )
            ) : null}
            {isGeneratingProposal ? (
              <div className={styles.processing} role="status">
                <span className={styles.pulse} />
                Creating a validated adjustment Draft…
              </div>
            ) : null}
            {proposalError ? (
              <p className={styles.errorBox} role="alert">
                {proposalError}
              </p>
            ) : null}
            {!catalogMode ? (
              <div className={styles.weightAssistantMessage}>
                <p>Want a basic food that is not in your approved foods?</p>
                <button
                  className={styles.secondaryAction}
                  disabled={isGeneratingProposal || Boolean(adjustmentDraft)}
                  onClick={() => setCatalogMode(true)}
                  type="button"
                >
                  Add a missing food
                </button>
              </div>
            ) : null}
          </div>
          {catalogMode ? (
            <RuntimeFoodAssistant
              context="general"
              embedded
              getExpectedVersion={() => cloudVersion.current}
              onClose={() => setCatalogMode(false)}
              onFoodApproved={(food) => {
                setCatalog((current) => [
                  ...current.filter((candidate) => candidate.id !== food.id),
                  food,
                ]);
                dispatchExisting({
                  type: "add_messages",
                  commandId: createCommandId(),
                  messages: [
                    appendChat(
                      "assistant",
                      `${food.displayName} is now in your approved foods. Your Active Plan was not changed.`,
                    ),
                  ],
                });
              }}
              onProfileUpdated={(cloudProfile) => {
                cloudVersion.current = cloudProfile.version;
                setExisting(cloudProfile.state as ExistingDemoState);
              }}
              profileId="existing"
            />
          ) : (
            <form className={styles.composer} onSubmit={submitWeightChat}>
              <textarea
                aria-label={
                  proposalState === "awaiting_feedback"
                    ? "Adjustment feedback"
                    : "Today’s weight message"
                }
                disabled={isGeneratingProposal || Boolean(adjustmentDraft)}
                maxLength={proposalState === "awaiting_feedback" ? 1_000 : 100}
                onChange={(event) => setChatInput(event.target.value)}
                placeholder={
                  proposalState === "awaiting_feedback"
                    ? "Tell the coach what you want changed in the next Draft"
                    : "Example: 80.4 kg"
                }
                rows={2}
                value={chatInput}
              />
              <button
                className={styles.sendButton}
                disabled={
                  !chatInput.trim() ||
                  isGeneratingProposal ||
                  Boolean(adjustmentDraft)
                }
                type="submit"
              >
                Send
              </button>
            </form>
          )}
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
              step="0.01"
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
      </div>
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
  const [cloudError, setCloudError] = useState("");
  const cloudVersion = useRef(1);
  const cloudQueue = useRef<Promise<void>>(Promise.resolve());
  const [draftMessage, setDraftMessage] = useState("");
  const [selectedFoodIds, setSelectedFoodIds] = useState<string[]>([]);
  const [isSlow, setIsSlow] = useState(false);
  const [catalogMode, setCatalogMode] = useState(false);
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
          action,
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
    const confirmedState = stateRef.current;
    if (turnLock.current || confirmedState.status === "processing") return;
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
          profile: confirmedState.profile,
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
    requiredCatalogFoodId?: string,
  ) {
    const confirmedState = stateRef.current;
    if (turnLock.current || confirmedState.status === "processing") return;
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
                requiredCatalogFoodId,
                profile: confirmedState.profile,
              }
            : {
                commandId: command.id,
                message: command.message,
                requiredCatalogFoodId,
                profile: confirmedState.profile,
                draft: confirmedState.draft,
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

  async function handleReset() {
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
    setCatalogMode(false);
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
                <button
                  className={styles.secondaryAction}
                  disabled={state.status !== "idle"}
                  onClick={() => setCatalogMode(true)}
                  type="button"
                >
                  Add a missing food
                </button>
              </header>

              {cloudError ? (
                <p className={styles.errorBox} role="alert">
                  {cloudError}
                </p>
              ) : null}

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
                {catalogMode ? (
                  <RuntimeFoodAssistant
                    context={
                      state.draft
                        ? "draft_modification"
                        : state.targets
                          ? "draft_creation"
                          : "onboarding"
                    }
                    embedded
                    getExpectedVersion={() => cloudVersion.current}
                    onClose={() => setCatalogMode(false)}
                    onFoodApproved={(food) => {
                      setCatalog((current) => [
                        ...current.filter(
                          (candidate) => candidate.id !== food.id,
                        ),
                        food,
                      ]);
                      const current = stateRef.current;
                      if (current.draft || current.targets) {
                        const message = `Use ${food.displayName} in my next validated Draft.`;
                        setDraftMessage(message);
                        void sendPlanCommand(
                          { id: createCommandId(), message },
                          current.draft ? "modification" : "draft",
                          false,
                          food.id,
                        );
                      }
                    }}
                    onProfileUpdated={(cloudProfile) => {
                      cloudVersion.current = cloudProfile.version;
                      stateRef.current =
                        cloudProfile.state as import("@/store/demo-reducer").DemoState;
                      setState(
                        cloudProfile.state as import("@/store/demo-reducer").DemoState,
                      );
                    }}
                    profileId="new"
                  />
                ) : state.status === "failed" && state.pendingCommand ? (
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
                      .map(
                        (id) =>
                          catalog.find((food) => food.id === id)?.displayName ??
                          id,
                      )
                      .join(" · ")}
                  </p>
                </details>
              ) : null}
              <PlanPanel
                activePlan={state.activePlan}
                catalog={catalog}
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
