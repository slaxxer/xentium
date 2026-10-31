import { test, expect } from "@playwright/test";
import { ADMIN, apiLogin, nextAdminCode, setAdminTotpSecret } from "./helpers";

/**
 * Walks the install wizard end to end against a fresh database: welcome,
 * environment, database, site, add-ons, admin, finalize, done. Every later spec
 * depends on the site being installed and the admin account made here.
 */
test("install wizard provisions the site and admin", async ({ page }) => {
  await page.goto("/install");
  const next = page.getByRole("button", { name: "Continue" });

  // Welcome.
  await page.getByRole("button", { name: "Let's go" }).click();

  // Environment: the checks run by themselves; Continue opens once they pass.
  await expect(next).toBeEnabled({ timeout: 30_000 });
  await next.click();

  // Database: the server already has DATABASE_URL, so it's a test, not a form.
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(next).toBeEnabled({ timeout: 60_000 });
  await next.click();

  // Site: the defaults are fine.
  await expect(next).toBeEnabled();
  await next.click();

  // Add-ons: none, and no marketplace account.
  await expect(next).toBeEnabled({ timeout: 30_000 });
  await next.click();

  // Admin: email, username, password, confirmation.
  const admin = page.locator(".inst-screen input:not([type=checkbox])");
  await expect(admin).toHaveCount(4);
  await admin.nth(0).fill(ADMIN.email);
  await admin.nth(1).fill(ADMIN.username);
  await admin.nth(2).fill(ADMIN.password);
  await admin.nth(3).fill(ADMIN.password);
  await expect(next).toBeEnabled();
  await next.click();

  // Finalize.
  await page.getByRole("button", { name: "Install Xentium" }).click();

  // Done: signed in, with a way into the ACP.
  await expect(page.getByRole("link", { name: "Open the admin panel" })).toBeVisible({ timeout: 60_000 });
});

/**
 * Admins must use two-factor sign-in (the ACP stays closed until they do), so the
 * admin turns it on here, through the same endpoints Account → Security uses.
 * Every later admin sign-in answers with a code.
 */
test("the admin turns on two-factor sign-in", async ({ request }) => {
  const token = await apiLogin(request, ADMIN.email, ADMIN.password);
  const auth = { Authorization: `Bearer ${token}` };

  const closed = await request.get("/api/admin/dashboard", { headers: auth });
  expect(closed.status(), "the ACP is closed until two-factor is on").toBe(403);

  const setup = await request.post("/api/account/two-factor/setup", { headers: auth });
  expect(setup.ok(), `setup: ${setup.status()}`).toBeTruthy();
  setAdminTotpSecret((await setup.json()).secret as string);

  const enable = await request.post("/api/account/two-factor/enable", { headers: auth, data: { code: await nextAdminCode() } });
  expect(enable.ok(), `enable: ${enable.status()}`).toBeTruthy();

  const open = await request.get("/api/admin/dashboard", { headers: { Authorization: `Bearer ${await apiLogin(request, ADMIN.email, ADMIN.password)}` } });
  expect(open.ok(), `the ACP opens after two-factor: ${open.status()}`).toBeTruthy();
});
