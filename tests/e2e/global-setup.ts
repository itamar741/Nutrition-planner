import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { request } from "@playwright/test";
import { e2eAccessCode, e2eStorageStatePath } from "./helpers/demo-access";

export default async function globalSetup() {
  const context = await request.newContext({
    baseURL: "http://127.0.0.1:3000",
  });
  try {
    const response = await context.post("/api/demo/access", {
      data: { code: e2eAccessCode },
    });
    if (!response.ok()) {
      throw new Error(
        `Could not obtain demo access: HTTP ${response.status()}`,
      );
    }
    await mkdir(dirname(e2eStorageStatePath), { recursive: true });
    const storageState = await context.storageState();
    // The API fixture uses plain loopback HTTP and does not apply the browser's
    // secure-context exception for localhost.
    const loopbackStorageState = {
      ...storageState,
      cookies: storageState.cookies.map((cookie) =>
        cookie.name === "nutrition_demo_access"
          ? { ...cookie, secure: false }
          : cookie,
      ),
    };
    await writeFile(
      e2eStorageStatePath,
      JSON.stringify(loopbackStorageState, null, 2),
    );
  } finally {
    await context.dispose();
  }
}
