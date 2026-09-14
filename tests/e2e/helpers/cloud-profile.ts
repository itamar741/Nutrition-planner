import type { Page } from "@playwright/test";
import type { ConversationActivity } from "@/domain/agent/types";
import { foodCatalog } from "@/data/food-catalog";
import { createCatalogSnapshot } from "@/domain/catalog/snapshot";
import {
  demoReducer,
  type DemoAction,
  type DemoState,
} from "@/store/demo-reducer";
import { newDemoCloudActionSchema } from "@/store/cloud-action-schemas";

export async function installNewCloudProfile(
  page: Page,
  initialState: DemoState,
) {
  let state = structuredClone(initialState);
  let activityEvents: ConversationActivity[] = [];
  let version = 1;
  const commandResults = new Map<
    string,
    { profileId: "new"; version: number; state: DemoState }
  >();
  await page.route("**/api/demo/state/new", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          profile: { profileId: "new", version, state, activityEvents },
          catalog: foodCatalog,
        }),
      });
      return;
    }
    if (method === "PATCH") {
      const body = route.request().postDataJSON() as {
        expectedVersion: number;
        commandId: string;
        action: unknown;
      };
      const action = newDemoCloudActionSchema.parse(body.action);
      const duplicate = commandResults.get(body.commandId);
      if (duplicate) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, profile: duplicate }),
        });
        return;
      }
      if (body.expectedVersion !== version) {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            ok: false,
            code: "stale_state",
            message: "The demo changed in another browser.",
            profile: { profileId: "new", version, state },
          }),
        });
        return;
      }
      let reducerAction: DemoAction;
      if (action.type === "apply_closed") {
        const turn = state.activeTurn;
        const option =
          turn.type === "closed_question"
            ? turn.options.find((candidate) => candidate.id === action.optionId)
            : undefined;
        if (!option) throw new Error("The option was not offered.");
        reducerAction = {
          type: "apply_closed",
          commandId: body.commandId,
          optionId: option.id,
          label: option.label,
          patch: option.patch,
        };
      } else {
        reducerAction = action;
      }
      state = demoReducer(
        state,
        reducerAction,
        createCatalogSnapshot(foodCatalog),
      );
      version += 1;
      const profile = { profileId: "new" as const, version, state };
      commandResults.set(body.commandId, structuredClone(profile));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, profile }),
      });
      return;
    }
    await route.fallback();
  });
  return {
    current: () => structuredClone(state),
    update: (next: DemoState) => {
      state = structuredClone(next);
      version += 1;
      return { profileId: "new" as const, version, state };
    },
    profile: () => ({ profileId: "new" as const, version, state }),
    setActivities: (next: ConversationActivity[]) => {
      activityEvents = structuredClone(next);
    },
  };
}
