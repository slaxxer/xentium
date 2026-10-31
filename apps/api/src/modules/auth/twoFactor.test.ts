/**
 * Two-factor sign-in with an authenticator app — against the real test database
 * and Redis.
 *
 * What must hold: codes match RFC 6238; a code works once; every sign-in method
 * but a passkey stops at the code step; a recovery code works once and is
 * reported; the ACP is closed to an account that must use 2FA and has not turned
 * it on; guarded actions ask for a fresh code; wrong codes lock the account out.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";

const mails: Array<{ to: string; subject: string }> = [];
vi.mock("../../infrastructure/email/email.service.js", () => ({
  sendEmail: async (to: string, subject: string) => { mails.push({ to, subject }); return true; },
  isEmailConfigured: async () => true,
}));

const { prisma } = await import("../../infrastructure/db.js");
const { redis, rkey } = await import("../../infrastructure/redis.js");
const { assertDisposableDatabase } = await import("../../test/testDatabase.js");
const { CorePermissions } = await import("@xentium/contracts");
const { hashPassword } = await import("./auth.password.js");
const { createSession } = await import("./auth.tokens.js");
const { finishSignIn, completeTotpStep } = await import("./auth.signin.js");
const { login } = await import("./auth.service.js");
const { base32Encode, codeAt, currentStep } = await import("./totp.js");
const twoFactor = await import("./twoFactor.service.js");
const { requirePermission } = await import("../../shared/middleware/requirePermission.js");
const { permissionCache } = await import("../permissions/permission.cache.js");

const P = "tfa_probe";
const EMAIL = `${P}@example.test`;
const PASSWORD = "a-long-enough-password";
const ctx = { ip: "127.0.0.1", userAgent: "vitest" };
let userId = "";
let sessionId = "";
let secret = "";

/** The next code from the "phone": time moves on 30 s, so each one is fresh. */
function nextCode(): string {
  vi.setSystemTime(Date.now() + 30_000);
  return codeAt(secret, currentStep());
}

async function clean() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  for (const u of users) {
    await redis.del(rkey(`auth:2fa:fail:${u.id}`));
    await permissionCache.invalidate(u.id);
  }
  await prisma.user.deleteMany({ where: { email: { startsWith: P } } });
  await prisma.group.deleteMany({ where: { key: { startsWith: P } } });
}

async function makeUser(email = EMAIL, username = P) {
  const user = await prisma.user.create({
    data: { email, username, passwordHash: await hashPassword(PASSWORD), loginPinEnabled: true, loginPinHash: await hashPassword("4821") },
  });
  return user.id;
}

/** Put a user in a fresh group holding these keys. */
async function grant(id: string, keys: string[]) {
  const group = await prisma.group.create({ data: { key: `${P}_${id.slice(0, 8)}`, name: "Probe staff" } });
  for (const key of keys) {
    const perm = await prisma.permission.upsert({ where: { key }, update: {}, create: { key, label: key } });
    await prisma.groupPermission.create({ data: { groupId: group.id, permissionId: perm.id } });
  }
  await prisma.userGroup.create({ data: { userId: id, groupId: group.id } });
  await permissionCache.invalidate(id);
}

async function turnOn(): Promise<string[]> {
  ({ secret } = await twoFactor.beginSetup(userId));
  const { recoveryCodes } = await twoFactor.enable(userId, sessionId, nextCode(), ctx);
  return recoveryCodes;
}

