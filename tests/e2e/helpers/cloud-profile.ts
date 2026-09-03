import type { Page } from "@playwright/test";
import { foodCatalog } from "@/data/food-catalog";
import { createCatalogSnapshot } from "@/domain/catalog/snapshot";
import {
  demoReducer,
  type DemoAction,
  type DemoState,
} from "@/store/demo-reducer";

export async function installNewCloudProfile(
  page: Page,
  initialState: DemoState,
) {
  let state = structuredClone(initialState);
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
          profile: { profileId: "new", version, state },
          catalog: foodCatalog,
        }),
      });
      return;
    }
    if (method === "PATCH") {
      const body = route.request().postDataJSON() as {
        expectedVersion: number;
        commandId: string;
        action: DemoAction;
      };
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
      state = demoReducer(
        state,
        body.action,
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
  };
}
