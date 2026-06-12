import { test, expect } from "@playwright/test";
import { ADMIN } from "./helpers";

/**
 * Setup-mode install (WordPress-style first run): with no usable .env the API
 * boots the minimal setup server; the wizard's DATABASE step collects DB
 * credentials, the server verifies them, writes .env (generating all secrets)
 * and hot-swaps to the full application — no restart, same port.
 *
 * Skips itself unless the stack is actually in setup mode, so the regular
 * `pnpm e2e` run (preconfigured .env, spec 01) is unaffected. To exercise it:
 *   1. move the repo-root .env away
 *   2. create an empty database (e.g. nodevo_fresh)
 *   3. start the stack, then: npx playwright test tests/00-setup-mode.spec.ts
 * Credentials for the form come from E2E_SETUP_DB_* env vars (defaults match
 * the dev docker compose: nodevo/nodevo on localhost:5432, db nodevo_fresh).
 */
const DB = {
  host: process.env.E2E_SETUP_DB_HOST ?? "localhost",
  port: process.env.E2E_SETUP_DB_PORT ?? "5432",
  database: process.env.E2E_SETUP_DB_NAME ?? "nodevo_fresh",
  user: process.env.E2E_SETUP_DB_USER ?? "nodevo",
  password: process.env.E2E_SETUP_DB_PASSWORD ?? "nodevo",
};

test("setup mode collects DB credentials, writes .env and hot-swaps", async ({ page, request }) => {
  const status = await request
    .get("/api/install/status")
    .then((r) => r.json())
    .catch(() => null);
  test.skip(!status?.setupMode, "stack is not in setup mode — covered by 01-install instead");

  await page.goto("/install");
  const footerNext = page.locator(".wizard-footer .btn-next");

  // Step 0 — Welcome
  await expect(page.locator(".welcome-features")).toBeVisible();
  await footerNext.click();

  // Step 1 — Environment: lite checks only (node, .env writable, data dir).
  await expect(page.locator(".env-list")).toBeVisible();
  await expect(footerNext).toBeEnabled({ timeout: 20_000 });
  await footerNext.click();

  // Step 2 — Database: credentials form instead of the test button.
  // Inputs render in order: host, port, database name, user, password.
  const inputs = page.locator(".step-panel input");
  await expect(inputs).toHaveCount(5);
  await inputs.nth(0).fill(DB.host);
  await inputs.nth(1).fill(DB.port);
  await inputs.nth(2).fill(DB.database);
  await inputs.nth(3).fill(DB.user);
  await inputs.nth(4).fill(DB.password);

  // "Connect & save" lives inside the panel (the footer Next stays disabled
  // until the swap completes and is bypassed by the auto-advance anyway).
  await page.locator(".step-panel .btn-next").click();

  // The wizard polls /install/status through the hot swap, then auto-advances
  // to SITE_CONFIG — the only panel with two selects (language + timezone).
  await expect(page.locator(".step-panel select")).toHaveCount(2, { timeout: 45_000 });

  // Step 3 — Site config (defaults prefilled).
  await footerNext.click();

  // Step 4 — Admin account: email, username, password, confirm.
  const adminInputs = page.locator(".step-panel input");
  await expect(adminInputs).toHaveCount(4);
  await adminInputs.nth(0).fill(ADMIN.email);
  await adminInputs.nth(1).fill(ADMIN.username);
  await adminInputs.nth(2).fill(ADMIN.password);
  await adminInputs.nth(3).fill(ADMIN.password);
  await footerNext.click();

  // Step 5 — Finalize → Install (runs migrate deploy + seed on the fresh DB).
  await expect(page.locator(".btn-install")).toBeVisible();
  await page.locator(".btn-install").click();

  // Step 6 — Done.
  await expect(page.locator(".done-link")).toBeVisible({ timeout: 60_000 });
});
