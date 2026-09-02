import { expect, test, type Route } from "@playwright/test";
import { generateAdjustmentDraft } from "@/ai/plan";
import {
  createExistingActivePlan,
  existingReadyProfile,
} from "@/data/demo-fixtures";

async function fulfillAdjustment(route: Route) {
  const request = route.request().postDataJSON() as {
    commandId: string;
    direction: "increase" | "decrease";
    adjustmentKcal: number;
    feedback?: string;
  };
  const draft = await generateAdjustmentDraft(
    {
      commandId: request.commandId,
      feedback: request.feedback,
      profile: existingReadyProfile,
      activePlan: createExistingActivePlan(),
      direction: request.direction,
      adjustmentKcal: request.adjustmentKcal,
    },
    async () => "not json",
  );
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, commandId: request.commandId, draft }),
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
});

test("B-01 reviews, declines, revises, and approves an adjustment in chat", async ({
  page,
}) => {
  const feedbackRequests: Array<string | undefined> = [];
  await page.route("**/api/coach/adjustment", async (route) => {
    const request = route.request().postDataJSON() as { feedback?: string };
    feedbackRequests.push(request.feedback);
    await fulfillAdjustment(route);
  });
  await page.goto("/coach/existing");

  await page.getByRole("button", { name: "Generate AI proposal" }).click();
  const proposal = page
    .getByText("AI adjustment proposal · Draft")
    .locator("..");
  await expect(proposal).toContainText("Exact proposed changes");
  await expect(
    proposal.getByText("View full proposed daily plan"),
  ).toBeVisible();

  await proposal.getByRole("button", { name: "Decline" }).click();
  await expect(
    page.getByText("What did you not like about the proposal?", {
      exact: false,
    }),
  ).toBeVisible();

  const feedback = page.getByRole("textbox", { name: "Adjustment feedback" });
  await feedback.fill("I prefer more food in the evening.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("AI adjustment proposal · Draft")).toBeVisible();
  expect(feedbackRequests).toEqual([
    undefined,
    "I prefer more food in the evening.",
  ]);

  await page.getByRole("button", { name: "Approve proposal" }).click();
  await expect(page.getByText("Active Plan is now version 2")).toBeVisible();
  await expect(page.getByText("Version 2; changes require")).toBeVisible();
});

test("B-02 caps editable and rendered weights at two decimal places", async ({
  page,
}) => {
  await page.goto("/coach/existing");
  const chartPoints = page.locator('circle[role="button"]');
  await chartPoints.last().click();

  const replacement = page.getByRole("spinbutton", {
    name: "Replacement weight in kilograms",
  });
  await expect(replacement).toHaveValue(/^\d+(?:\.\d{1,2})?$/);
  await replacement.fill("81.09");
  await page.getByRole("button", { name: "Save replacement" }).click();
  await expect(page.getByText(/Updated .* to 81\.09 kg/)).toBeVisible();
});
