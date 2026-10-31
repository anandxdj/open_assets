import { defineConfig, devices } from "@playwright/test";

/**
 * Visual regression and accessibility tests. They run against an already
 * running stack (backend with STORAGE_PROVIDER=local, the frontend, a seeded
 * database): see e2e/README.md. Baselines are rendered in the official
 * Playwright Docker image, never on a developer machine, so fonts and
 * anti-aliasing match CI.
 *
 *   E2E_BASE_URL   where the web app is served (default http://oa-ui5.localhost:3105)
 *   E2E_API_URL    where the API is served     (default http://oa-ui5.localhost:4105)
 *   E2E_WORKERS    parallel workers (default 2)
 */
const BASE_URL = process.env.E2E_BASE_URL ?? "http://oa-ui5.localhost:3105";

export default defineConfig({
  testDir: "./e2e",
  snapshotDir: "./e2e/__screenshots__",
  // One OS renders the baselines (the Docker image), so the name needs no platform suffix.
  snapshotPathTemplate: "{snapshotDir}/{testFilePath}/{arg}{ext}",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: Number(process.env.E2E_WORKERS ?? 2),
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      scale: "css",
      // Tolerates sub-pixel text differences, not a moved or missing element.
      maxDiffPixelRatio: 0.01,
    },
  },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    locale: "en-US",
    timezoneId: "UTC",
    reducedMotion: "reduce",
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      testIgnore: /auth\.setup\.ts/,
      dependencies: ["setup"],
    },
  ],
});
