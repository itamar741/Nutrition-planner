import { describe, expect, it } from "vitest";
import {
  allowedToolsForDecision,
  decisionAuthorizesOnboardingExtraction,
  decisionAuthorizesIntent,
} from "@/application/turn-execution-policy";
import type { CoachToolName } from "@/ai/coach-agent";
import type { TurnDecision } from "@/domain/agent/turn-decision";
import type { AgentInteraction } from "@/domain/agent/types";

const allTools: CoachToolName[] = [
  "remember_preference",
  "remove_approved_food",
  "inspect_food_availability",
  "record_weight",
  "edit_weight",
  "delete_weight",
  "search_foods",
  "select_food_candidate",
  "submit_draft_proposal",
  "submit_adjustment_proposal",
];

function decision(
  input: Partial<TurnDecision> & Pick<TurnDecision, "intent">,
): TurnDecision {
  return {
    speechAct: "request",
    foodNames: [],
    candidateOrdinal: null,
    planChangeStrategy: null,
    evidence: "supporting text",
    ...input,
  };
}

describe("turn execution policy", () => {
  it("exposes only the Draft tool for a plan mutation", () => {
    expect(
      allowedToolsForDecision(allTools, decision({ intent: "plan_replace" })),
    ).toEqual(["submit_draft_proposal"]);
  });

  it("permits inspect then remove for one explicit food-removal request", () => {
    expect(
      allowedToolsForDecision(allTools, decision({ intent: "food_remove" })),
    ).toEqual(["remove_approved_food", "inspect_food_availability"]);
  });

  it.each(["question", "hypothetical", "negated"] as const)(
    "exposes no mutation tools for a %s",
    (speechAct) => {
      const value = decision({ intent: "weight_record", speechAct });
      expect(allowedToolsForDecision(allTools, value)).toEqual([]);
      expect(decisionAuthorizesIntent(value, "weight_record")).toBe(false);
    },
  );

  it("fails closed for an unknown decision", () => {
    expect(
      allowedToolsForDecision(allTools, decision({ intent: "unknown" })),
    ).toEqual([]);
  });

  it("authorizes bounded onboarding extraction only for an onboarding answer", () => {
    const answer = decision({
      intent: "onboarding_answer",
      speechAct: "answer",
    });
    expect(decisionAuthorizesOnboardingExtraction(answer, true)).toBe(true);
    expect(decisionAuthorizesOnboardingExtraction(answer, false)).toBe(false);
    expect(
      decisionAuthorizesOnboardingExtraction(
        { ...answer, speechAct: "hypothetical" },
        true,
      ),
    ).toBe(false);
    expect(
      decisionAuthorizesOnboardingExtraction(
        decision({ intent: "nutrition_question", speechAct: "question" }),
        true,
      ),
    ).toBe(false);
  });

  it("authorizes a short answer only against a compatible persisted interaction", () => {
    const answer = decision({
      intent: "food_search",
      speechAct: "answer",
    });
    const foodClarification: AgentInteraction = {
      id: "food-clarification",
      type: "clarification",
      workflow: "food",
      prompt: "Which food?",
      quickReplies: [],
    };

    expect(allowedToolsForDecision(allTools, answer)).toEqual([]);
    expect(
      allowedToolsForDecision(allTools, answer, foodClarification),
    ).toEqual(["search_foods"]);
  });

  it("does not let an answer for one workflow continue a different workflow", () => {
    const draftRetry = decision({
      intent: "draft_retry",
      speechAct: "answer",
    });
    const foodClarification: AgentInteraction = {
      id: "food-clarification",
      type: "clarification",
      workflow: "food",
      prompt: "Which food?",
      quickReplies: [],
    };

    expect(
      allowedToolsForDecision(allTools, draftRetry, foodClarification),
    ).toEqual([]);
  });

  it("routes an adjustment retry only through an adjustment failure review", () => {
    const retry = decision({
      intent: "adjustment_retry",
      speechAct: "answer",
    });
    const adjustmentReview: AgentInteraction = {
      id: "adjustment-failures",
      type: "draft_failure_review",
      proposalKind: "adjustment",
      basePlanVersion: 1,
      attempts: [],
      prompt: "How should I retry?",
    };
    const draftReview: AgentInteraction = {
      ...adjustmentReview,
      id: "draft-failures",
      proposalKind: "draft",
    };

    expect(allowedToolsForDecision(allTools, retry, adjustmentReview)).toEqual([
      "submit_adjustment_proposal",
    ]);
    expect(allowedToolsForDecision(allTools, retry, draftReview)).toEqual([]);
  });
});
