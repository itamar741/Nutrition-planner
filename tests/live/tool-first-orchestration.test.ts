import { describe, expect, it } from "vitest";
import {
  buildArnoldSystemPrompt,
  coachToolNames,
  runCoachAgent,
  type CoachToolCall,
} from "@/ai/coach-agent";
import {
  createExistingDemoState,
  existingReadyProfile,
} from "@/data/demo-fixtures";
import { foodCatalog } from "@/data/food-catalog";
import { arnoldCapabilities } from "@/domain/agent/capabilities";
import { buildNutritionExplanation } from "@/domain/nutrition/explanations";
import { buildPlanValidationExplanation } from "@/domain/plan/validation";
import { calculateWeightTrend } from "@/domain/weight/trend";

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

const productionCapabilityContext = {
  advertisedCapabilities: arnoldCapabilities,
  calculationExplanation: buildNutritionExplanation(
    existingReadyProfile,
    state.activePlan.plan.targetSnapshot,
  ),
  planValidationExplanation: buildPlanValidationExplanation(
    existingReadyProfile,
    state.activePlan.plan,
  ),
  deterministicTrend: calculateWeightTrend(state.measurements, {
    activePlanActivatedAt: state.activePlan.activatedAt,
  }),
};

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
        ...productionCapabilityContext,
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

async function answerFor(
  message: string,
  context: Record<string, unknown> = {},
) {
  const calls: CoachToolCall[] = [];
  let streamed = "";
  const result = await runCoachAgent({
    getSystemPrompt: () =>
      buildArnoldSystemPrompt({
        onboarding: { required: false },
        approvedFoods,
        expectedMealIds: state.activePlan.plan.meals.map((meal) => meal.id),
        nutritionTargets: state.activePlan.plan.targetSnapshot,
        pendingInteraction: null,
        pendingPlanChange: null,
        activePlan: state.activePlan,
        ...productionCapabilityContext,
        ...context,
      }),
    conversation: [{ role: "user", content: message }],
    getAllowedTools: () => [...coachToolNames],
    onText: (delta) => {
      streamed += delta;
    },
    onTool: async (call) => {
      calls.push(call);
      return {
        status: "needs_user_action",
        code: "live_test_stop",
        message: "Stop after observing a selected tool.",
      };
    },
  });
  return { calls, text: (streamed || result.text).trim() };
}

