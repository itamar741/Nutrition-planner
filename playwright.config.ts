import { defineConfig, devices } from "@playwright/test";
import {
  e2eAccessCode,
  e2eSigningSecret,
  e2eStorageStatePath,
} from "./tests/e2e/helpers/demo-access";

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    storageState: e2eStorageStatePath,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run start",
    env: {
      ...process.env,
      COOKIE_SIGNING_SECRET: e2eSigningSecret,
      DATABASE_URL: "",
      DEMO_ACCESS_CODE: e2eAccessCode,
    },
    url: "http://127.0.0.1:3000",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
