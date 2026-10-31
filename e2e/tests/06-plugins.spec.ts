import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { ADMIN, apiLogin, uiLogin } from "./helpers";

/**
 * The plugin pipeline through the ACP: upload a package, validate it, install it
 * (its migration runs), enable it. The package is a tiny test plugin built here in
 * memory, so the suite needs no private plugin build and runs the same in CI.
 */
const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, "../../apps/api/package.json"));
const AdmZip = require("adm-zip") as new () => {
  addFile(name: string, data: Buffer): void;
  toBuffer(): Buffer;
};

function testPlugin(version = "1.0.0"): Buffer {
  const zip = new AdmZip();
  const update = version !== "1.0.0";
  const manifest = {
    id: "e2e-hello",
    name: "E2E Hello",
    version,
    vendor: "Xentium e2e",
    minXentiumVersion: "1.0",
    licenseRequired: false,
    tablePrefix: "e2ehello_",
    migrations: update ? ["001_notes", "002_tags"] : ["001_notes"],
    entrypoints: { web: "web/dist/index.umd.js" },
  };
  zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2)));
  zip.addFile("package.json", Buffer.from(JSON.stringify({ name: "e2e-hello", version, private: true })));
  zip.addFile("migrations/001_notes.up.sql", Buffer.from("CREATE TABLE e2ehello_notes (id serial PRIMARY KEY, body text NOT NULL);\n"));
  zip.addFile("migrations/001_notes.down.sql", Buffer.from("DROP TABLE IF EXISTS e2ehello_notes;\n"));
  if (update) {
    zip.addFile("migrations/002_tags.up.sql", Buffer.from("CREATE TABLE e2ehello_tags (id serial PRIMARY KEY, name text NOT NULL);\n"));
    zip.addFile("migrations/002_tags.down.sql", Buffer.from("DROP TABLE IF EXISTS e2ehello_tags;\n"));
  }
  zip.addFile("web/dist/index.umd.js", Buffer.from("console.info('[e2e-hello] loaded');\n"));
  return zip.toBuffer();
}

test("admin uploads, installs and enables a plugin", async ({ page, request }) => {
  // Manual uploads are off on a fresh site; the Installed page's switch turns them on.
  const token = await apiLogin(request, ADMIN.email, ADMIN.password);
  const on = await request.put("/api/admin/settings/plugins.allow_upload", {
    headers: { Authorization: `Bearer ${token}` },
    data: { value: true },
  });
  expect(on.ok(), `allow uploads: ${on.status()}`).toBeTruthy();

  await uiLogin(page, ADMIN.email, ADMIN.password);
  await page.goto("/admin/upload");

  // Upload and validate.
  await page.locator('input[type="file"]').setInputFiles({
    name: "e2e-hello-1.0.0.xtplugin", mimeType: "application/zip", buffer: testPlugin(),
  });
  await page.getByRole("button", { name: /Validate Plugin/ }).click();
  // The package's own name, from the validated manifest (the file name was on the page already).
  const install = page.getByRole("button", { name: "Install Plugin" });
  await expect(install).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("E2E Hello").first()).toBeVisible();

  // Install (its migration runs), then on to the Installed page.
  await install.click();
  await expect(page.getByText("Plugin Installed")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Go to Installed" }).click();

  // Enable it from its row.
  const row = page.locator(".ipl-row").filter({ hasText: "E2E Hello" });
  const sw = row.getByRole("switch");
  await expect(sw).toHaveAttribute("aria-checked", "false", { timeout: 15_000 });
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "true", { timeout: 20_000 });
});

test("admin updates an installed plugin by uploading a newer build", async ({ page }) => {
  // Runs after the install above (same worker, files run in order): e2e-hello 1.0.0 is on.
  await uiLogin(page, ADMIN.email, ADMIN.password);
  await page.goto("/admin/upload");

  // The same build again is refused: updates only go forward.
  await page.locator('input[type="file"]').setInputFiles({
    name: "e2e-hello-1.0.0.xtplugin", mimeType: "application/zip", buffer: testPlugin(),
  });
  await page.getByRole("button", { name: /Validate Plugin/ }).click();
  await expect(page.getByText(/this build is not newer/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /Update to v1\.0\.0/ })).toBeDisabled();
  await page.getByRole("button", { name: "Back" }).click();

  // A newer one updates it: its new migration runs, and it stays on.
  await page.locator('input[type="file"]').setInputFiles({
    name: "e2e-hello-1.0.1.xtplugin", mimeType: "application/zip", buffer: testPlugin("1.0.1"),
  });
  await page.getByRole("button", { name: /Validate Plugin/ }).click();
  await expect(page.getByText(/Installed as v1\.0\.0/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Update to v1.0.1" }).click();
  await expect(page.getByText("Plugin Updated")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Go to Installed" }).click();

  const row = page.locator(".ipl-row").filter({ hasText: "E2E Hello" });
  await expect(row).toContainText("1.0.1", { timeout: 15_000 });
  await expect(row.getByRole("switch")).toHaveAttribute("aria-checked", "true");
});
