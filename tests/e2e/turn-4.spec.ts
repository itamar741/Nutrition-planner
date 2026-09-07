import { expect, test, type Page } from "@playwright/test";
import type { CatalogFood } from "@/domain/catalog/types";
import type { FoodSearchCandidate } from "@/domain/catalog/runtime";
import { installNewCloudProfile } from "./helpers/cloud-profile";
import { makeReadyState } from "../fixtures/turn-2";

const candidateId = "f00d0000-0000-4000-8000-000000000001";
const lookupId = "100d0000-0000-4000-8000-000000000001";
const runtimeFood: CatalogFood = {
  schemaVersion: 1,
  id: "runtime-basmati-rice",
  displayName: "Basmati rice",
  preparation: "cooked",
  category: "carbohydrate",
  mealClassification: "neutral",
  kosherCatalogApproved: false,
  kosherReview: "not_checked",
  source: {
    provider: "USDA FoodData Central",
    fdcId: 168878,
    dataset: "SR Legacy",
    release: "2019-04-01",
    retrievedAt: "2026-09-02T08:00:00.000Z",
    energyNutrient: "Energy",
    energyNutrientId: 1008,
    verification: "detail",
  },
  nutrientsPer100g: {
    energyKcal: 130,
    proteinG: 2.7,
    carbohydrateG: 28.2,
    fatG: 0.3,
    fiberG: null,
  },
  displayPortion: { label: "1 cooked cup", grams: 160 },
  practicalGrams: { min: 80, max: 800, step: 5 },
};

