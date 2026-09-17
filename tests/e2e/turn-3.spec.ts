import { expect, test } from "@playwright/test";
import { createExistingDemoState } from "@/data/demo-fixtures";

test.beforeEach(async ({ request }) => {
  const current = (await (
    await request.get("/api/demo/state/existing")
  ).json()) as {
    profile: { version: number };
  };
  await request.post("/api/demo/state/existing", {
    data: {
      expectedVersion: current.profile.version,
      commandId: `e2e-reset-${crypto.randomUUID()}`,
      action: "reset",
    },
  });
});

test("Enter sends the Existing coach message", async ({ page }) => {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("arnold-trend-review:existing", "started");
  });
  let requests = 0;
  await page.route("**/api/coach/message", async (route) => {
    requests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        profile: {
          profileId: "existing",
          version: 2,
          state: createExistingDemoState(),
        },
      }),
    });
  });
  await page.goto("/coach/existing");

  const input = page.getByRole("textbox", {
    name: "Message to nutrition coach",
  });
  await input.fill("Tell me about my plan");
  await input.press("Enter");
  await expect.poll(() => requests).toBe(1);
  await expect(input).toHaveValue("");
});

test("a historical weight returned by Arnold redraws the chart immediately", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("arnold-trend-review:existing", "started");
  });
  const state = createExistingDemoState();
  const target = state.measurements.at(-2)!;
  const replacementWeight = 76.33;
  await page.route("**/api/coach/message", async (route) => {
    const nextState = {
      ...state,
      measurements: state.measurements.map((measurement) =>
        measurement.date === target.date
          ? { ...measurement, weightKg: replacementWeight }
          : measurement,
      ),
      messages: [
        ...state.messages,
        {
          id: "historical-weight-user",
          role: "user" as const,
          text: `${target.date} weight is ${replacementWeight}`,
        },
        {
          id: "historical-weight-assistant",
          role: "assistant" as const,
          text: `Updated ${target.date} to ${replacementWeight} kg.`,
        },
      ],
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        profile: { profileId: "existing", version: 2, state: nextState },
      }),
    });
  });
  await page.goto("/coach/existing");

  const input = page.getByRole("textbox", {
    name: "Message to nutrition coach",
  });
  await input.fill(`${target.date} weight is ${replacementWeight}`);
  await input.press("Enter");

  await expect(
    page.getByRole("button", {
      name: new RegExp(`${replacementWeight} kilograms`),
    }),
  ).toBeVisible();
});