/** Run a middleware: null = passed, else the error's code. */
async function run(mw: (req: Request, res: never, next: () => void) => unknown, req: Partial<Request>): Promise<string | null> {
  try {
    let passed = false;
    await mw(req as Request, {} as never, () => { passed = true; });
    return passed ? null : "stopped";
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
}

beforeEach(async () => {
  assertDisposableDatabase();
  vi.useFakeTimers({ toFake: ["Date"] });
  mails.length = 0;
  await clean();
  userId = await makeUser();
  const session = await createSession(userId, ctx);
  sessionId = session.sessionId;
});
afterEach(async () => { vi.useRealTimers(); await clean(); });
afterAll(async () => { await clean(); });

describe("codes", () => {
  it("match the RFC 6238 SHA-1 test vectors (last six digits)", () => {
    const rfc = base32Encode(Buffer.from("12345678901234567890"));
    expect(codeAt(rfc, Math.floor(59 / 30))).toBe("287082");
    expect(codeAt(rfc, Math.floor(1111111109 / 30))).toBe("081804");
    expect(codeAt(rfc, Math.floor(2000000000 / 30))).toBe("279037");
  });
});

describe("turning it on", () => {
  it("needs a right first code, then hands out ten recovery codes, drops the PIN and signs out other sessions", async () => {
    const other = await createSession(userId, ctx);
    ({ secret } = await twoFactor.beginSetup(userId));
    await expect(twoFactor.enable(userId, sessionId, "000000", ctx)).rejects.toMatchObject({ code: "XEC-AUTH-1070" });
    const { recoveryCodes } = await twoFactor.enable(userId, sessionId, nextCode(), ctx);
    expect(recoveryCodes).toHaveLength(10);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.totpEnabledAt).not.toBeNull();
    expect(user.totpSecret).not.toContain(secret); // stored encrypted
    expect(user.loginPinEnabled).toBe(false);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: other.sessionId } })).revokedAt).not.toBeNull();
    expect((await prisma.session.findUniqueOrThrow({ where: { id: sessionId } })).revokedAt).toBeNull();
    await vi.waitFor(() => expect(mails.some((m) => m.to === EMAIL)).toBe(true));
  });

  it("refuses a second setup while it is on", async () => {
    await turnOn();
    await expect(twoFactor.beginSetup(userId)).rejects.toMatchObject({ code: "XEC-AUTH-1076" });
  });
});

describe("signing in", () => {
  it("stops every method but a passkey at the code step", async () => {
    await turnOn();
    expect((await finishSignIn(userId, ctx, { method: "magic_link", persistent: true })).kind).toBe("totp");
    expect((await finishSignIn(userId, ctx, { method: "oauth", persistent: true })).kind).toBe("totp");
    expect((await finishSignIn(userId, ctx, { method: "passkey", persistent: true })).kind).toBe("session");
    const pw = await login(EMAIL, PASSWORD, undefined, ctx);
    expect(pw).toMatchObject({ requiresTotp: true });
  });

  it("turns a right code into a session, once; a spent code is called spent", async () => {
    await turnOn();
    const first = await finishSignIn(userId, ctx, { method: "magic_link", persistent: true }) as { ticket: string };
    await expect(completeTotpStep(first.ticket, "123456", ctx)).rejects.toMatchObject({ code: "XEC-AUTH-1070" });
    const code = nextCode();
    expect((await completeTotpStep(first.ticket, code, ctx)).kind).toBe("session");
    await expect(completeTotpStep(first.ticket, code, ctx)).rejects.toMatchObject({ code: "XEC-AUTH-1073" });

    const second = await finishSignIn(userId, ctx, { method: "magic_link", persistent: true }) as { ticket: string };
    await expect(completeTotpStep(second.ticket, code, ctx)).rejects.toMatchObject({ code: "XEC-AUTH-1071" });
  });

  it("takes a recovery code once, and says so by mail", async () => {
    const [recovery] = await turnOn();
    mails.length = 0;
    const a = await finishSignIn(userId, ctx, { method: "oauth", persistent: true }) as { ticket: string };
    expect((await completeTotpStep(a.ticket, recovery!.toUpperCase(), ctx)).kind).toBe("session");
    await vi.waitFor(() => expect(mails.length).toBeGreaterThan(0));
    const b = await finishSignIn(userId, ctx, { method: "oauth", persistent: true }) as { ticket: string };
    await expect(completeTotpStep(b.ticket, recovery!, ctx)).rejects.toMatchObject({ code: "XEC-AUTH-1070" });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: userId } }).then((u) => u.totpRecoveryHashes.length)).toBe(9);
  });

  it("locks the account after ten wrong codes, across sign-in attempts", async () => {
    await turnOn();
    for (let i = 0; i < 10; i++) {
      const t = await finishSignIn(userId, ctx, { method: "oauth", persistent: true }) as { ticket: string };
      await expect(completeTotpStep(t.ticket, "000000", ctx)).rejects.toMatchObject({ code: "XEC-AUTH-1070" });
    }
    const t = await finishSignIn(userId, ctx, { method: "oauth", persistent: true }) as { ticket: string };
    await expect(completeTotpStep(t.ticket, nextCode(), ctx)).rejects.toMatchObject({ code: "XEC-AUTH-1072" });
  });
});

