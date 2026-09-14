import { describe, expect, it, vi } from "vitest";
import {
  interpretTurnDecision,
  TurnDecisionContractError,
} from "@/ai/turn-decision";
import {
  requestsFoodAlternativeOffer,
  requestsPlanMutation,
  turnDecisionSchema,
  type TurnDecision,
} from "@/domain/agent/turn-decision";

const planReplacement: TurnDecision = {
  intent: "plan_replace",
  speechAct: "request",
  foodNames: [],
  planChangeStrategy: null,
  evidence: "change the whole meal plan",
};

describe("structured turn decision", () => {
  it("accepts a bounded whole-plan replacement decision", async () => {
    const createResponse = vi
      .fn()
      .mockResolvedValue(JSON.stringify(planReplacement));
    const decision = await interpretTurnDecision(
      {
        message: "I want to change the whole meal plan",
        hasActivePlan: true,
        hasDraft: false,
        onboardingRequired: false,
        recentConversation: [],
        pendingInteraction: null,
      },
      createResponse,
    );

    expect(decision).toEqual(planReplacement);
    expect(requestsPlanMutation(decision)).toBe(true);
    expect(createResponse.mock.calls[0]?.[0].userInput).toContain(
      '"hasActivePlan":true',
    );
  });

  it("represents an alternative offer and a contextual selection separately", () => {
    const offer = turnDecisionSchema.parse({
      intent: "food_alternatives",
      speechAct: "question",
      foodNames: ["rice"],
      planChangeStrategy: null,
      evidence: "any other oprions",
    });
    const selection = turnDecisionSchema.parse({
      intent: "food_alternative_selection",
      speechAct: "answer",
      foodNames: ["couscous"],
      planChangeStrategy: null,
      evidence: "couscous",
    });

    expect(requestsFoodAlternativeOffer(offer)).toBe(true);
    expect(requestsPlanMutation(offer)).toBe(false);
    expect(requestsPlanMutation(selection)).toBe(true);
  });

  it.each(["question", "hypothetical", "negated", "answer"] as const)(
    "does not authorize mutation for a %s speech act",
    (speechAct) => {
      expect(requestsPlanMutation({ ...planReplacement, speechAct })).toBe(
        false,
      );
    },
  );

  it("does not authorize a mutation without evidence from the current turn", () => {
    expect(requestsPlanMutation({ ...planReplacement, evidence: null })).toBe(
      false,
    );
  });

  it("repairs one invalid decision and rejects two invalid decisions", async () => {
    const repairedDecision = { ...planReplacement, evidence: "Change my plan" };
    const repaired = vi
      .fn()
      .mockResolvedValueOnce('{"intent":"plan_replace"}')
      .mockResolvedValueOnce(JSON.stringify(repairedDecision));
    await expect(
      interpretTurnDecision(
        {
          message: "Change my plan",
          hasActivePlan: true,
          hasDraft: false,
          onboardingRequired: false,
          recentConversation: [],
          pendingInteraction: null,
        },
        repaired,
      ),
    ).resolves.toEqual(repairedDecision);
    expect(repaired.mock.calls[1]?.[0].instructions).toContain(
      "previous structured result was invalid",
    );

    const invalid = vi.fn().mockResolvedValue("not json");
    await expect(
      interpretTurnDecision(
        {
          message: "Change my plan",
          hasActivePlan: true,
          hasDraft: false,
          onboardingRequired: false,
          recentConversation: [],
          pendingInteraction: null,
        },
        invalid,
      ),
    ).rejects.toBeInstanceOf(TurnDecisionContractError);
    expect(invalid).toHaveBeenCalledTimes(2);
  });
});
