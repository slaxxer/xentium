/**
 * Sign-in providers: the decisions handleCallback makes, with the provider's
 * token exchange and profile injected — the network is the one thing not under
 * test. What must hold:
 *   - the state works once, and only in the browser that started the flow;
 *   - accounts match by provider id, never by email;
 *   - a provider email that belongs to an existing member is NOT linked;
 *   - an unverified email never makes an account;
 *   - registration rules apply (invite / closed);
 *   - connecting a provider already used by someone else is refused;
 *   - the last sign-in method cannot be removed.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/db.js";
import { bustSettingsCache } from "../../shared/utils/settings.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { XEC } from "../../shared/errors/xec.js";
import { hashPassword } from "./auth.password.js";
import { handleCallback, safeReturnTo, startFlow, unlink, updateProviderConfig, type ProviderProfile } from "./oauth.service.js";

const ctx = { ip: "127.0.0.1", userAgent: "vitest" };
const EMAILS = ["oauth-new@example.test", "oauth-existing@example.test", "oauth-linker@example.test"];
const exchange = async () => "provider-token";
const profileOf = (p: Partial<ProviderProfile>) => async () => ({
  id: "g-123", email: "oauth-new@example.test", emailVerified: true, handle: "oauth.newbie", name: "New Person", ...p,
});

async function setMode(mode: string) {
  await prisma.setting.upsert({ where: { key: "auth.registration_mode" }, update: { value: mode }, create: { key: "auth.registration_mode", value: mode } });
  bustSettingsCache("auth.registration_mode");
}

async function flow(intent: "signin" | "link" = "signin", userId?: string) {
  const { state } = await startFlow("google", { intent, userId, persistent: true, returnTo: "/articles" });
  return state;
}

beforeAll(async () => {
  assertDisposableDatabase();
  await updateProviderConfig("google", { enabled: true, clientId: "test-client", clientSecret: "test-secret" });
});
afterAll(async () => {
  await prisma.setting.deleteMany({ where: { key: { in: ["auth.oauth.google", "auth.registration_mode"] } } });
  bustSettingsCache("auth.oauth.google");
  bustSettingsCache("auth.registration_mode");
});
beforeEach(async () => { await setMode("open"); });
afterEach(async () => { await prisma.user.deleteMany({ where: { email: { in: EMAILS } } }); });

describe("the state", () => {
  it("only works in the browser that started the flow", async () => {
    const state = await flow();
    const out = await handleCallback("google", { code: "c", state }, "someone-elses-state", ctx, { exchange, fetchProfile: profileOf({}) });
    expect(out.kind).toBe("error");
  });

  it("works once", async () => {
    const state = await flow();
    await handleCallback("google", { code: "c", state }, state, ctx, { exchange, fetchProfile: profileOf({}) });
    const again = await handleCallback("google", { code: "c", state }, state, ctx, { exchange, fetchProfile: profileOf({}) });
    expect(again.kind).toBe("error");
  });
});

describe("signing in", () => {
  it("creates a member for a new, verified address, and signs them in next time by provider id", async () => {
    const state = await flow();
    const out = await handleCallback("google", { code: "c", state }, state, ctx, { exchange, fetchProfile: profileOf({}) });
    expect(out.kind).toBe("signin");
    if (out.kind !== "signin") return;
    expect(out.result.kind).toBe("session");
    expect(out.returnTo).toBe("/articles");
    const user = await prisma.user.findUnique({ where: { email: "oauth-new@example.test" } });
    expect(user!.username).toBe("oauth_newbie");
    expect(user!.passwordHash.startsWith("!")).toBe(true);

    // Same Google account, different email at Google: still the same member.
    const s2 = await flow();
    const out2 = await handleCallback("google", { code: "c", state: s2 }, s2, ctx, { exchange, fetchProfile: profileOf({ email: "changed@example.test" }) });
    expect(out2.kind === "signin" && out2.result.kind === "session" && out2.result.user.id).toBe(user!.id);
  });

  it("does not link an address that already belongs to a member", async () => {
    await prisma.user.create({ data: { email: "oauth-existing@example.test", username: "oauth_existing", passwordHash: await hashPassword("password-123") } });
    const state = await flow();
    const out = await handleCallback("google", { code: "c", state }, state, ctx, { exchange, fetchProfile: profileOf({ email: "oauth-existing@example.test" }) });
    expect(out).toMatchObject({ kind: "error", code: XEC.AUTH_OAUTH_EMAIL_TAKEN });
  });

  it("never makes an account from an unverified address", async () => {
    const state = await flow();
    const out = await handleCallback("google", { code: "c", state }, state, ctx, { exchange, fetchProfile: profileOf({ emailVerified: false }) });
    expect(out.kind).toBe("error");
    expect(await prisma.user.count({ where: { email: "oauth-new@example.test" } })).toBe(0);
  });

  it("follows the registration mode", async () => {
    await setMode("invite");
    const s1 = await flow();
    expect(await handleCallback("google", { code: "c", state: s1 }, s1, ctx, { exchange, fetchProfile: profileOf({}) }))
      .toMatchObject({ kind: "error", code: XEC.AUTH_INVITE_REQUIRED });
    await setMode("closed");
    const s2 = await flow();
    expect(await handleCallback("google", { code: "c", state: s2 }, s2, ctx, { exchange, fetchProfile: profileOf({}) }))
      .toMatchObject({ kind: "error", code: XEC.AUTH_REGISTRATION_CLOSED });
  });
});

describe("connecting and disconnecting", () => {
  it("connects a provider to the signed-in member, and refuses one already used elsewhere", async () => {
    const me = await prisma.user.create({ data: { email: "oauth-linker@example.test", username: "oauth_linker", passwordHash: await hashPassword("password-123") } });
    const s1 = await flow("link", me.id);
    expect(await handleCallback("google", { code: "c", state: s1 }, s1, ctx, { exchange, fetchProfile: profileOf({ id: "g-link" }) }))
      .toMatchObject({ kind: "linked", provider: "google" });

    const other = await prisma.user.create({ data: { email: "oauth-existing@example.test", username: "oauth_existing", passwordHash: await hashPassword("password-123") } });
    const s2 = await flow("link", other.id);
    expect(await handleCallback("google", { code: "c", state: s2 }, s2, ctx, { exchange, fetchProfile: profileOf({ id: "g-link" }) }))
      .toMatchObject({ kind: "error", code: XEC.AUTH_OAUTH_EMAIL_TAKEN });
  });

  it("will not remove the last way to sign in", async () => {
    const state = await flow();
    await handleCallback("google", { code: "c", state }, state, ctx, { exchange, fetchProfile: profileOf({}) });
    const user = await prisma.user.findUnique({ where: { email: "oauth-new@example.test" } });
    await expect(unlink(user!.id, "google")).rejects.toMatchObject({ code: XEC.AUTH_LAST_SIGNIN_METHOD });
  });
});

describe("returnTo", () => {
  it("only ever points back into this site", () => {
    expect(safeReturnTo("/forum/t/1")).toBe("/forum/t/1");
    expect(safeReturnTo("https://evil.example")).toBe("/");
    expect(safeReturnTo("//evil.example")).toBe("/");
    expect(safeReturnTo("/\\evil.example")).toBe("/");
  });
});
