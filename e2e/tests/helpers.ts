import { expect, type APIRequestContext, type Page } from "@playwright/test";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

/**
 * The admin's authenticator. Admins must use two-factor sign-in, so 01-install
 * turns it on and every later admin sign-in answers with a code, like a person
 * would. The secret and the last step spent live in a file because specs share
 * nothing else; a code works once, so the next one waits for a fresh step.
 */
const TOTP_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../test-results/.admin-totp.json");
type TotpState = { secret: string; lastStep: number };
const readTotp = (): TotpState | null => {
  try { return JSON.parse(fs.readFileSync(TOTP_FILE, "utf8")) as TotpState; } catch { return null; }
};
const writeTotp = (state: TotpState) => {
  fs.mkdirSync(path.dirname(TOTP_FILE), { recursive: true });
  fs.writeFileSync(TOTP_FILE, JSON.stringify(state));
};

function base32Decode(input: string): Buffer {
  const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of input.replace(/=+$/, "").toUpperCase()) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

function codeAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = crypto.createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

/** Remember a fresh secret (two-factor was just set up). */
export function setAdminTotpSecret(secret: string) { writeTotp({ secret, lastStep: 0 }); }

/** The next unspent code: this step's, or the next one's (the server allows one step of drift). */
export async function nextAdminCode(): Promise<string> {
  const state = readTotp();
  if (!state) throw new Error("The admin has no authenticator yet (01-install sets it up).");
  const here = Math.floor(Date.now() / 30_000);
  let step = Math.max(here, state.lastStep + 1);
  if (step > here + 1) {
    await new Promise((r) => setTimeout(r, (step - 1) * 30_000 - Date.now() + 500));
  }
  writeTotp({ ...state, lastStep: step });
  return codeAt(state.secret, step);
}

/**
 * The admin's API token, reused while it is young: every fresh sign-in needs an
 * unused authenticator code, and running out of them means waiting up to 30 s
 * per sign-in, which a test with an API and a UI sign-in cannot afford.
 */
const ADMIN_TOKEN_TTL_MS = 10 * 60_000;
let adminToken: { token: string; at: number } | null = null;

/** Log in via the API and return the access token (Bearer for API-level calls). */
export async function apiLogin(request: APIRequestContext, email: string, password: string): Promise<string> {
  if (email === ADMIN.email && adminToken && Date.now() - adminToken.at < ADMIN_TOKEN_TTL_MS) return adminToken.token;
  const res = await request.post("/api/auth/login", { data: { email, password } });
  expect(res.ok(), `login failed for ${email}: ${res.status()}`).toBeTruthy();
  const json = await res.json();
  if (!json.requiresTotp) return json.accessToken as string;
  const step = await request.post("/api/auth/login/2fa", { data: { ticket: json.ticket, code: await nextAdminCode() } });
  expect(step.ok(), `two-factor step failed for ${email}: ${step.status()}`).toBeTruthy();
  const token = (await step.json()).accessToken as string;
  if (email === ADMIN.email) adminToken = { token, at: Date.now() };
  return token;
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
  if (email === ADMIN.email && readTotp()) {
    // The code step: six boxes that move along as you type.
    const digits = page.locator(".dw-digits input");
    await expect(digits.first()).toBeVisible({ timeout: 15_000 });
    await digits.first().click();
    await page.keyboard.type(await nextAdminCode());
    await page.locator(".dw-form button.dw-btn--primary").click();
    await expect(digits).toHaveCount(0, { timeout: 20_000 });
  }
}

/** Assert the session is live: an authenticated user is redirected away from /login. */
export async function expectAuthenticated(page: Page) {
  await page.goto("/login");
  await expect(page.locator("#dw-password")).toHaveCount(0, { timeout: 15_000 });
}
