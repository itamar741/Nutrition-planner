import { expect, test } from "@playwright/test";
import { createNewDemoState } from "@/data/demo-fixtures";
import type { CatalogFood } from "@/domain/catalog/types";
import { installNewCloudProfile } from "./helpers/cloud-profile";

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

test("Turn 5 selects, rejects, corrects, and approves a bounded USDA food", async ({
  page,
}) => {
  const initial = createNewDemoState();
  await installNewCloudProfile(page, initial);
  await page.route("**/api/coach/catalog/lookup", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        outcome: "candidates",
        lookupId,
        message: "Choose the exact food you meant.",
        candidates: [
          {
            id: candidateId,
            fdcId: 168878,
            title: "Cooked basmati rice",
            description: "SR Legacy · Cereal Grains and Pasta",
            dataType: "SR Legacy",
            verification: "detail",
            release: "2019-04-01",
            retrievedAt: "2026-09-02T08:00:00.000Z",
            energyNutrientId: 1008,
            nutrientsPer100g: runtimeFood.nutrientsPer100g,
            displayPortion: runtimeFood.displayPortion,
          },
        ],
      }),
    });
  });
  await page.route("**/api/coach/catalog/candidate", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        candidate: {
          id: candidateId,
          lookupId,
          food: runtimeFood,
          sourceLabel: "USDA FoodData Central verified",
        },
      }),
    });
  });
  await page.route("**/api/coach/catalog/reject", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
  await page.route("**/api/coach/catalog/approve", async (route) => {
    const state = createNewDemoState();
    state.profile.approvedCatalogFoodIds = [runtimeFood.id];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        food: runtimeFood,
        profile: { profileId: "new", version: 2, state },
        message: "Basmati rice is now available.",
      }),
    });
  });

  await page.goto("/coach/new");
  await page.getByRole("button", { name: "Add a missing food" }).click();
  const assistant = page.getByRole("region", {
    name: "Catalog food conversation",
  });
  const input = assistant.getByRole("textbox", { name: "Food to add" });
  await input.fill("cooked basmati rice");
  await assistant.getByRole("button", { name: "Send to coach" }).click();
  await assistant.getByRole("button", { name: /Cooked basmati rice/ }).click();

  await expect(
    assistant.getByText("USDA FoodData Central verified"),
  ).toBeVisible();
  await expect(
    assistant.getByRole("heading", { name: "Basmati rice" }),
  ).toBeVisible();
  await expect(assistant.getByText("130 kcal")).toBeVisible();
  await expect(assistant.getByText("Unknown g")).toBeVisible();
  await expect(
    assistant.getByRole("link", { name: "View USDA source" }),
  ).toHaveAttribute(
    "href",
    "https://fdc.nal.usda.gov/food-details/168878/nutrients",
  );

  await assistant.getByRole("button", { name: "Reject" }).click();
  await expect(
    assistant.getByText("Tell me what was wrong and refine", { exact: false }),
  ).toBeVisible();

  await input.fill("cooked basmati rice, plain");
  await assistant.getByRole("button", { name: "Send to coach" }).click();
  await assistant.getByRole("button", { name: /Cooked basmati rice/ }).click();
  await assistant.getByRole("button", { name: "Approve" }).click();

  await expect(
    assistant.getByText("Basmati rice is now available."),
  ).toBeVisible();
  await expect(page.getByText("1 approved foods")).toBeVisible();
});

test("Turn 5 offers AI estimation only after an explicit USDA failure", async ({
  page,
}) => {
  await installNewCloudProfile(page, createNewDemoState());
  await page.route("**/api/coach/catalog/lookup", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        code: "source_unavailable",
        message: "USDA FoodData Central could not return a safe candidate.",
        lookupId,
        offerAiEstimate: true,
      }),
    });
  });

  await page.goto("/coach/new");
  await page.getByRole("button", { name: "Add a missing food" }).click();
  const assistant = page.getByRole("region", {
    name: "Catalog food conversation",
  });
  await assistant
    .getByRole("textbox", { name: "Food to add" })
    .fill("new food");
  await assistant.getByRole("button", { name: "Send to coach" }).click();

  await expect(
    assistant.getByRole("button", { name: "Use an AI estimate" }),
  ).toBeVisible();
  await expect(
    assistant.getByText("USDA FoodData Central could not return", {
      exact: false,
    }),
  ).toBeVisible();
});
