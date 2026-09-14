import { describe, expect, it } from "vitest";
import { interpretTurnDecision } from "@/ai/turn-decision";
import { decisionAuthorizesIntent } from "@/application/turn-execution-policy";

const hasLiveConfiguration = Boolean(
  process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL,
);
const liveDescribe = hasLiveConfiguration ? describe : describe.skip;

const baseContext = {
  hasActivePlan: true,
  hasDraft: false,
  onboardingRequired: false,
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
  }, 90_000);
});
