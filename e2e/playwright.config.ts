import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { E2E_WEB_PORT, e2eEnv } from "./e2eEnv.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

// Its own database, ports, uploads and Redis prefix (e2eEnv.mjs); throws if the
// database isn't a disposable *_e2e / *_test one.
const E2E_ENV = e2eEnv();
const WEB_URL = process.env.E2E_WEB_URL ?? `http://localhost:${E2E_WEB_PORT}`;

/**
 * Xentium e2e suite.
 *
 * The whole stack must be driven against a FRESH, uninstalled database so the
 * install-wizard spec can run. The root `pnpm e2e` (scripts/e2e.mjs) resets the
 * e2e database BEFORE Playwright starts, so the apps boot against a clean,
 * unseeded (uninstalled) schema. The dev site on 5173/4000 is never touched. Specs run serially in a
 * single worker and
 * in filename order — `01-install` installs the site, later specs depend on it.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  globalSetup: "./global-setup.ts",
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    // Use the system-installed Google Chrome ("chrome" channel) so no browser
    // download is needed — Playwright has no prebuilt Chromium for newer distros.
    { name: "chromium", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
  ],

  // Start api + worker + web on the e2e ports, against the e2e database. A dev
  // stack running at the same time is unaffected. E2E_REUSE=1 reuses an e2e
  // stack you started yourself (with the same env).
  webServer: {
    command: "pnpm dev:apps",
    cwd: repoRoot,
    url: WEB_URL,
    reuseExistingServer: process.env.E2E_REUSE === "1",
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    // Quiet the per-request pino logs so the test output stays readable.
    env: { ...E2E_ENV, LOG_LEVEL: "warn" },
  },
});
