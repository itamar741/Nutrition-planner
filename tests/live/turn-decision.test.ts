import { describe, expect, it } from "vitest";
import { interpretTurnDecision } from "@/ai/turn-decision";
import {
  decisionAuthorizesIntent,
  decisionAuthorizesOnboardingExtraction,
} from "@/application/turn-execution-policy";

const hasLiveConfiguration = Boolean(
  process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL,
);
const liveDescribe = hasLiveConfiguration ? describe : describe.skip;

const baseContext = {
  hasActivePlan: true,
  hasDraft: false,
  onboardingRequired: false,
  onboardingTurn: null,
  recentConversation: [],
  pendingInteraction: null,
};

liveDescribe("live structured turn decisions", () => {
  it("separates plan mutations, alternatives, and non-mutating speech acts", async () => {
    const replacement = await interpretTurnDecision({
      ...baseContext,
      message: "I want to change the whole meal plan",
    });
    expect(replacement).toMatchObject({
      intent: "plan_replace",
      speechAct: "request",
    });

    const alternatives = await interpretTurnDecision({
      ...baseContext,
      message: "i dont like rice. any other oprions for my meal plan?",
    });
    expect(alternatives).toMatchObject({
      intent: "food_alternatives",
      foodNames: expect.arrayContaining([expect.stringMatching(/rice/i)]),
    });

    const hypotheticalWeight = await interpretTurnDecision({
      ...baseContext,
      message: "If I weigh 76 kg today, how would my trend change?",
    });
    expect(decisionAuthorizesIntent(hypotheticalWeight, "weight_record")).toBe(
      false,
    );

    const negatedWeight = await interpretTurnDecision({
      ...baseContext,
      message: "Do not record this: I weigh 76 kg today",
    });
    expect(decisionAuthorizesIntent(negatedWeight, "weight_record")).toBe(
      false,
    );
  }, 90_000);

  it("uses stored workflow state for short continuation answers", async () => {
    const alternative = await interpretTurnDecision({
      ...baseContext,
      message: "Potato",
      pendingInteraction: {
        type: "clarification",
        workflow: "draft",
        offeredFoodNames: ["Potato", "Quinoa", "Sweet potato"],
      },
    });
    expect(alternative).toMatchObject({
      intent: "food_alternative_selection",
      speechAct: "answer",
      foodNames: expect.arrayContaining([expect.stringMatching(/potato/i)]),
    });

    const retry = await interpretTurnDecision({
      ...baseContext,
      message: "different mix of approved foods",
      pendingInteraction: {
        type: "draft_failure_review",
        workflow: "draft",
        offeredFoodNames: [],
      },
    });
    expect(retry).toMatchObject({
      intent: "draft_retry",
      speechAct: "answer",
      planChangeStrategy: "different_approved_mix",
    });

    const adjustmentRetry = await interpretTurnDecision({
      ...baseContext,
      message: "Try a different approved mix for the adjustment",
      pendingInteraction: {
        type: "draft_failure_review",
        workflow: "adjustment",
        offeredFoodNames: [],
      },
    });
    expect(adjustmentRetry).toMatchObject({
      intent: "adjustment_retry",
      speechAct: "answer",
    });

    const fifthCandidate = await interpretTurnDecision({
      ...baseContext,
      message: "the fifth one",
      pendingInteraction: {
        type: "food_candidates",
        workflow: "food",
        offeredFoodNames: [],
      },
    });
    expect(fifthCandidate).toMatchObject({
      intent: "food_candidate_selection",
      speechAct: "answer",
      candidateOrdinal: 5,
    });

    const staleTranscriptReply = await interpretTurnDecision({
      ...baseContext,
      message: "so add it",
      recentConversation: [
        { role: "user", content: "Yesterday was 76 kg" },
        {
          role: "assistant",
          content: "No weight is recorded for that date.",
        },
      ],
    });
    expect(
      decisionAuthorizesIntent(
        staleTranscriptReply,
        staleTranscriptReply.intent,
      ),
    ).toBe(false);
  }, 90_000);

  it("separates onboarding facts from hypothetical, negated, ambiguous, and premature actions", async () => {
    const onboardingContext = {
      ...baseContext,
      hasActivePlan: false,
      onboardingRequired: true,
      onboardingTurn: {
        id: "collect-basics",
        type: "open_question",
        field: "multiple",
        prompt: "Tell me your age, sex, height, and current weight.",
        optionLabels: [],
      },
    };
    const fact = await interpretTurnDecision({
      ...onboardingContext,
      message: "I am 30 years old",
    });
    expect(decisionAuthorizesOnboardingExtraction(fact, true)).toBe(true);

    const correction = await interpretTurnDecision({
      ...onboardingContext,
      message: "Actually, my age is 31",
    });
    expect(decisionAuthorizesOnboardingExtraction(correction, true)).toBe(true);

    for (const message of [
      "What would happen if I were 30?",
      "Do not set my age to 30",
      "30",
      "Create my meal plan now",
    ]) {
      const decision = await interpretTurnDecision({
        ...onboardingContext,
        message,
      });
      expect(decisionAuthorizesOnboardingExtraction(decision, true)).toBe(
        false,
      );
    }
  }, 90_000);
});
