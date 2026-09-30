import { expect, test, type Route } from "@playwright/test";
import { createNewDemoState, existingReadyProfile } from "@/data/demo-fixtures";
import { calculateTargets } from "@/domain/nutrition/calculations";
import {
  applyOnboardingFactPatch,
  getNextTurn,
} from "@/domain/profile/onboarding";
import type { StructuredProfile } from "@/domain/profile/types";
import { demoReducer } from "@/store/demo-reducer";
import { installNewCloudProfile } from "./helpers/cloud-profile";

const profileAfterBasics: StructuredProfile = {
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

async function fulfillBasics(
  route: Route,
  cloud: Awaited<ReturnType<typeof installNewCloudProfile>>,
) {
  const requestBody = route.request().postDataJSON() as { commandId: string };
  const started = demoReducer(cloud.current(), {
    type: "start_open",
    command: {
      id: requestBody.commandId,
      message: "I am a 30 year old man, 180 cm and 80 kg.",
    },
  });
  const state = demoReducer(started, {
    type: "complete_open",
    commandId: requestBody.commandId,
    profile: profileAfterBasics,
    activeTurn: getNextTurn(profileAfterBasics),
    targets: calculateTargets(profileAfterBasics),
    acknowledgement: "I captured those four details.",
  });
  const profile = cloud.update(state);
  const events = [
    { type: "status", value: "thinking" },
    { type: "text_delta", value: "I captured those four details." },
    { type: "state", profile, activities: [] },
    { type: "done", turnId: requestBody.commandId },
  ];
  await route.fulfill({
    status: 200,
    contentType: "text/event-stream",
    body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
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
  const cloud = await installNewCloudProfile(page, createNewDemoState());
  await page.route("**/api/coach/message", (route) =>
    fulfillBasics(route, cloud),
  );
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

test("no exercise completes the exercise step and asks about eating routine", async ({
  page,
}) => {
  const profile: StructuredProfile = {
    ...profileAfterBasics,
    goal: "maintenance",
    dailyRoutine: "mostly_seated",
  };
  const cloud = await installNewCloudProfile(page, {
    ...createNewDemoState(),
    profile,
    activeTurn: getNextTurn(profile),
  });
  await page.route("**/api/coach/message", async (route) => {
    const requestBody = route.request().postDataJSON() as {
      commandId: string;
    };
    const started = demoReducer(cloud.current(), {
      type: "start_open",
      command: { id: requestBody.commandId, message: "no exercise" },
    });
    const nextProfile = applyOnboardingFactPatch(started.profile, {
      exerciseType: "none",
    });
    const activeTurn = getNextTurn(nextProfile);
    const state = demoReducer(started, {
      type: "complete_open",
      commandId: requestBody.commandId,
      profile: nextProfile,
      activeTurn,
      targets: calculateTargets(nextProfile),
      acknowledgement: "Got it — no exercise.",
    });
    const next = cloud.update(state);
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
        { type: "status", value: "thinking" },
        { type: "text_delta", value: "Got it — no exercise." },
        { type: "state", profile: next, activities: [] },
        { type: "done", turnId: requestBody.commandId },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join(""),
    });
  });
  await page.goto("/coach/new");

  await page
    .getByRole("textbox", { name: "Message to nutrition coach" })
    .fill("no exercise");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Got it — no exercise.")).toBeVisible();
  await expect(
    page.getByText(/Walk me through when you normally eat/),
  ).toBeVisible();
  await expect(page.getByText(/Describe your exercise/)).toHaveCount(0);
});

test("UI-05/UI-06 preserves the answer, locks controls, and shows slow feedback", async ({
  page,
}) => {
  const cloud = await installNewCloudProfile(page, createNewDemoState());
  await page.route("**/api/coach/message", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    await fulfillBasics(route, cloud);
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
  await expect(page.getByRole("status")).toContainText("Thinking");
  await expect(page.getByLabel("Quick replies")).toBeVisible();
});

test("UI-09 retry preserves state and does not duplicate the submitted action", async ({
  page,
}) => {
  const cloud = await installNewCloudProfile(page, createNewDemoState());
  let calls = 0;
  await page.route("**/api/coach/message", async (route) => {
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
    await fulfillBasics(route, cloud);
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
  await expect(
    page.getByRole("article", { name: "How your nutrition plan works" }),
  ).toBeVisible();
  await expect(
    page.getByRole("article", {
      name: "Why your Active Plan stays or changes",
    }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Profiles/ })).toBeVisible();
});

test("completed Fresh targets reveal the personal calculation before a plan exists", async ({
  page,
}) => {
  const profile = { ...existingReadyProfile, goal: "muscle_gain" as const };
  const state = {
    ...createNewDemoState(),
    profile,
    targets: calculateTargets(profile),
    activeTurn: getNextTurn(profile),
  };
  await installNewCloudProfile(page, state);
  await page.goto("/coach/new");

  const explanation = page.getByRole("article", {
    name: "How your nutrition plan works",
  });
  await expect(explanation).toBeVisible();
  await expect(explanation).toContainText("3,250 kcal");
  await explanation.getByText("Estimated daily energy needs").click();
  await expect(explanation).toContainText("2945.77 kcal/day");
  await expect(
    explanation.getByRole("link", { name: /Energy, 2023/ }),
  ).toHaveAttribute("href", "https://www.ncbi.nlm.nih.gov/books/NBK591034/");
});
