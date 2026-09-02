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
    provider: "Fuder",
    url: "https://www.fuder.co.il/foods/basmati-rice/",
    retrievedAt: "2026-09-02T08:00:00.000Z",
    verification: "fuder_verified",
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

test("Turn 4 selects, rejects, corrects, and approves a bounded source food", async ({
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
            title: "Cooked basmati rice",
            description: "Fuder food record · per 100 g",
            sourceUrl:
              runtimeFood.source.provider === "Fuder"
                ? runtimeFood.source.url
                : "",
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
          sourceLabel: "Fuder verified",
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
  const assistant = page.getByRole("region", { name: "Add a catalog food" });
  const input = assistant.getByRole("textbox", { name: "Food to add" });
  await input.fill("cooked basmati rice");
  await assistant.getByRole("button", { name: "Check and search" }).click();
  await assistant.getByRole("button", { name: /Cooked basmati rice/ }).click();

  await expect(assistant.getByText("Fuder verified")).toBeVisible();
  await expect(
    assistant.getByRole("heading", { name: "Basmati rice" }),
  ).toBeVisible();
  await expect(assistant.getByText("130 kcal")).toBeVisible();
  await expect(assistant.getByText("Unknown g")).toBeVisible();
  await expect(
    assistant.getByRole("link", { name: "View Fuder source" }),
  ).toHaveAttribute(
    "href",
    runtimeFood.source.provider === "Fuder" ? runtimeFood.source.url : "",
  );

  await assistant.getByRole("button", { name: "Reject" }).click();
  await expect(
    assistant.getByText("Tell me what was wrong and refine", { exact: false }),
  ).toBeVisible();

  await input.fill("cooked basmati rice, plain");
  await assistant.getByRole("button", { name: "Check and search" }).click();
  await assistant.getByRole("button", { name: /Cooked basmati rice/ }).click();
  await assistant.getByRole("button", { name: "Approve" }).click();

  await expect(
    assistant.getByText("Basmati rice is now available."),
  ).toBeVisible();
  await expect(page.getByText("1 approved foods")).toBeVisible();
});

test("Turn 4 offers AI estimation only after an explicit source failure", async ({
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
        message: "Fuder could not return a safe candidate.",
        lookupId,
        offerAiEstimate: true,
      }),
    });
  });

  await page.goto("/coach/new");
  const assistant = page.getByRole("region", { name: "Add a catalog food" });
  await assistant
    .getByRole("textbox", { name: "Food to add" })
    .fill("new food");
  await assistant.getByRole("button", { name: "Check and search" }).click();

  await expect(
    assistant.getByRole("button", { name: "Use an AI estimate" }),
  ).toBeVisible();
  await expect(
    assistant.getByText("Fuder could not return", { exact: false }),
  ).toBeVisible();
});
