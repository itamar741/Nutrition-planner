import { expect, test, type Route } from "@playwright/test";

const profileAfterBasics = {
  schemaVersion: 1,
  age: 30,
  equationSex: "male",
  heightCm: 180,
  currentWeightKg: 80,
  goal: null,
  dailyRoutine: null,
  exerciseType: null,
  exerciseFrequencyPerWeek: null,
  exerciseSessionMinutes: null,
  exerciseIntensity: null,
  eatingRoutine: null,
  mealPattern: null,
  foodPreferencesComplete: false,
  approvedCatalogFoodIds: [],
};

async function fulfillBasics(route: Route) {
  const requestBody = route.request().postDataJSON() as { commandId: string };
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      commandId: requestBody.commandId,
      profile: profileAfterBasics,
      activeTurn: {
        type: "closed_question",
        id: "choose-goal",
        field: "goal",
        prompt: "Which nutrition goal should this fixed plan support?",
        options: [
          {
            id: "goal-fat-loss",
            label: "Fat Loss",
            patch: { goal: "fat_loss" },
          },
          {
            id: "goal-maintenance",
            label: "Maintenance",
            patch: { goal: "maintenance" },
          },
          {
            id: "goal-muscle-gain",
            label: "Muscle Gain",
            patch: { goal: "muscle_gain" },
          },
        ],
      },
      targets: null,
      acknowledgement: "I captured those four details.",
    }),
  });
}

test("SC-01 entry exposes exactly the two demo profiles", async ({ page }) => {
  await page.goto("/");

  const profileRegion = page.getByRole("region", {
    name: "Choose a demo profile",
  });
  await expect(profileRegion.getByRole("link")).toHaveCount(2);
  await expect(
    profileRegion.getByRole("link", { name: /New Demo Profile/ }),
  ).toBeVisible();
  await expect(
    profileRegion.getByRole("link", { name: /Existing Demo Profile/ }),
  ).toBeVisible();
  await expect(
    page.getByText("No sign-up. No additional profiles."),
  ).toBeVisible();
});

test("UI-01/UI-02/AI-01 moves from one open answer to locked quick replies", async ({
  page,
}) => {
  await page.route("**/api/coach/onboarding", fulfillBasics);
  await page.goto("/coach/new");

  const input = page.getByRole("textbox", {
    name: "Message to nutrition coach",
  });
  await expect(input).toBeEnabled();
  await expect(page.getByLabel("Quick replies")).toHaveCount(0);

  await input.fill("I am a 30 year old man, 180 cm and 80 kg.");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Body basics").locator("..")).toHaveClass(
    /checkItemComplete/,
  );
  await expect(page.getByLabel("Quick replies")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Message to nutrition coach" }),
  ).toBeDisabled();

  await page.getByRole("button", { name: "Maintenance" }).dblclick();
  await expect(
    page.locator('[data-role="user"]', { hasText: "Maintenance" }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Mostly seated" }),
  ).toBeVisible();
});

test("UI-05/UI-06 preserves the answer, locks controls, and shows slow feedback", async ({
  page,
}) => {
  await page.route("**/api/coach/onboarding", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_450));
    await fulfillBasics(route);
  });
  await page.goto("/coach/new");

  const input = page.getByRole("textbox", {
    name: "Message to nutrition coach",
  });
  await input.fill("I am a 30 year old man, 180 cm and 80 kg.");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(input).toBeDisabled();
  await expect(page.locator('[data-role="user"]')).toContainText(
    "I am a 30 year old man",
  );
  await expect(page.getByRole("status")).toContainText(
    "Still reviewing your details",
  );
  await expect(page.getByLabel("Quick replies")).toBeVisible();
});

test("UI-09 retry preserves state and does not duplicate the submitted action", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/coach/onboarding", async (route) => {
    calls += 1;
    if (calls === 1) {
      const requestBody = route.request().postDataJSON() as {
        commandId: string;
      };
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          commandId: requestBody.commandId,
          code: "model_failure",
          message:
            "The coach returned an invalid response. Your details were not changed.",
        }),
      });
      return;
    }
    await fulfillBasics(route);
  });
  await page.goto("/coach/new");

  await page
    .getByRole("textbox", { name: "Message to nutrition coach" })
    .fill("I am a 30 year old man, 180 cm and 80 kg.");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "The coach returned an invalid response" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByLabel("Quick replies")).toBeVisible();
  await expect(
    page.locator('[data-role="user"]', { hasText: "I am a 30 year old man" }),
  ).toHaveCount(1);
});

test("the Existing Demo Profile stays a fixed prepared foundation in Turn 1", async ({
  page,
}) => {
  await page.goto("/coach/existing");

  await expect(page.getByText("Existing Demo Profile")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Maintenance" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Low active" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Profiles/ })).toBeVisible();
});
