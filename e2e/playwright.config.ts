import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const WEB_URL = process.env.E2E_WEB_URL ?? "http://localhost:5173";

/**
 * Nodevo e2e suite.
 *
 * The whole stack must be driven against a FRESH, uninstalled database so the
 * install-wizard spec can run. The DB reset happens in the root `pnpm e2e`
 * script (`prisma migrate reset`) BEFORE Playwright starts, so the apps boot
 * against a clean, unseeded (uninstalled) schema. Specs run serially in a
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

  // Start api + worker + web. The DB is reset by the npm script first, so these
  // boot against a clean, uninstalled database. `reuseExistingServer` lets a
  // developer keep `./nodevo.sh` running locally (the reset still applies).
  webServer: {
    command: "pnpm dev:apps",
    cwd: repoRoot,
    url: WEB_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    // Quiet the per-request pino logs so the test output stays readable.
    env: { LOG_LEVEL: "warn" },
  },
});
