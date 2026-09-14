import { describe, expect, it } from "vitest";
import {
  allowedToolsForDecision,
  decisionAuthorizesIntent,
} from "@/application/turn-execution-policy";
import type { CoachToolName } from "@/ai/coach-agent";
import type { TurnDecision } from "@/domain/agent/turn-decision";

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
});