const candidate: FoodSearchCandidate = {
  id: candidateId,
  fdcId: 168878,
  title: "Cooked basmati rice",
  description: "Cereal Grains and Pasta",
  dataType: "SR Legacy",
  verification: "detail",
  release: "2019-04-01",
  retrievedAt: "2026-09-02T08:00:00.000Z",
  energyNutrientId: 1008,
  nutrientsPer100g: runtimeFood.nutrientsPer100g,
  displayPortion: runtimeFood.displayPortion,
};
const fiveCandidates = Array.from({ length: 5 }, (_, index) => ({
  ...candidate,
  id: `f00d0000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  fdcId: candidate.fdcId + index,
  title: `${candidate.title} option ${index + 1}`,
}));

async function installCatalogAgent(
  page: Page,
  cloud: Awaited<ReturnType<typeof installNewCloudProfile>>,
  unavailable = false,
) {
  await page.route("**/api/coach/message", async (route) => {
    const body = route.request().postDataJSON() as {
      commandId: string;
      input:
        | { type: "text"; text: string }
        | {
            type: "interaction";
            action: string;
            interactionId: string;
            candidateId?: string;
          };
    };
    let state = cloud.current();
    let catalogFood: CatalogFood | undefined;
    if (body.input.type === "text") {
      const normalized = body.input.text.trim().toLocaleLowerCase("en-US");
      state = {
        ...state,
        agentSession: {
          ...state.agentSession,
          pendingInteraction:
            normalized === "i want to add food"
              ? {
                  id: `clarification-${body.commandId}`,
                  type: "clarification",
                  workflow: "food",
                  prompt: "Which basic food would you like to add?",
                  quickReplies: [],
                }
              : normalized === "the fifth one"
                ? {
                    id: `approval-${body.commandId}`,
                    type: "food_approval",
                    candidate: {
                      id: fiveCandidates[4].id,
                      lookupId,
                      food: {
                        ...runtimeFood,
                        displayName: fiveCandidates[4].title,
                      },
                      sourceLabel: "USDA FoodData Central verified",
                    },
                  }
                : unavailable
                  ? {
                      id: `source-${body.commandId}`,
                      type: "source_unavailable",
                      lookupId,
                      query: body.input.text,
                      failureCode: "no_results",
                    }
                  : {
                      id: `candidates-${body.commandId}`,
                      type: "food_candidates",
                      lookupId,
                      candidates: fiveCandidates,
                    },
        },
      };
    } else if (body.input.action === "select_candidate") {
      state = {
        ...state,
        agentSession: {
          ...state.agentSession,
          pendingInteraction: {
            id: `approval-${body.commandId}`,
            type: "food_approval",
            candidate: {
              id: candidateId,
              lookupId,
              food: runtimeFood,
              sourceLabel: "USDA FoodData Central verified",
            },
          },
        },
      };
    } else if (body.input.action === "reject_food") {
      state = {
        ...state,
        agentSession: {
          ...state.agentSession,
          pendingInteraction: {
            id: `clarification-${body.commandId}`,
            type: "clarification",
            workflow: "food",
            prompt: "What should I correct in the food search?",
            quickReplies: [],
          },
        },
      };
    } else if (body.input.action === "approve_food") {
      state = {
        ...state,
        profile: {
          ...state.profile,
          approvedCatalogFoodIds: [runtimeFood.id],
        },
        agentSession: {
          ...state.agentSession,
          pendingInteraction: {
            id: `draft-${body.commandId}`,
            type: "confirm_draft_food",
            foodId: runtimeFood.id,
            displayName: runtimeFood.displayName,
          },
        },
      };
      catalogFood = runtimeFood;
    }
    state = {
      ...state,
      messages: [
        ...state.messages,
        {
          id: `user-${body.commandId}`,
          role: "user",
          text:
            body.input.type === "text" ? body.input.text : body.input.action,
        },
        {
          id: `assistant-${body.commandId}`,
          role: "assistant",
          text: "The coach continued the food workflow.",
        },
      ],
    };
    const profile = cloud.update(state);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, profile, catalogFood }),
    });
  });
}

test("Turn 7 selects, rejects, corrects, and approves a bounded USDA food in chat", async ({
  page,
}) => {
  const cloud = await installNewCloudProfile(page, makeReadyState());
  await installCatalogAgent(page, cloud);
  await page.goto("/coach/new");

  const input = page.getByRole("textbox", {
    name: "Message to nutrition coach",
  });
  await input.fill("cooked basmati rice");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("button", { name: "Select this food" }).first().click();

  await expect(page.getByText("USDA FoodData Central verified")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Basmati rice" }),
  ).toBeVisible();
  await expect(page.getByText(/130 kcal/)).toBeVisible();
  await expect(page.getByText(/fiber unavailable/)).toBeVisible();

  await page.getByRole("button", { name: "Reject" }).click();
  await expect(
    page.getByText("What should I correct", { exact: false }),
  ).toBeVisible();

  await input.fill("cooked basmati rice, plain");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("button", { name: "Select this food" }).first().click();
  await page.getByRole("button", { name: "Approve food" }).click();

  await expect(
    page.getByText("1 approved foods", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create Draft" }),
  ).toBeVisible();
});

test("Turn 7 offers AI estimation only after an explicit USDA failure", async ({
  page,
}) => {
  const cloud = await installNewCloudProfile(page, makeReadyState());
  await installCatalogAgent(page, cloud, true);
  await page.goto("/coach/new");

  await page
    .getByRole("textbox", { name: "Message to nutrition coach" })
    .fill("new food");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(
    page.getByRole("button", { name: "Use an AI estimate" }),
  ).toBeVisible();
  await expect(
    page.getByText("No safe verified candidate was found"),
  ).toBeVisible();
  await page.getByText("Technical details").click();
  await expect(page.getByText(/code: no_results/)).toBeVisible();
});

test("Turn 8 persists a missing-name clarification and searches the named follow-up", async ({
  page,
}) => {
  const cloud = await installNewCloudProfile(page, makeReadyState());
  await installCatalogAgent(page, cloud);
  await page.goto("/coach/new");

  const input = page.getByRole("textbox", {
    name: "Message to nutrition coach",
  });
  await input.fill("I want to add food");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(
    page.getByText("Which basic food would you like to add?"),
  ).toBeVisible();

  await page.reload();
  await expect(
    page.getByText("Which basic food would you like to add?"),
  ).toBeVisible();
  await input.fill("cottage cheese");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByLabel("USDA food candidates")).toBeVisible();
});

test("Turn 7 can select the fifth displayed candidate by text but cannot approve it", async ({
  page,
}) => {
  const cloud = await installNewCloudProfile(page, makeReadyState());
  await installCatalogAgent(page, cloud);
  await page.goto("/coach/new");

  const input = page.getByRole("textbox", {
    name: "Message to nutrition coach",
  });
  await input.fill("cooked rice");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(
    page.getByRole("button", { name: "Select this food" }),
  ).toHaveCount(5);

  await input.fill("the fifth one");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("heading", { name: /option 5/ })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve food" }),
  ).toBeVisible();
  expect(cloud.current().profile.approvedCatalogFoodIds).not.toContain(
    runtimeFood.id,
  );
});
