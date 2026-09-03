"use client";

import type {
  AgentInteraction,
  CoachMessageRequest,
} from "@/domain/agent/types";
import type { CatalogFood } from "@/domain/catalog/types";
import { PlanContents } from "./PlanPanel";
import styles from "./CoachWorkspace.module.css";

type InteractionInput = Extract<
  CoachMessageRequest["input"],
  { type: "interaction" }
>;

function Macros({
  values,
}: {
  values: {
    energyKcal: number;
    proteinG: number;
    carbohydrateG: number;
    fatG: number;
    fiberG: number | null;
  };
}) {
  return (
    <p>
      {values.energyKcal.toFixed(0)} kcal · P {values.proteinG.toFixed(1)} g · C{" "}
      {values.carbohydrateG.toFixed(1)} g · F {values.fatG.toFixed(1)} g
      {values.fiberG === null
        ? " · fiber unavailable"
        : ` · fiber ${values.fiberG.toFixed(1)} g`}
    </p>
  );
}

export function AgentInteractionPanel({
  interaction,
  catalog,
  disabled,
  onAction,
  onQuickReply,
}: {
  interaction: AgentInteraction;
  catalog: CatalogFood[];
  disabled: boolean;
  onAction: (input: InteractionInput) => void;
  onQuickReply: (text: string) => void;
}) {
  if (interaction.type === "clarification") {
    return (
      <div className={styles.adjustmentChatProposal}>
        <p>{interaction.prompt}</p>
        {interaction.quickReplies.length > 0 ? (
          <div
            className={styles.quickReplies}
            aria-label="Coach clarification choices"
          >
            {interaction.quickReplies.map((reply) => (
              <button
                disabled={disabled}
                key={reply}
                onClick={() => onQuickReply(reply)}
                type="button"
              >
                {reply}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }
  if (interaction.type === "food_candidates") {
    return (
      <div
        className={styles.adjustmentChatProposal}
        aria-label="USDA food candidates"
      >
        <span>USDA FoodData Central · verified candidates</span>
        <h3>Choose the exact food</h3>
        {interaction.candidates.map((candidate, index) => (
          <article className={styles.existingCard} key={candidate.id}>
            <strong>
              {index + 1}. {candidate.title}
            </strong>
            <p>
              {candidate.dataType} · {candidate.description}
            </p>
            <Macros values={candidate.nutrientsPer100g} />
            <button
              className={styles.secondaryAction}
              disabled={disabled}
              onClick={() =>
                onAction({
                  type: "interaction",
                  interactionId: interaction.id,
                  action: "select_candidate",
                  candidateId: candidate.id,
                })
              }
              type="button"
            >
              Select this food
            </button>
          </article>
        ))}
      </div>
    );
  }
  if (interaction.type === "food_approval") {
    const { food } = interaction.candidate;
    return (
      <div className={styles.adjustmentChatProposal} aria-label="Food approval">
        <span>{interaction.candidate.sourceLabel}</span>
        <h3>{food.displayName}</h3>
        <p>
          {food.preparation} · {food.category} · {food.mealClassification}
        </p>
        <Macros values={food.nutrientsPer100g} />
        <p>
          Serving: {food.displayPortion.label} ({food.displayPortion.grams} g) ·
          kosher review not checked
        </p>
        {food.source.provider === "USDA FoodData Central" ? (
          <p>
            <a
              href={`https://fdc.nal.usda.gov/food-details/${food.source.fdcId}/nutrients`}
              rel="noreferrer"
              target="_blank"
            >
              View USDA source
            </a>
          </p>
        ) : food.source.provider === "Fuder" ? (
          <p>
            <a href={food.source.url} rel="noreferrer" target="_blank">
              View source
            </a>
          </p>
        ) : null}
        <div className={styles.approvalActions}>
          <button
            className={styles.primaryAction}
            disabled={disabled}
            onClick={() =>
              onAction({
                type: "interaction",
                interactionId: interaction.id,
                action: "approve_food",
                candidateId: interaction.candidate.id,
              })
            }
            type="button"
          >
            Approve food
          </button>
          <button
            className={styles.secondaryAction}
            disabled={disabled}
            onClick={() =>
              onAction({
                type: "interaction",
                interactionId: interaction.id,
                action: "reject_food",
                candidateId: interaction.candidate.id,
              })
            }
            type="button"
          >
            Reject
          </button>
        </div>
      </div>
    );
  }
  if (interaction.type === "existing_food") {
    return (
      <div className={styles.adjustmentChatProposal}>
        <span>Central catalog match</span>
        <h3>{interaction.food.displayName}</h3>
        <Macros values={interaction.food.nutrientsPer100g} />
        {interaction.alreadyApproved ? (
          <p>This food is already in this profile’s approved foods.</p>
        ) : (
          <button
            className={styles.primaryAction}
            disabled={disabled}
            onClick={() =>
              onAction({
                type: "interaction",
                interactionId: interaction.id,
                action: "add_existing_food",
              })
            }
            type="button"
          >
            Add to my foods
          </button>
        )}
      </div>
    );
  }
  if (interaction.type === "confirm_draft_food") {
    return (
      <div className={styles.adjustmentChatProposal}>
        <h3>Use {interaction.displayName} in a new Draft?</h3>
        <p>
          Your Active Plan will not change unless you later approve the Draft.
        </p>
        <div className={styles.approvalActions}>
          <button
            className={styles.primaryAction}
            disabled={disabled}
            onClick={() =>
              onAction({
                type: "interaction",
                interactionId: interaction.id,
                action: "confirm_draft_food",
              })
            }
            type="button"
          >
            Create Draft
          </button>
          <button
            className={styles.secondaryAction}
            disabled={disabled}
            onClick={() =>
              onAction({
                type: "interaction",
                interactionId: interaction.id,
                action: "decline_draft_food",
              })
            }
            type="button"
          >
            Not now
          </button>
        </div>
      </div>
    );
  }
  if (interaction.type === "source_unavailable") {
    return (
      <div className={styles.adjustmentChatProposal}>
        <span>USDA source unavailable</span>
        <h3>No safe verified candidate was found</h3>
        <p>
          Your catalog and profile were not changed. You can refine the search
          or explicitly request an unverified AI estimate.
        </p>
        <details>
          <summary>Technical details</summary>
          <p>
            Stage: USDA · code: {interaction.failureCode} · lookup:{" "}
            {interaction.lookupId}
          </p>
        </details>
        <div className={styles.approvalActions}>
          <button
            className={styles.primaryAction}
            disabled={disabled}
            onClick={() =>
              onAction({
                type: "interaction",
                interactionId: interaction.id,
                action: "confirm_ai_estimate",
              })
            }
            type="button"
          >
            Use an AI estimate
          </button>
          <button
            className={styles.secondaryAction}
            disabled={disabled}
            onClick={() =>
              onAction({
                type: "interaction",
                interactionId: interaction.id,
                action: "refine_search",
              })
            }
            type="button"
          >
            Refine search
          </button>
        </div>
      </div>
    );
  }
  return (
    <div
      className={styles.adjustmentChatProposal}
      aria-label="Adjustment approval"
    >
      <span>AI adjustment proposal · Draft</span>
      <h3>{interaction.draft.summary}</h3>
      <PlanContents catalog={catalog} proposal={interaction.draft} />
      <div className={styles.approvalActions}>
        <button
          className={styles.primaryAction}
          disabled={disabled}
          onClick={() =>
            onAction({
              type: "interaction",
              interactionId: interaction.id,
              action: "approve_adjustment",
            })
          }
          type="button"
        >
          Approve proposal
        </button>
        <button
          className={styles.secondaryAction}
          disabled={disabled}
          onClick={() =>
            onAction({
              type: "interaction",
              interactionId: interaction.id,
              action: "reject_adjustment",
            })
          }
          type="button"
        >
          Decline
        </button>
      </div>
    </div>
  );
}
