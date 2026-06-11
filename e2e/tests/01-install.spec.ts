import { test, expect } from "@playwright/test";
import { ADMIN } from "./helpers";

/**
 * Walks the 7-step install wizard end to end against a freshly-reset DB.
 * This is the one true install e2e — every later spec depends on the site
 * being installed and the admin account it creates here.
 */
test("install wizard provisions the site and admin", async ({ page }) => {
  await page.goto("/install");

  // Step 0 — Welcome
  await expect(page.locator(".welcome-features")).toBeVisible();
  await page.locator(".btn-next").click();

  // Step 1 — Environment. Checks auto-run and reveal one row every ~550ms;
  // Next stays disabled until all pass. Wait for it to enable, then advance.
  await expect(page.locator(".env-list")).toBeVisible();
  await expect(page.locator(".btn-next")).toBeEnabled({ timeout: 20_000 });
  await page.locator(".btn-next").click();

  // Step 2 — Database. Must test the connection before Next enables.
  await page.locator(".btn-soft").click(); // "Test Connection"
  await expect(page.locator(".env-icon.pass")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".btn-next")).toBeEnabled();
  await page.locator(".btn-next").click();

  // Step 3 — Site config (defaults are prefilled). Advance.
  await expect(page.locator(".form-group").first()).toBeVisible();
  await page.locator(".btn-next").click();

  // Step 4 — Admin account. Inputs render in order: email, username (no type
  // attribute → not matchable via input[type=text]), password, confirm.
  const inputs = page.locator(".step-panel input");
  await expect(inputs).toHaveCount(4);
  await inputs.nth(0).fill(ADMIN.email);
  await inputs.nth(1).fill(ADMIN.username);
  await inputs.nth(2).fill(ADMIN.password);
  await inputs.nth(3).fill(ADMIN.password);
  await page.locator(".btn-next").click();

  // Step 5 — Finalize → Install.
  await expect(page.locator(".btn-install")).toBeVisible();
  await page.locator(".btn-install").click();

  // Step 6 — Done. The completion panel renders a "go home" link.
  await expect(page.locator(".done-link")).toBeVisible({ timeout: 30_000 });
});
