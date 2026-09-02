import { expect, test, type Page, type Route } from "@playwright/test";
import { foodCatalog } from "@/data/food-catalog";
import { applyModificationToDraft } from "@/domain/plan/validation";
import type { DraftProposal } from "@/domain/plan/types";
import {
  makeFoodGridState,
  makeReadyProfile,
  makeReadyState,
  makeValidDraft,
} from "../fixtures/turn-2";

const storageKey = "nutrition-coach:new:v2";

async function startWithState(page: Page, state: unknown) {
  await page.addInitScript(
    ({ key, value }) => window.localStorage.setItem(key, value),
    { key: storageKey, value: JSON.stringify(state) },
  );
  await page.goto("/coach/new");
}

async function fulfillDraft(route: Route, delay = 0) {
  const body = route.request().postDataJSON() as { commandId: string };
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      commandId: body.commandId,
      draft: makeValidDraft(body.commandId),
    }),
  });
}

test("Demo A completes Food Grid, Draft modification, and explicit activation", async ({
  page,
}) => {
  await page.route("**/api/coach/draft", (route) => fulfillDraft(route, 2_000));
  await page.route("**/api/coach/draft-modification", async (route) => {
    const body = route.request().postDataJSON() as {
      commandId: string;
      draft: DraftProposal;
    };
    const draft = applyModificationToDraft({
      draft: body.draft,
      operation: {
        type: "change_portion",
        mealId: "lunch",
        itemId: "lunch-item-2",
        grams: 355,
        explanation: "Raised the lunch rice portion slightly.",
      },
      profile: makeReadyProfile(),
      proposalId: `draft-${body.commandId}`,
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        commandId: body.commandId,
        outcome: "modified",
        draft,
        message: "Raised the lunch rice portion slightly.",
      }),
    });
  });
  await startWithState(page, makeFoodGridState());

  const grid = page.getByRole("region", { name: "Food preferences" });
  await expect(grid).toBeVisible();
  await page.screenshot({
    path: "docs/verification-results/turn-2-food-grid.png",
    fullPage: true,
  });
  await expect(
    page.getByRole("textbox", { name: "Message to nutrition coach" }),
  ).toBeDisabled();
  await expect(
    grid.getByRole("button", { name: "Save food preferences" }),
  ).toBeDisabled();

  for (const food of foodCatalog) {
    await grid
      .getByRole("button", {
        name: new RegExp(
          `^${food.displayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`,
          "i",
        ),
      })
      .click();
  }
  await expect(grid.getByText("All five groups are covered.")).toBeVisible();
  await grid.getByRole("button", { name: "Save food preferences" }).dblclick();

  await expect(page.getByText("100% complete")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Generate Draft" }),
  ).toBeVisible();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Generate Draft" }).click();
  await expect(page.getByRole("status")).toContainText("Still composing");
  await expect(
    page.locator('[data-role="user"]', { hasText: "Generate my Draft" }),
  ).toHaveCount(1);

  await expect(
    page.getByText("Draft Meal Plan", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Validated")).toBeVisible();
  await expect(page.getByText("Active Plan", { exact: true })).toHaveCount(0);
  await page.screenshot({
    path: "docs/verification-results/turn-2-draft.png",
    fullPage: true,
  });

  const modificationInput = page.getByRole("textbox", {
    name: "Message to nutrition coach",
  });
  await expect(modificationInput).toBeEnabled();
  await modificationInput.fill("Make the lunch rice a little larger");
  await page.getByRole("button", { name: "Request change" }).click();
  await expect(page.getByText("355 g")).toBeVisible();
  await expect(
    page.getByText("Draft Meal Plan", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Approve & activate" }).dblclick();
  await expect(page.getByText("Active Plan", { exact: true })).toBeVisible();
  await expect(page.getByText("Draft Meal Plan", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.locator('[data-role="user"]', { hasText: "Approve and activate" }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("textbox", { name: "Message to nutrition coach" }),
  ).toBeDisabled();
  await page.screenshot({
    path: "docs/verification-results/turn-2-active.png",
    fullPage: true,
  });
});

test("Food Grid remains usable at the mobile review viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startWithState(page, makeFoodGridState());
  await expect(
    page.getByRole("region", { name: "Food preferences" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Message to nutrition coach" }),
  ).toBeDisabled();
  await page.screenshot({
    path: "docs/verification-results/turn-2-food-grid-mobile.png",
    fullPage: true,
  });
});

test("Draft failure and retry preserve state and avoid duplicate actions", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/coach/draft", async (route) => {
    calls += 1;
    if (calls === 1) {
      const body = route.request().postDataJSON() as { commandId: string };
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          commandId: body.commandId,
          code: "validation_failure",
          message:
            "The proposed Draft did not pass the catalog and nutrition checks. Your confirmed state was preserved.",
        }),
      });
      return;
    }
    await fulfillDraft(route);
  });
  await startWithState(page, makeReadyState());

  await page.getByRole("button", { name: "Generate Draft" }).click();
  await expect(
    page.getByRole("region", { name: "Coach conversation" }).getByRole("alert"),
  ).toContainText("Your confirmed state was preserved");
  await expect(page.getByText("100% complete")).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();

  await expect(
    page.getByText("Draft Meal Plan", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('[data-role="user"]', { hasText: "Generate my Draft" }),
  ).toHaveCount(1);
});

test("declining a Draft opens feedback for a revised proposal", async ({
  page,
}) => {
  await page.route("**/api/coach/draft", (route) => fulfillDraft(route));
  await startWithState(page, makeReadyState());

  await page.getByRole("button", { name: "Generate Draft" }).click();
  await expect(
    page.getByText("Draft Meal Plan", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Decline Draft" }).click();

  await expect(page.getByText("Draft Meal Plan", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText("Active Plan", { exact: true })).toHaveCount(0);
  await expect(page.getByText("No Active Plan was changed.")).toBeVisible();

  const feedback = page.getByRole("textbox", {
    name: "Message to nutrition coach",
  });
  await expect(feedback).toBeEnabled();
  await feedback.fill("I would like a larger lunch portion.");
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Generate revised Draft" }).click();
  await expect(
    page.getByText("Draft Meal Plan", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('[data-role="user"]', {
      hasText: "I would like a larger lunch portion.",
    }),
  ).toHaveCount(1);
});
