import { expect, type APIRequestContext, type Page } from "@playwright/test";

/** Accounts used across the suite. The admin is created by 01-install. */
export const ADMIN = {
  email: "admin@xentium.test",
  username: "admin",
  password: "AdminPass123!",
};

export const MEMBER = {
  email: "member1@xentium.test",
  username: "member1",
  password: "MemberPass1!",
};

/** A second member, registered on demand via the API by the social specs. */
export const MEMBER2 = {
  email: "member2@xentium.test",
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
      fields: await signupFields(request),
    },
  });
  if (!res.ok() && res.status() !== 409) {
    throw new Error(`register failed for ${user.email}: ${res.status()} ${await res.text()}`);
  }
}

/** A value for every profile field the site requires at sign-up (a fresh install asks for the date of birth). */
export async function signupFields(request: APIRequestContext): Promise<{ fieldId: string; value: string }[]> {
  const defs = (await (await request.get("/api/users/profile-fields")).json()) as
    { id: string; type: string; requiredOnRegistration?: boolean; options?: string[] }[];
  return defs.filter((f) => f.requiredOnRegistration).map((f) => ({
    fieldId: f.id,
    value: f.type === "date" ? "1990-01-01" : f.type === "url" ? "https://example.test" : f.options?.[0] ?? "e2e",
  }));
}

/** Resolve a user's id from their public profile. */
export async function userId(request: APIRequestContext, username: string): Promise<string> {
  const res = await request.get(`/api/users/${username}`);
  expect(res.ok(), `profile lookup failed for ${username}`).toBeTruthy();
  return (await res.json()).id as string;
}

/** The sign-in page's form: the identifier box, the password box, the submit button. */
export const signInForm = (page: Page) => ({
  identifier: page.locator(".dw-form .dw-input").first(),
  password: page.locator("#dw-password"),
  submit: page.locator(".dw-form button.dw-btn--primary"),
});

/** Log in through the real UI and wait until authenticated (the sign-in form is gone). */
export async function uiLogin(page: Page, email: string, password: string) {
  await page.goto("/login");
  const f = signInForm(page);
  await f.identifier.fill(email);
  await f.password.fill(password);
  await f.submit.click();
  await expect(f.password).toHaveCount(0, { timeout: 20_000 });
}

/** Assert the session is live: an authenticated user is redirected away from /login. */
export async function expectAuthenticated(page: Page) {
  await page.goto("/login");
  await expect(page.locator("#dw-password")).toHaveCount(0, { timeout: 15_000 });
}
