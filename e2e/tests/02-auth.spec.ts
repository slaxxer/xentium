import { test, expect } from "@playwright/test";
import { MEMBER, DEV_EMAIL_CODE, uiLogin, expectAuthenticated } from "./helpers";

/**
 * Registration + login through the real UI. Depends on 01-install having
 * completed (registration is open by default on a fresh install).
 */

test("a new member can register through the 3-step wizard", async ({ page }) => {
  await page.goto("/register");

  // Step 1 — Account
  await page.getByPlaceholder("you@example.com").fill(MEMBER.email);
  await page.getByPlaceholder("yourname").fill(MEMBER.username);
  await page.getByRole("button", { name: /Continue/ }).click();

  // Step 2 — Security
  await page.getByPlaceholder("At least 8 characters").fill(MEMBER.password);
  await page.getByPlaceholder("Re-enter password").fill(MEMBER.password);
  await page.getByRole("button", { name: /Continue/ }).click();

  // Step 3 — Verify email. Dev mode accepts the magic code 000000.
  const codeCells = page.locator(".rw-code-input input");
  await expect(codeCells).toHaveCount(6, { timeout: 20_000 });
  for (let i = 0; i < 6; i++) {
    await codeCells.nth(i).fill(DEV_EMAIL_CODE[i]!);
  }
  await page.getByRole("button", { name: "Create account" }).click();

  // Registration auto-logs the user in. The app briefly shows a "You're in!"
  // screen, but once auth state updates RegisterPage redirects to the home page
  // ("Welcome back") — it's a race, so accept either as the success signal.
  await expect(
    page.getByText("You're in!").or(page.getByText(/welcome back/i)),
  ).toBeVisible({ timeout: 20_000 });
});

test("the registered member can sign in", async ({ page }) => {
  await uiLogin(page, MEMBER.email, MEMBER.password);
  await expectAuthenticated(page);
});

test("invalid credentials are rejected", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#login-email").fill(MEMBER.email);
  await page.locator("#login-password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  // Stays on the login page — form remains mounted.
  await expect(page.locator("#login-email")).toBeVisible();
});
