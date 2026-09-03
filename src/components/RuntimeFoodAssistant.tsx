"use client";

import { FormEvent, useState } from "react";
import type {
  FoodApprovalCandidate,
  FoodLookupContext,
  FoodSearchCandidate,
} from "@/domain/catalog/runtime";
import type { CatalogFood } from "@/domain/catalog/types";
import type { DemoProfileId } from "@/domain/profile/types";
import type { ClientDemoState, CloudProfile } from "@/store/cloud-demo-client";
import styles from "./RuntimeFoodAssistant.module.css";

function commandId() {
  return globalThis.crypto?.randomUUID?.() ?? `food-${Date.now()}`;
}

function format(value: number | null) {
  return value === null
    ? "Unknown"
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(
        value,
      );
}

export function RuntimeFoodAssistant({
  profileId,
  context,
  getExpectedVersion,
  onProfileUpdated,
  onFoodApproved,
  disabled = false,
  embedded = false,
  onClose,
}: {
  profileId: DemoProfileId;
  context: FoodLookupContext;
  getExpectedVersion: () => number;
  onProfileUpdated: (profile: CloudProfile) => void;
  onFoodApproved: (food: CatalogFood) => void;
  disabled?: boolean;
  embedded?: boolean;
  onClose?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<
    | "idle"
    | "searching"
    | "loading"
    | "review"
    | "unavailable"
    | "saved"
    | "error"
  >("idle");
  const [message, setMessage] = useState(
    "Ask me to add one food or packaged product that is missing from the catalog.",
  );
  const [candidates, setCandidates] = useState<FoodSearchCandidate[]>([]);
  const [review, setReview] = useState<FoodApprovalCandidate | null>(null);
  const [lookupId, setLookupId] = useState<string | null>(null);
  const [existingFood, setExistingFood] = useState<CatalogFood | null>(null);
  const [existingApproved, setExistingApproved] = useState(false);
  const [submittedQuery, setSubmittedQuery] = useState("");

  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    if (!value || disabled || status === "searching" || status === "loading")
      return;
    setStatus("searching");
    setSubmittedQuery(value);
    setMessage("I’m checking the central catalog and USDA FoodData Central…");
    setCandidates([]);
    setReview(null);
    setExistingFood(null);
    try {
      const response = await fetch("/api/coach/catalog/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, query: value, context }),
      });
      const body = (await response.json()) as {
        ok?: boolean;
        outcome?: "existing" | "candidates" | "clarification";
        message?: string;
        lookupId?: string;
        offerAiEstimate?: boolean;
        candidates?: FoodSearchCandidate[];
        food?: CatalogFood;
        alreadyApproved?: boolean;
      };
      if (body.outcome === "existing" && body.food) {
        setExistingFood(body.food);
        setExistingApproved(Boolean(body.alreadyApproved));
        setMessage(
          body.alreadyApproved
            ? `${body.food.displayName} is already in this profile's approved foods.`
            : `${body.food.displayName} already exists in the central catalog.`,
        );
        setStatus("idle");
        return;
      }
      if (body.outcome === "candidates" && body.candidates) {
        setCandidates(body.candidates);
        setLookupId(body.lookupId ?? null);
        setMessage(body.message ?? "Choose the exact source result you meant.");
        setStatus("idle");
        return;
      }
      if (body.outcome === "clarification") {
        setLookupId(body.lookupId ?? null);
        setMessage(
          body.message ?? "Please clarify the exact food you want to add.",
        );
        setStatus("idle");
        return;
      }
      if (body.offerAiEstimate && body.lookupId) {
        setLookupId(body.lookupId);
        setMessage(body.message ?? "The source is unavailable.");
        setStatus("unavailable");
        return;
      }
      throw new Error(body.message ?? "The lookup could not be completed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The lookup failed.");
      setStatus("error");
    }
  }

  async function selectCandidate(candidateId: string) {
    setStatus("loading");
    setMessage("Loading and validating the selected nutrition record…");
    try {
      const response = await fetch("/api/coach/catalog/candidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, candidateId }),
      });
      const body = (await response.json()) as {
        ok?: boolean;
        message?: string;
        candidate?: FoodApprovalCandidate;
        lookupId?: string;
        offerAiEstimate?: boolean;
      };
      if (body.offerAiEstimate && body.lookupId) {
        setLookupId(body.lookupId);
        setCandidates([]);
        setMessage(body.message ?? "The source is unavailable.");
        setStatus("unavailable");
        return;
      }
      if (!response.ok || !body.candidate) {
        throw new Error(body.message ?? "The source result is invalid.");
      }
      setReview(body.candidate);
      setCandidates([]);
      setMessage("Review the exact food and nutrition values before approval.");
      setStatus("review");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The source result failed.",
      );
      setStatus("error");
    }
  }

  async function requestAiEstimate() {
    if (!lookupId) return;
    setStatus("loading");
    setMessage("Creating a clearly labelled, unverified AI estimate…");
    try {
      const response = await fetch("/api/coach/catalog/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, lookupId }),
      });
      const body = (await response.json()) as {
        message?: string;
        candidate?: FoodApprovalCandidate;
      };
      if (!response.ok || !body.candidate) {
        throw new Error(body.message ?? "The estimate could not be created.");
      }
      setReview(body.candidate);
      setStatus("review");
      setMessage("This is an AI estimate and was not verified by USDA.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The estimate failed.",
      );
      setStatus("error");
    }
  }

  async function approve() {
    if (!review) return;
    setStatus("loading");
    try {
      const response = await fetch("/api/coach/catalog/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId,
          candidateId: review.id,
          expectedVersion: getExpectedVersion(),
          commandId: commandId(),
        }),
      });
      const body = (await response.json()) as {
        message?: string;
        food?: CatalogFood;
        profile?: CloudProfile<ClientDemoState>;
      };
      if (!response.ok || !body.food || !body.profile) {
        if (body.profile) onProfileUpdated(body.profile);
        throw new Error(body.message ?? "Approval could not be saved.");
      }
      onProfileUpdated(body.profile);
      onFoodApproved(body.food);
      setReview(null);
      setQuery("");
      setMessage(body.message ?? `${body.food.displayName} is now available.`);
      setStatus("saved");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Approval failed.");
      setStatus("error");
    }
  }

  async function addExisting() {
    if (!existingFood || existingApproved) return;
    setStatus("loading");
    try {
      const response = await fetch("/api/coach/catalog/add-existing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId,
          foodId: existingFood.id,
          expectedVersion: getExpectedVersion(),
          commandId: commandId(),
        }),
      });
      const body = (await response.json()) as {
        message?: string;
        food?: CatalogFood;
        profile?: CloudProfile<ClientDemoState>;
      };
      if (!response.ok || !body.profile || !body.food) {
        if (body.profile) onProfileUpdated(body.profile);
        throw new Error(body.message ?? "The food could not be added.");
      }
      onProfileUpdated(body.profile);
      onFoodApproved(body.food);
      setExistingApproved(true);
      setMessage(body.message ?? "The food was added to this profile.");
      setStatus("saved");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The action failed.");
      setStatus("error");
    }
  }

  async function reject() {
    if (!review) return;
    setStatus("loading");
    try {
      const response = await fetch("/api/coach/catalog/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, candidateId: review.id }),
      });
      const body = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(body.message ?? "The candidate could not be rejected.");
      }
      setReview(null);
      setCandidates([]);
      setMessage(
        body.message ??
          "The candidate was rejected. Tell me what was wrong and refine the food description.",
      );
      setStatus("idle");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Rejection failed.");
      setStatus("error");
    }
  }

  return (
    <section
      className={`${styles.card} ${embedded ? styles.embedded : ""}`}
      aria-label="Catalog food conversation"
    >
      <div className={styles.heading}>
        <div>
          <span>Coach tool · USDA catalog</span>
          <h2>Add one missing basic food</h2>
        </div>
        {onClose ? (
          <button className={styles.close} onClick={onClose} type="button">
            Return to coach
          </button>
        ) : null}
      </div>
      {submittedQuery ? (
        <p className={styles.userBubble}>{submittedQuery}</p>
      ) : null}
      <p className={styles.assistantBubble} aria-live="polite">
        {message}
      </p>

      {candidates.length > 0 ? (
        <div className={styles.candidates} aria-label="USDA food candidates">
          {candidates.map((candidate) => (
            <button
              key={candidate.id}
              onClick={() => void selectCandidate(candidate.id)}
              type="button"
            >
              <strong>{candidate.title}</strong>
              <small>{candidate.description}</small>
            </button>
          ))}
        </div>
      ) : null}

      {existingFood && !existingApproved ? (
        <button
          className={styles.primary}
          onClick={() => void addExisting()}
          type="button"
        >
          Add to my foods
        </button>
      ) : null}

      {status === "unavailable" ? (
        <div className={styles.actions}>
          <button
            className={styles.primary}
            onClick={() => void requestAiEstimate()}
            type="button"
          >
            Use an AI estimate
          </button>
          <button onClick={() => setStatus("idle")} type="button">
            Refine search
          </button>
        </div>
      ) : null}

      {review ? (
        <article className={styles.review}>
          <span>{review.sourceLabel}</span>
          <h3>{review.food.displayName}</h3>
          <p>
            {review.food.preparation}
            {review.food.brand ? ` · ${review.food.brand}` : ""}
          </p>
          <dl>
            <div>
              <dt>Calories</dt>
              <dd>{format(review.food.nutrientsPer100g.energyKcal)} kcal</dd>
            </div>
            <div>
              <dt>Protein</dt>
              <dd>{format(review.food.nutrientsPer100g.proteinG)} g</dd>
            </div>
            <div>
              <dt>Carbs</dt>
              <dd>{format(review.food.nutrientsPer100g.carbohydrateG)} g</dd>
            </div>
            <div>
              <dt>Fat</dt>
              <dd>{format(review.food.nutrientsPer100g.fatG)} g</dd>
            </div>
            <div>
              <dt>Fiber</dt>
              <dd>{format(review.food.nutrientsPer100g.fiberG)} g</dd>
            </div>
          </dl>
          <p>
            Per 100 g · Practical serving: {review.food.displayPortion.label} (
            {format(review.food.displayPortion.grams)} g)
          </p>
          <p>
            {review.food.category} · {review.food.mealClassification} · kosher
            review not checked
          </p>
          {review.food.source.provider === "USDA FoodData Central" ? (
            <a
              href={`https://fdc.nal.usda.gov/food-details/${review.food.source.fdcId}/nutrients`}
              rel="noreferrer"
              target="_blank"
            >
              View USDA source
            </a>
          ) : null}
          <div className={styles.actions}>
            <button
              className={styles.primary}
              disabled={status === "loading"}
              onClick={() => void approve()}
              type="button"
            >
              Approve
            </button>
            <button
              disabled={status === "loading"}
              onClick={() => void reject()}
              type="button"
            >
              Reject
            </button>
          </div>
        </article>
      ) : null}

      {!review && candidates.length === 0 && status !== "unavailable" ? (
        <form onSubmit={lookup}>
          <textarea
            aria-label="Food to add"
            disabled={
              disabled || status === "searching" || status === "loading"
            }
            maxLength={120}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Example: cooked jasmine rice or אורז יסמין מבושל"
            rows={2}
            value={query}
          />
          <button
            className={styles.primary}
            disabled={
              disabled ||
              !query.trim() ||
              status === "searching" ||
              status === "loading"
            }
            type="submit"
          >
            {status === "searching" ? "Searching…" : "Send to coach"}
          </button>
        </form>
      ) : null}
    </section>
  );
}
