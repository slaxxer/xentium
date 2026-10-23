import { test, expect } from "@playwright/test";
import { MEMBER, DEV_EMAIL_CODE, uiLogin, expectAuthenticated, signInForm } from "./helpers";

/**
 * Sign-up and sign-in through the real UI. Depends on 01-install (sign-up is open
 * on a fresh install, and it asks for the date of birth).
 */

test("a new member can sign up: account, security, verify", async ({ page }) => {
  await page.goto("/register");

  // Account.
  await page.getByLabel("Email").fill(MEMBER.email);
  await page.getByLabel(/Username/).fill(MEMBER.username);
  await page.getByLabel("Date of birth").fill("1990-01-01");
  await page.getByRole("button", { name: /Continue/ }).click();

  // Security.
  await page.locator("#dw-new-password").fill(MEMBER.password);
  const agree = page.locator(".dw-check input[type=checkbox]");
  if (await agree.count()) await agree.first().check();
  await page.getByRole("button", { name: /Continue/ }).click();

  // Verify: in development the API takes the code 000000.
  const cells = page.locator(".dw-digits input");
  await expect(cells).toHaveCount(6, { timeout: 20_000 });
  for (let i = 0; i < 6; i++) await cells.nth(i).fill(DEV_EMAIL_CODE[i]!);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByText(/You're in/)).toBeVisible({ timeout: 20_000 });
});

test("the new member can sign in", async ({ page }) => {
  await uiLogin(page, MEMBER.email, MEMBER.password);
  await expectAuthenticated(page);
});

test("a wrong password is refused, and the form stays", async ({ page }) => {
  await page.goto("/login");
  const f = signInForm(page);
  await f.identifier.fill(MEMBER.email);
  await f.password.fill("wrong-password");
  await f.submit.click();
  await expect(page.getByText("That email and password don't match.")).toBeVisible();
  await expect(f.password).toBeVisible();
});
