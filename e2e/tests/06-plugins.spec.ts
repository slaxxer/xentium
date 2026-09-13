import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { ADMIN, uiLogin } from "./helpers";

/**
 * Extensions: license activation + the plugin install pipeline, via the ACP.
 * The forum `.xtplugin` package must be built first (`pnpm plugin:package`).
 */

const here = dirname(fileURLToPath(import.meta.url));
const XTPLUGIN = resolve(here, "../../dist/marketplace/xentium-forum-1.0.0.xtplugin");

// Runs FIRST in this file so the entitlement it activates is present when the
// next test enables the (licenseRequired) forum plugin — the dev entitlement
// bypass was removed, so enable now does a real RS256 verify against the dev
// keypair (LICENSE_DEV_PRIVATE_KEY signs, LICENSE_PUBLIC_KEY verifies).
test("admin activates a license (dev self-signed entitlement)", async ({ page }) => {
  await uiLogin(page, ADMIN.email, ADMIN.password);
  await page.goto("/admin/license");

  await page.getByPlaceholder("NDV-XXXX-XXXX-XXXX").fill("NDV-E2E-TEST-0001");
  await page.getByRole("button", { name: "Activate" }).click();

  // The dev license self-signs an entitlement granting the forum plugin.
  // The page renders entitlement chips with the "plugin." prefix stripped.
  await expect(page.getByText("Active", { exact: false })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("xentium-forum")).toBeVisible();
});

test("admin uploads, installs, and enables the forum plugin", async ({ page }) => {
  expect(existsSync(XTPLUGIN), `missing ${XTPLUGIN} — run "pnpm plugin:package"`).toBeTruthy();

  await uiLogin(page, ADMIN.email, ADMIN.password);
  await page.goto("/admin/upload");

  // Step 0 — pick the package and validate.
  await page.locator('input[type="file"]').setInputFiles(XTPLUGIN);
  await page.getByRole("button", { name: /Validate Plugin/ }).click();

  // Step 1 — validation results, then install.
  await expect(page.getByText("xentium-forum")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Install Plugin" }).click();

  // Step 2 — done.
  await expect(page.getByText("Plugin Installed")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Go to Installed" }).click();

  // Enable it (dev mode auto-grants the entitlement).
  await page.getByRole("button", { name: "Enable" }).click();
  await expect(page.getByRole("button", { name: "Disable" })).toBeVisible({ timeout: 20_000 });
});
