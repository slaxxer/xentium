/**
 * The rules every non-password sign-in shares (auth.signin.ts), sign-in links,
 * and "keep me signed in" — against the real test database and Redis.
 *
 * What must hold: a login PIN still guards a link sign-in; a PIN step ticket is
 * single-use and burns after five wrong PINs; a sign-in link works once; and a
 * session's "keep me signed in" choice survives every refresh.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let lastMail = "";
vi.mock("../../infrastructure/email/email.service.js", () => ({
  sendEmail: async (_to: string, _subject: string, html: string) => { lastMail = html; return true; },
  isEmailConfigured: async () => true,
}));

const { prisma } = await import("../../infrastructure/db.js");
const { assertDisposableDatabase } = await import("../../test/testDatabase.js");
const { hashPassword } = await import("./auth.password.js");
const { finishSignIn, completePinStep } = await import("./auth.signin.js");
const { requestMagicLink, consumeMagicLink } = await import("./magicLink.service.js");
const { rotateSession } = await import("./auth.tokens.js");

const EMAIL = "signin-probe@example.test";
let userId: string;
const ctx = { ip: "127.0.0.1", userAgent: "vitest" };

async function makeUser(pin?: string) {
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  const user = await prisma.user.create({
    data: {
      email: EMAIL, username: "signin_probe", passwordHash: await hashPassword("irrelevant-password"),
      loginPinEnabled: !!pin, loginPinHash: pin ? await hashPassword(pin) : null,
    },
  });
  userId = user.id;
}

beforeEach(() => { assertDisposableDatabase(); lastMail = ""; });
afterEach(async () => { await prisma.user.deleteMany({ where: { email: EMAIL } }); });

describe("finishing a sign-in", () => {
  it("mints a session when no PIN is set", async () => {
    await makeUser();
    const r = await finishSignIn(userId, ctx, { method: "passkey", persistent: true });
    expect(r.kind).toBe("session");
  });

  it("stops at the PIN, and the ticket works once", async () => {
    await makeUser("4821");
    const r = await finishSignIn(userId, ctx, { method: "magic_link", persistent: true });
    expect(r.kind).toBe("pin");
    const ticket = (r as { ticket: string }).ticket;
    expect(await completePinStep(ticket, "0000", ctx)).toBeNull();
    const ok = await completePinStep(ticket, "4821", ctx);
    expect(ok?.kind).toBe("session");
    expect(await completePinStep(ticket, "4821", ctx)).toBeNull();
  });

  it("burns the ticket after five wrong PINs", async () => {
    await makeUser("4821");
    const r = await finishSignIn(userId, ctx, { method: "oauth", persistent: true });
    const ticket = (r as { ticket: string }).ticket;
    for (let i = 0; i < 5; i++) expect(await completePinStep(ticket, "1111", ctx)).toBeNull();
    expect(await completePinStep(ticket, "4821", ctx)).toBeNull();
  });

  it("keeps a deactivated account out", async () => {
    await makeUser();
    await prisma.user.update({ where: { id: userId }, data: { isActive: false } });
    await expect(finishSignIn(userId, ctx, { method: "passkey", persistent: true })).rejects.toThrow();
  });
});

describe("sign-in links", () => {
  const tokenFromMail = () => /token=([A-Za-z0-9_-]+)/.exec(lastMail)?.[1] ?? "";

  it("signs in once, then the link is dead", async () => {
    await makeUser();
    await requestMagicLink(EMAIL.toUpperCase(), true);
    const token = tokenFromMail();
    expect(token.length).toBeGreaterThan(20);
    expect((await consumeMagicLink(token, ctx))?.kind).toBe("session");
    expect(await consumeMagicLink(token, ctx)).toBeNull();
  });

  it("sends nothing for an address with no account", async () => {
    await requestMagicLink("nobody-here@example.test", true);
    expect(lastMail).toBe("");
  });
});

describe("keep me signed in", () => {
  it("survives a refresh, and a non-persistent session expires within hours", async () => {
    await makeUser();
    const r = await finishSignIn(userId, ctx, { method: "passkey", persistent: false });
    if (r.kind !== "session") throw new Error("expected a session");
    expect(r.persistent).toBe(false);
    const rotated = await rotateSession(r.refreshToken, ctx);
    expect(rotated?.persistent).toBe(false);
    const row = await prisma.session.findFirst({ where: { userId, revokedAt: null }, orderBy: { createdAt: "desc" } });
    expect(row!.persistent).toBe(false);
    expect(row!.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(12 * 3600_000 + 5_000);
  });
});