liveDescribe("live tool-first orchestration", () => {
  it("submits a complete zero-volume routine for no exercise", async () => {
    const call = await firstToolFor("no exercise", {
      onboarding: {
        required: true,
        currentTurn: {
          type: "open_question",
          id: "collect-exercise",
          field: "multiple",
          prompt:
            "Describe your exercise, or say no exercise if you do not exercise.",
        },
      },
      latestUserMessageId: "user-live-no-exercise",
      structuredProfile: {
        ...existingReadyProfile,
        exerciseType: null,
        exerciseFrequencyPerWeek: null,
        exerciseSessionMinutes: null,
        exerciseIntensity: null,
        eatingRoutine: null,
        mealPattern: null,
        foodPreferencesComplete: false,
      },
    });

    expect(call?.name).toBe("submit_onboarding_facts");
    const toolArguments = call?.arguments as
      Record<string, unknown> | undefined;
    const facts = toolArguments?.facts as Record<string, unknown>;
    expect(facts).toMatchObject({
      exerciseType: "none",
      exerciseFrequencyPerWeek: 0,
      exerciseSessionMinutes: 0,
    });
    expect([null, "none"]).toContain(facts.exerciseIntensity);
  }, 90_000);

  it("honors the exact advertised initial-Draft prompt", async () => {
    const call = await firstToolFor("Generate my Draft Meal Plan");
    expect(call).toMatchObject({
      name: "submit_draft_proposal",
      arguments: {
        changeContext: {
          kind: "new_request",
          requiredCatalogFoodIds: [],
          excludedCatalogFoodIds: [],
        },
      },
    });
  }, 90_000);

  it("answers the exact advertised TDEE question from authoritative calculations", async () => {
    const result = await answerFor("How is my TDEE calculated?");

    expect(result.calls).toHaveLength(0);
    expect(result.text).toMatch(/TDEE|EER/i);
    expect(result.text).toMatch(/activity|PAL|low active/i);
    expect(result.text).toMatch(/2873|2,873|2875|2,875/);
    expect(result.text).not.toMatch(/in-scope question/i);
  }, 90_000);

  it.each([
    ["Find Greek yogurt and add it to my foods", "search_foods"],
    ["I weigh 75.4 kg today", "record_weight"],
  ])(
    "honors the advertised capability prompt: %s",
    async (message, expectedTool) => {
      expect(await firstToolFor(message)).toMatchObject({ name: expectedTool });
    },
    90_000,
  );

  it.each([
    ["Review my weight trend", /weight|trend|evidence/i],
    ["I want to change my nutrition goal", /reset|restart|onboarding/i],
  ])(
    "answers the advertised read-only capability: %s",
    async (message, expectedText) => {
      const result = await answerFor(message);
      expect(result.calls.map((call) => call.name)).toEqual([]);
      expect(result.text).toMatch(expectedText);
      expect(result.text).not.toMatch(/in-scope question/i);
    },
    90_000,
  );

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

  it.each([
    ["Find cream cheese and add it to my foods", "catalog_only"],
    ["i want to add cream cheese to my plan", "integrate_into_plan"],
  ])(
    "keeps a new food request in scope while another Plan Change is active: %s",
    async (message, purpose) => {
      const call = await firstToolFor(message, {
        pendingInteraction: {
          type: "draft_failure_review",
          prompt: "Keep this structure or use a different approved mix?",
          planChangeId: "plan-change-existing",
        },
        pendingPlanChange: {
          id: "plan-change-existing",
          status: "failure_review",
          requiredCatalogFoodIds: ["greek-yogurt-nonfat"],
          excludedCatalogFoodIds: [],
          unresolvedFoodNames: [],
          offeredAlternativeFoodIds: [],
          selectedAlternativeFoodId: null,
          portionRecalculation: "whole_draft",
          strategy: null,
          attemptBatch: 1,
          rejectedDraftAttempts: [],
        },
      });

      expect(call).toMatchObject({
        name: "search_foods",
        arguments: {
          purpose,
          requestedFoodPhrase: expect.stringMatching(/cream cheese/i),
        },
      });
    },
    90_000,
  );

  it("acknowledges an already-approved food without retrying an older Draft", async () => {
    const result = await answerFor("Find Greek yogurt and add it to my foods", {
      pendingInteraction: {
        type: "draft_failure_review",
        prompt: "Keep this structure or use a different approved mix?",
        planChangeId: "plan-change-existing",
      },
      pendingPlanChange: {
        id: "plan-change-existing",
        status: "failure_review",
        requiredCatalogFoodIds: [],
        excludedCatalogFoodIds: [],
        unresolvedFoodNames: [],
        offeredAlternativeFoodIds: [],
        selectedAlternativeFoodId: null,
        portionRecalculation: "whole_draft",
        strategy: null,
        attemptBatch: 1,
        rejectedDraftAttempts: [],
      },
    });

    expect(result.calls).toHaveLength(0);
    expect(result.text).toMatch(/already|approved|your foods/i);
    expect(result.text).not.toMatch(
      /draft-replacement|different mix|in-scope/i,
    );
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

  it("continues rejected Draft repair through the third authorized attempt", async () => {
    const calls: CoachToolCall[] = [];
    const planChangeId = "plan-change-live-repair";
    await runCoachAgent({
      getSystemPrompt: () =>
        buildArnoldSystemPrompt({
          onboarding: { required: false },
          approvedFoods,
          expectedMealIds: state.activePlan.plan.meals.map((meal) => meal.id),
          nutritionTargets: state.activePlan.plan.targetSnapshot,
          pendingInteraction: {
            type: "confirm_draft_food",
            foodId: "couscous-cooked",
            displayName: "Couscous",
            planChangeId,
          },
          pendingPlanChange: {
            id: planChangeId,
            status: "ready_for_draft",
            scope: "food_replacement",
            requiredCatalogFoodIds: ["couscous-cooked"],
            excludedCatalogFoodIds: ["white-rice-cooked"],
            offeredAlternativeFoodIds: [],
            selectedAlternativeFoodId: null,
            portionRecalculation: "whole_draft",
            strategy: null,
            attemptBatch: 1,
            rejectedDraftAttempts: [],
          },
          activePlan: state.activePlan,
          approvalBoundary:
            "Food, Draft, and adjustment approval requires a visible button.",
        }),
      conversation: [
        {
          role: "user",
          content: "Create the couscous replacement Draft now.",
        },
      ],
      getAllowedTools: () =>
        calls.length < 3 ? ["submit_draft_proposal"] : [],
      getRequiredTool: () =>
        calls.length < 3 ? "submit_draft_proposal" : null,
      onText: () => undefined,
      onTool: async (call) => {
        calls.push(call);
        if (calls.length < 3) {
          return {
            status: "rejected",
            code: "draft_validation_failed",
            message: "The Draft failed deterministic validation.",
            attempt: calls.length,
            attemptsRemaining: 3 - calls.length,
            issues: ["Energy and protein are above their target ranges."],
            actualTotals: { energyKcal: 3100, proteinG: 180 },
            requiredTargets: {
              energyKcal: 2875,
              energyTolerancePercent: 5,
              proteinRangeG: { min: 105, max: 150 },
            },
            repairGuidance: {
              instruction:
                "Reduce protein-dense and energy-dense portions across the complete Draft while retaining couscous.",
            },
          };
        }
        return {
          status: "needs_user_action",
          code: "draft_validation_failed",
          message: "The third Draft failed deterministic validation.",
          attempt: 3,
          attemptsRemaining: 0,
          afterThirdFailure:
            "Direct the user to the complete failure review and ask its focused question.",
        };
      },
    });

    expect(calls).toHaveLength(3);
    expect(calls.every((call) => call.name === "submit_draft_proposal")).toBe(
      true,
    );
    expect(calls[0].arguments).toMatchObject({
      changeContext: { kind: "continuation", planChangeId },
    });
    expect((calls[1].arguments as { meals: unknown }).meals).not.toEqual(
      (calls[0].arguments as { meals: unknown }).meals,
    );
  }, 120_000);

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