test("B-01 reviews, declines, revises, and approves an adjustment in chat", async ({
  page,
}) => {
  const feedbackRequests: Array<string | undefined> = [];
  let state = createExistingDemoState();
  let version = 1;
  await page.route("**/api/coach/message", async (route) => {
    const request = route.request().postDataJSON() as {
      commandId: string;
      expectedVersion: number;
      input:
        | { type: "text"; text: string }
        | { type: "interaction"; action: string; interactionId: string };
    };
    version = Math.max(version, request.expectedVersion) + 1;
    let assistant = "Done.";
    if (
      request.input.type === "interaction" &&
      request.input.action === "review_trend"
    ) {
      state = {
        ...state,
        agentSession: {
          ...state.agentSession,
          pendingInteraction: {
            id: `adjustment-offer-v${state.activePlan.version}`,
            type: "adjustment_offer",
            basePlanVersion: state.activePlan.version,
            direction: "decrease",
            adjustmentKcal: 150,
          },
        },
      };
      assistant =
        "I reviewed your deterministic trend. A bounded Draft adjustment is available.";
    } else if (
      request.input.type === "text" ||
      request.input.action === "generate_adjustment"
    ) {
      const feedback =
        request.input.type === "text" && request.input.text.includes("evening")
          ? request.input.text
          : undefined;
      feedbackRequests.push(feedback);
      const draft = {
        schemaVersion: 1 as const,
        id: `adjustment-${request.commandId}`,
        basePlanVersion: state.activePlan.version,
        reason: "modification" as const,
        summary: feedback
          ? "A mocked evening-focused adjustment Draft."
          : "A mocked bounded adjustment Draft.",
        plan: {
          ...structuredClone(state.activePlan.plan),
          id: `adjustment-plan-${request.commandId}`,
          version: state.activePlan.version + 1,
          targetSnapshot: {
            ...state.activePlan.plan.targetSnapshot,
            energyKcal: state.activePlan.plan.targetSnapshot.energyKcal - 150,
          },
        },
      };
      state = {
        ...state,
        agentSession: {
          ...state.agentSession,
          pendingInteraction: {
            id: `adjustment-${request.commandId}`,
            type: "adjustment_approval",
            draft,
          },
        },
      };
      assistant = "I prepared a validated adjustment Draft.";
    } else if (request.input.action === "reject_adjustment") {
      state = {
        ...state,
        agentSession: {
          ...state.agentSession,
          pendingInteraction: {
            id: `clarification-${request.commandId}`,
            type: "clarification",
            workflow: "adjustment",
            prompt: "What did you not like about the proposal?",
            quickReplies: [],
          },
        },
      };
      assistant = "What did you not like about the proposal?";
    } else if (request.input.action === "approve_adjustment") {
      const pending = state.agentSession.pendingInteraction;
      if (pending?.type === "adjustment_approval") {
        state = {
          ...state,
          activePlan: {
            schemaVersion: 1,
            version: pending.draft.plan.version,
            activatedAt: new Date().toISOString(),
            maintenanceReferenceWeightKg:
              state.activePlan.maintenanceReferenceWeightKg,
            plan: pending.draft.plan,
          },
          agentSession: { ...state.agentSession, pendingInteraction: null },
        };
        assistant = `Your Active Plan is now version ${state.activePlan.version}.`;
      }
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

  await page.getByRole("button", { name: "Generate AI proposal" }).click();
  const proposal = page
    .getByText("AI adjustment proposal · Draft")
    .locator("..");
  await expect(proposal).toContainText("kcal");

  await proposal.getByRole("button", { name: "Decline" }).click();
  await expect(
    page
      .getByText("What did you not like about the proposal?", {
        exact: false,
      })
      .first(),
  ).toBeVisible();

  const feedback = page.getByRole("textbox", {
    name: "Message to nutrition coach",
  });
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
  await page.addInitScript(() => {
    window.sessionStorage.setItem("arnold-trend-review:existing", "started");
  });
  await page.goto("/coach/existing");
  const chartPoints = page.locator('circle[role="button"]');
  const initialPointCount = await chartPoints.count();
  await chartPoints.last().hover();
  await expect(page.getByRole("tooltip")).toContainText(/\d{4}/);
  await expect(page.getByRole("tooltip")).toContainText(/kg/);
  await expect(page.getByText("Edit recorded weight")).toHaveCount(0);
  await chartPoints.last().click();

  await expect(
    page.getByRole("dialog", { name: /Edit weight for/ }),
  ).toBeVisible();

  const replacement = page.getByRole("spinbutton", {
    name: "Replacement weight in kilograms",
  });
  await expect(replacement).toHaveValue(/^\d+(?:\.\d{1,2})?$/);
  await replacement.fill("81.09");
  await page.getByRole("button", { name: "Save replacement" }).click();
  await expect(page.getByText(/Updated .* to 81\.09 kg/)).toBeVisible();

  await page.getByRole("button", { name: /Edit .*81\.09 kilograms/ }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(chartPoints).toHaveCount(initialPointCount - 1);
  await expect(page.getByText(/Deleted the weight recorded for/)).toBeVisible();
});

test("a coach message waits for an in-flight manual weight mutation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("arnold-trend-review:existing", "started");
  });
  let patchCompleted = false;
  let patchedVersion = 0;
  let patchedState = createExistingDemoState();
  let agentSawCompletedPatch = false;
  let agentExpectedVersion = 0;

  await page.route("**/api/demo/state/existing", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const body = (await response.json()) as {
      profile: {
        version: number;
        state: ReturnType<typeof createExistingDemoState>;
      };
    };
    await new Promise((resolve) => setTimeout(resolve, 600));
    patchedVersion = body.profile.version;
    patchedState = body.profile.state;
    patchCompleted = true;
    await route.fulfill({ response, json: body });
  });
  await page.route("**/api/coach/message", async (route) => {
    const body = route.request().postDataJSON() as {
      expectedVersion: number;
    };
    agentSawCompletedPatch = patchCompleted;
    agentExpectedVersion = body.expectedVersion;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        profile: {
          profileId: "existing",
          version: patchedVersion + 1,
          state: patchedState,
        },
      }),
    });
  });

  await page.goto("/coach/existing");
  await page.locator('circle[role="button"]').last().click();
  const replacement = page.getByRole("spinbutton", {
    name: "Replacement weight in kilograms",
  });
  await replacement.fill("80.75");
  await page.getByRole("button", { name: "Save replacement" }).click();

  const chat = page.getByRole("textbox", {
    name: "Message to nutrition coach",
  });
  await chat.fill("I weigh 68.3 kg today");
  await chat.press("Enter");

  await expect.poll(() => agentExpectedVersion).toBeGreaterThan(0);
  expect(agentSawCompletedPatch).toBe(true);
  expect(agentExpectedVersion).toBe(patchedVersion);
});