describe("the ACP gate", () => {
  it("closes the ACP to an account that must use 2FA until it is on", async () => {
    await grant(userId, [CorePermissions.ADMIN_ACCESS, CorePermissions.ACCOUNT_TWO_FACTOR_REQUIRED]);
    const token = (await createSession(userId, ctx)).accessToken;
    const req = { headers: { authorization: `Bearer ${token}` } };
    const gate = requirePermission(CorePermissions.ADMIN_ACCESS);
    expect(await run(gate, req)).toBe("XEC-AUTH-1074");
    await turnOn();
    const fresh = (await createSession(userId, ctx)).accessToken;
    expect(await run(gate, { headers: { authorization: `Bearer ${fresh}` } })).toBeNull();
  });

  it("leaves an admin who is not required alone", async () => {
    await grant(userId, [CorePermissions.ADMIN_ACCESS]);
    const token = (await createSession(userId, ctx)).accessToken;
    expect(await run(requirePermission(CorePermissions.ADMIN_ACCESS), { headers: { authorization: `Bearer ${token}` } })).toBeNull();
  });
});

describe("step-up", () => {
  const stepUpReq = (otp?: string) => ({
    userId, sessionId, ip: "127.0.0.1",
    header: (name: string) => (name.toLowerCase() === "x-xentium-otp" ? otp : undefined),
    get: () => "vitest",
  }) as unknown as Request;

  it("asks for a code, then covers the sign-in for a while", async () => {
    await turnOn();
    await redis.del(rkey(`auth:2fa:stepup:${sessionId}`)); // the enable grant
    expect(await run(twoFactor.requireStepUp, stepUpReq())).toBe("XEC-AUTH-1075");
    expect(await run(twoFactor.requireStepUp, stepUpReq("000000"))).toBe("XEC-AUTH-1070");
    expect(await run(twoFactor.requireStepUp, stepUpReq(nextCode()))).toBeNull();
    expect(await run(twoFactor.requireStepUp, stepUpReq())).toBeNull();
  });

  it("asks nothing of an account without 2FA", async () => {
    expect(await run(twoFactor.requireStepUp, stepUpReq())).toBeNull();
  });
});

describe("turning it off", () => {
  it("needs a code, and tells the admins when the account had to use it", async () => {
    await grant(userId, [CorePermissions.ACCOUNT_TWO_FACTOR_REQUIRED]);
    const adminId = await makeUser(`${P}_admin@example.test`, `${P}_admin`);
    await grant(adminId, [CorePermissions.ADMIN_ACCESS]);
    await turnOn();
    mails.length = 0;
    await expect(twoFactor.disable(userId, "000000", ctx)).rejects.toMatchObject({ code: "XEC-AUTH-1070" });
    await twoFactor.disable(userId, nextCode(), ctx);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).totpEnabledAt).toBeNull();
    await vi.waitFor(() => expect(mails.map((m) => m.to)).toEqual(expect.arrayContaining([EMAIL, `${P}_admin@example.test`])));
  });

  it("an admin reset clears it and signs the account out everywhere", async () => {
    await turnOn();
    await twoFactor.adminReset(userId, ctx);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.totpEnabledAt).toBeNull();
    expect(user.totpSecret).toBeNull();
    expect(await prisma.session.count({ where: { userId, revokedAt: null } })).toBe(0);
  });
});
