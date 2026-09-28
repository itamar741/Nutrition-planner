import { describe, expect, it } from "vitest";
import {
  buildArnoldSystemPrompt,
  coachToolNames,
  runCoachAgent,
  type CoachToolCall,
} from "@/ai/coach-agent";
import { createExistingDemoState } from "@/data/demo-fixtures";
import { foodCatalog } from "@/data/food-catalog";

const hasLiveConfiguration = Boolean(
  process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL,
);
const liveDescribe = hasLiveConfiguration ? describe : describe.skip;

const state = createExistingDemoState();
const approved = new Set(state.approvedCatalogFoodIds);
const approvedFoods = foodCatalog
  .filter((food) => approved.has(food.id))
  .map((food) => ({
    id: food.id,
    name: food.displayName,
    category: food.category,
    preparation: food.preparation,
    nutrientsPer100g: food.nutrientsPer100g,
    practicalGrams: food.practicalGrams,
  }));

async function firstToolFor(
  message: string,
  context: Record<string, unknown> = {},
) {
  const calls: CoachToolCall[] = [];
  await runCoachAgent({
    getSystemPrompt: () =>
      buildArnoldSystemPrompt({
        onboarding: { required: false },
        approvedFoods,
        expectedMealIds: state.activePlan.plan.meals.map((meal) => meal.id),
        nutritionTargets: state.activePlan.plan.targetSnapshot,
        pendingInteraction: null,
        pendingPlanChange: null,
        activePlan: state.activePlan,
        approvalBoundary:
          "Food, Draft, and adjustment approval requires a visible button.",
        ...context,
      }),
    conversation: [{ role: "user", content: message }],
    getAllowedTools: () => (calls.length === 0 ? [...coachToolNames] : []),
    onText: () => undefined,
    onTool: async (call) => {
      calls.push(call);
      return {
        status: "needs_user_action",
        code: "live_test_stop",
        message: "Stop after observing the first selected tool.",
      };
    },
  });
  return calls[0] ?? null;
}

liveDescribe("live tool-first orchestration", () => {
  it("chooses the food-resolution skill for cottage-cheese plan integration", async () => {
    const call = await firstToolFor(
      "i want to add cottage cheese to my meal plan",
    );
    expect(call).toMatchObject({
      name: "search_foods",
      arguments: {
        purpose: "integrate_into_plan",
        requestedFoodPhrase: expect.stringMatching(/cottage cheese/i),
        normalizedEnglishQuery: expect.stringMatching(/cottage cheese/i),
      },
    });
  }, 90_000);

  it("offers approved alternatives for the misspelled rice request", async () => {
    const call = await firstToolFor(
      "i dont like rice. any other oprions for my meal plan?",
    );
    expect(call).toMatchObject({
      name: "offer_approved_food_alternatives",
      arguments: {
        excludedCatalogFoodIds: expect.arrayContaining(["white-rice-cooked"]),
      },
    });
  }, 90_000);

  it("uses the Draft skill for a whole-plan replacement", async () => {
    const call = await firstToolFor("i want to change the whole meal plan");
    expect(call).toMatchObject({
      name: "submit_draft_proposal",
      arguments: {
        changeContext: { kind: "new_request", scope: "whole_plan" },
      },
    });
  }, 90_000);

  it("continues a stored alternative selection with the same Plan Change", async () => {
    const call = await firstToolFor("Potato, please.", {
      pendingInteraction: {
        type: "clarification",
        workflow: "draft",
        prompt: "Which approved alternative would you like to use?",
        quickReplies: ["Potato", "Quinoa"],
        planChangeId: "plan-change-alternative",
      },
      pendingPlanChange: {
        id: "plan-change-alternative",
        status: "awaiting_draft_confirmation",
        excludedCatalogFoodIds: ["white-rice-cooked"],
        requiredCatalogFoodIds: [],
        offeredAlternativeFoodIds: ["potato-baked", "quinoa-cooked"],
        selectedAlternativeFoodId: null,
        portionRecalculation: "whole_draft",
      },
    });
    expect(call).toMatchObject({
      name: "submit_draft_proposal",
      arguments: {
        changeContext: {
          kind: "continuation",
          planChangeId: "plan-change-alternative",
          selectedAlternativeFoodId: "potato-baked",
        },
      },
    });
  }, 90_000);

  it("submits a new Draft batch for a stored different-mix retry", async () => {
    const call = await firstToolFor("different mix of approved foods", {
      pendingInteraction: {
        type: "draft_failure_review",
        prompt: "Keep this structure or use a different approved mix?",
        planChangeId: "plan-change-retry",
      },
      pendingPlanChange: {
        id: "plan-change-retry",
        status: "failure_review",
        excludedCatalogFoodIds: [],
        requiredCatalogFoodIds: [],
        offeredAlternativeFoodIds: [],
        selectedAlternativeFoodId: null,
        portionRecalculation: "whole_draft",
        strategy: null,
      },
    });
    expect(call).toMatchObject({
      name: "submit_draft_proposal",
      arguments: {
        changeContext: {
          kind: "continuation",
          planChangeId: "plan-change-retry",
          retryStrategy: "different_approved_mix",
        },
      },
    });
  }, 90_000);

  it.each([
    "If I weigh 76 kg today, how would my trend change?",
    "Do not record this: I weigh 76 kg today",
    "Do not change my meal plan",
    "Write a JavaScript loop",
  ])(
    "does not select a mutating skill for: %s",
    async (message) => {
      expect(await firstToolFor(message)).toBeNull();
    },
    90_000,
  );
});
