import { expect, type APIRequestContext, type Page } from "@playwright/test";

/** Accounts used across the suite. The admin is created by 01-install. */
export const ADMIN = {
  email: "admin@nodevo.test",
  username: "admin",
  password: "AdminPass1!",
};

export const MEMBER = {
  email: "member1@nodevo.test",
  username: "member1",
  password: "MemberPass1!",
};

/** A second member, registered on demand via the API by the social specs. */
export const MEMBER2 = {
  email: "member2@nodevo.test",
  username: "member2",
  password: "MemberPass2!",
};

/** In dev mode the API accepts the magic email code "000000" (auth.service.ts). */
export const DEV_EMAIL_CODE = "000000";

/** A minimal valid 1×1 PNG — enough to pass magic-byte + MIME validation. */
export const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/** Log in via the API and return the access token (Bearer for API-level calls). */
export async function apiLogin(request: APIRequestContext, email: string, password: string): Promise<string> {
  const res = await request.post("/api/auth/login", { data: { email, password } });
  expect(res.ok(), `login failed for ${email}: ${res.status()}`).toBeTruthy();
  const json = await res.json();
  return json.accessToken as string;
}

/** Register a user straight through the API (dev email-code bypass). Idempotent
 *  enough for the suite: a 409 (already registered) is treated as success. */
export async function apiRegister(
  request: APIRequestContext,
  user: { email: string; username: string; password: string },
): Promise<void> {
  const res = await request.post("/api/auth/register", {
    data: {
      email: user.email,
      username: user.username,
      password: user.password,
      emailCode: DEV_EMAIL_CODE,
      fields: [],
    },
  });
  if (!res.ok() && res.status() !== 409) {
    throw new Error(`register failed for ${user.email}: ${res.status()} ${await res.text()}`);
  }
}

/** Resolve a user's id from their public profile. */
export async function userId(request: APIRequestContext, username: string): Promise<string> {
  const res = await request.get(`/api/users/${username}`);
  expect(res.ok(), `profile lookup failed for ${username}`).toBeTruthy();
  return (await res.json()).id as string;
}

/** Log in through the real UI and wait until authenticated (login form gone). */
export async function uiLogin(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator("#login-email").fill(email);
  await page.locator("#login-password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // LoginPage navigates to "/" on success; the login form unmounts.
  await expect(page.locator("#login-email")).toHaveCount(0, { timeout: 20_000 });
}

/** Assert the session is live: an authenticated user is redirected away from /login. */
export async function expectAuthenticated(page: Page) {
  await page.goto("/login");
  await expect(page.locator("#login-email")).toHaveCount(0, { timeout: 15_000 });
}
