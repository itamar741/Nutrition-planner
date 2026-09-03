import { expect, test, type Page } from "@playwright/test";
import { foodCatalog } from "@/data/food-catalog";
import { applyModificationToDraft } from "@/domain/plan/validation";
import {
  makeFoodGridState,
  makeReadyProfile,
  makeReadyState,
  makeValidDraft,
} from "../fixtures/turn-2";
import { installNewCloudProfile } from "./helpers/cloud-profile";

async function startWithState(
  page: Page,
  state: ReturnType<typeof makeReadyState>,
) {
  const cloud = await installNewCloudProfile(page, state);
  await page.goto("/coach/new");
  return cloud;
}

async function installTurn2Agent(
  page: Page,
  cloud: Awaited<ReturnType<typeof installNewCloudProfile>>,
  options: { delay?: number; failFirst?: boolean } = {},
) {
  let calls = 0;
  await page.route("**/api/coach/message", async (route) => {
    calls += 1;
    const body = route.request().postDataJSON() as {
      commandId: string;
      input:
        | { type: "text"; text: string }
        | { type: "interaction"; action: string; interactionId: string };
    };
    if (options.delay)
      await new Promise((resolve) => setTimeout(resolve, options.delay));
    if (options.failFirst && calls === 1) {
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          code: "validation_failure",
          message:
            "The proposed Draft did not pass the catalog and nutrition checks. Your confirmed state was preserved.",
        }),
      });
      return;
    }
    let state = cloud.current();
    let assistantText = "Done.";
    if (body.input.type === "text") {
      if (state.draft) {
        const draft = applyModificationToDraft({
          draft: state.draft,
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
        state = { ...state, draft };
        assistantText = "Raised the lunch rice portion slightly.";
      } else {
        state = { ...state, draft: makeValidDraft(body.commandId) };
        assistantText = "Your validated Draft is ready to review.";
      }
    } else if (body.input.action === "approve_draft" && state.draft) {
      state = {
        ...state,
        activePlan: {
          schemaVersion: 1,
          version: (state.activePlan?.version ?? 0) + 1,
          activatedAt: new Date().toISOString(),
          plan: state.draft.plan,
        },
        draft: null,
      };
      assistantText =
        "Approved. The exact validated Draft is now your Active Plan.";
    } else if (body.input.action === "reject_draft") {
      state = { ...state, draft: null };
      assistantText =
        "The Draft was declined. No Active Plan was changed. Tell me what you would like different.";
    }
    state = {
      ...state,
      messages: [
        ...state.messages,
        {
          id: `user-${body.commandId}`,
          role: "user",
          text:
            body.input.type === "text"
              ? body.input.text
              : body.input.action.replaceAll("_", " "),
        },
        {
          id: `assistant-${body.commandId}`,
          role: "assistant",
          text: assistantText,
        },
      ],
    };
    const profile = cloud.update(state);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, profile }),
    });
  });
}

test("Demo A completes Food Grid, Draft modification, and explicit activation", async ({
  page,
}) => {
  const cloud = await startWithState(page, makeFoodGridState());
  await installTurn2Agent(page, cloud, { delay: 2_000 });

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
  await expect(page.getByRole("status")).toContainText("Thinking");
  await expect(
    page.locator('[data-role="user"]', { hasText: "Generate my Draft" }),
  ).toHaveCount(1);

  await expect(
    page.getByText("Draft Meal Plan", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Validated", { exact: true })).toBeVisible();
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
    page.locator('[data-role="user"]', { hasText: "approve draft" }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("textbox", { name: "Message to nutrition coach" }),
  ).toBeEnabled();
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
  const cloud = await startWithState(page, makeReadyState());
  await installTurn2Agent(page, cloud, { failFirst: true });

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
  const cloud = await startWithState(page, makeReadyState());
  await installTurn2Agent(page, cloud);

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
