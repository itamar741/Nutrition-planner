import { expect, test } from "@playwright/test";
import { makeReadyState, makeValidDraft } from "../fixtures/turn-2";
import { installNewCloudProfile } from "./helpers/cloud-profile";

test("Turn 8 reloads persisted user, partial Arnold output, failure, and activity", async ({
  page,
}) => {
  const cloud = await installNewCloudProfile(page, makeReadyState());
  await page.route("**/api/coach/message", async (route) => {
    const request = route.request().postDataJSON() as {
      commandId: string;
      input: { type: "text"; text: string };
    };
    cloud.update({
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
    page.locator('[data-role="user"]', { hasText: "Generate my Draft" }),
  ).toHaveCount(1);
  await expect(
    page.getByText("I started checking your approved foods.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Checking your foods and plans")).toBeVisible();

  await page.reload();
  await expect(
    page.locator('[data-role="user"]', { hasText: "Generate my Draft" }),
  ).toHaveCount(1);
  await expect(
    page.getByText("I started checking your approved foods.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("This turn failed safely; confirmed state was preserved"),
  ).toBeVisible();
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
