import { expect, test } from "@playwright/test";
import { makeReadyState, makeValidDraft } from "../fixtures/turn-2";
import { installNewCloudProfile } from "./helpers/cloud-profile";
import { createExistingDemoState } from "@/data/demo-fixtures";

test("Turn 8 reloads persisted user and partial Arnold output without replaying completed activity", async ({
  page,
}) => {
  const cloud = await installNewCloudProfile(page, makeReadyState());
  await page.route("**/api/coach/message", async (route) => {
    const request = route.request().postDataJSON() as {
      commandId: string;
      input:
        | { type: "text"; text: string }
        | { type: "interaction"; action: string; interactionId: string };
    };
    const userText =
      request.input.type === "text"
        ? request.input.text
        : request.input.action.replaceAll("_", " ");
    cloud.update({
      ...cloud.current(),
      messages: [
        ...cloud.current().messages,
        {
          id: `user-${request.commandId}`,
          role: "user",
          text: userText,
        },
        {
          id: `assistant-${request.commandId}-1`,
          role: "assistant",
          text: "I started checking your approved foods.",
        },
      ],
    });
    cloud.setActivities([
      {
        id: `activity-${request.commandId}-1`,
        turnId: request.commandId,
        kind: "checking_foods",
        label: "Checking your foods and plans",
        status: "completed",
        createdAt: "2026-09-05T10:00:00.000Z",
      },
      {
        id: `activity-${request.commandId}-failure`,
        turnId: request.commandId,
        kind: "failure",
        label: "This turn failed safely; confirmed state was preserved",
        status: "failed",
        createdAt: "2026-09-05T10:00:01.000Z",
      },
    ]);
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
        `data: ${JSON.stringify({ type: "text_delta", value: "I started checking your approved foods." })}\n\n`,
        `data: ${JSON.stringify({
          type: "error",
          message:
            "The coach could not complete this turn. Your confirmed state was preserved.",
          diagnostics: {
            stage: "agent",
            failureCode: "stream_disconnected",
            turnId: request.commandId,
          },
        })}\n\n`,
      ].join(""),
    });
  });
  await page.goto("/coach/new");

  await page.getByRole("button", { name: "Generate Draft" }).click();
  await expect(
    page.getByRole("region", { name: "Coach conversation" }).getByRole("alert"),
  ).toContainText("confirmed state was preserved");
  await expect(
    page.locator('[data-role="user"]', { hasText: "generate draft" }),
  ).toHaveCount(1);
  await expect(
    page.getByText("I started checking your approved foods.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Checking your foods and plans"),
  ).not.toBeVisible();

  await page.reload();
  await expect(
    page.locator('[data-role="user"]', { hasText: "generate draft" }),
  ).toHaveCount(1);
  await expect(
    page.getByText("I started checking your approved foods.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("This turn failed safely; confirmed state was preserved"),
  ).not.toBeVisible();
});

test("Turn 8 typed approval leaves the Draft pending for its visible button", async ({
  page,
}) => {
  const initial = {
    ...makeReadyState(),
    draft: makeValidDraft("typed-approval"),
  };
  const cloud = await installNewCloudProfile(page, initial);
  await page.route("**/api/coach/message", async (route) => {
    const request = route.request().postDataJSON() as {
      commandId: string;
      input: { type: "text"; text: string };
    };
    const profile = cloud.update({
      ...cloud.current(),
      messages: [
        ...cloud.current().messages,
        {
          id: `user-${request.commandId}`,
          role: "user",
          text: request.input.text,
        },
        {
          id: `assistant-${request.commandId}-1`,
          role: "assistant",
          text: "Please use the Approve & activate button on the Draft card.",
        },
      ],
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, profile }),
    });
  });
  await page.goto("/coach/new");

  const input = page.getByRole("textbox", {
    name: "Message to nutrition coach",
  });
  await input.fill("approve it");
  await page.getByRole("button", { name: "Request change" }).click();

  await expect(
    page.getByText("Draft Meal Plan", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Active Plan", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Approve & activate" }),
  ).toBeVisible();
  await expect(
    page.getByText(/Please use the Approve & activate button/),
  ).toBeVisible();
});

test("Turn 8 keeps an ordinary Existing Draft across reload and activates it only by button", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("arnold-trend-review:existing", "started");
  });
  let state = createExistingDemoState(new Date("2026-09-05T00:00:00.000Z"));
  state = {
    ...state,
    agentSession: {
      ...state.agentSession,
      pendingInteraction: {
        id: "existing-food-continuation",
        type: "confirm_draft_food",
        foodId: "white-rice-cooked",
        displayName: "White rice",
      },
    },
  };
  let version = 1;
  await page.route("**/api/demo/state/existing", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        profile: { profileId: "existing", version, state },
        catalog: [],
      }),
    });
  });
  await page.route("**/api/coach/message", async (route) => {
    const request = route.request().postDataJSON() as {
      commandId: string;
      input:
        | { type: "text"; text: string }
        | { type: "interaction"; action: string; interactionId: string };
    };
    let assistant = "Your validated Draft is ready to review.";
    if (
      request.input.type === "interaction" &&
      request.input.action === "confirm_draft_food"
    ) {
      state = {
        ...state,
        draft: {
          schemaVersion: 1,
          id: `draft-${request.commandId}`,
          basePlanVersion: state.activePlan.version,
          reason: "modification",
          summary: "A new arrangement at your current nutrition targets.",
          plan: {
            ...state.activePlan.plan,
            id: `plan-${request.commandId}`,
            version: state.activePlan.version + 1,
            meals: state.activePlan.plan.meals.map((meal) => ({
              ...meal,
              items:
                meal.id === "snack"
                  ? [
                      ...meal.items,
                      {
                        id: "tofu-integration",
                        catalogFoodId: "tofu-firm",
                        grams: 60,
                        alternatives: [],
                      },
                    ]
                  : meal.items,
            })),
          },
        },
        agentSession: { ...state.agentSession, pendingInteraction: null },
      };
    } else if (request.input.type === "interaction") {
      const draft = state.draft;
      if (
        request.input.action !== "approve_draft" ||
        !draft ||
        draft.id !== request.input.interactionId
      ) {
        return route.fulfill({ status: 409, body: "stale interaction" });
      }
      state = {
        ...state,
        activePlan: {
          schemaVersion: 1,
          version: state.activePlan.version + 1,
          activatedAt: new Date().toISOString(),
          maintenanceReferenceWeightKg:
            state.activePlan.maintenanceReferenceWeightKg,
          plan: draft.plan,
        },
        draft: null,
      };
      assistant = "Approved. Your new plan is now Active.";
    }
    state = {
      ...state,
      messages: [
        ...state.messages,
        {
          id: `user-${request.commandId}`,
          role: "user",
          text:
            request.input.type === "text"
              ? request.input.text
              : request.input.action,
        },
        {
          id: `assistant-${request.commandId}`,
          role: "assistant",
          text: assistant,
        },
      ],
    };
    version += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        profile: { profileId: "existing", version, state },
      }),
    });
  });

  await page.goto("/coach/existing");
  await page.getByRole("button", { name: "Create Draft" }).click();

  await expect(
    page.getByText("Draft Meal Plan", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Changes from active plan" }),
  ).toContainText("Added Firm tofu: 0 g → 60 g");
  await expect(page.getByText("Version 1; changes require")).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Draft Meal Plan", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Version 1; changes require")).toBeVisible();

  await page.getByRole("button", { name: "Approve & activate" }).click();
  await expect(page.getByText("Draft Meal Plan", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText("Version 2; changes require")).toBeVisible();
});
