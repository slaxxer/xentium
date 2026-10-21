/**
 * Account lifecycle: every way a member is put out of their account ends it at once.
 * After a ban (by a moderator, or by the warning ladder), a deactivation, a forced
 * sign-out, a password reset or a password change (other devices), the access token
 * already in the browser stops working and the refresh token cannot get a new one.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes, createHmac } from "node:crypto";
import request from "supertest";
import type { Express } from "express";

const { prisma } = await import("../infrastructure/db.js");
const { assertDisposableDatabase } = await import("../test/testDatabase.js");
const { hashPassword } = await import("../modules/auth/auth.password.js");
const { createSession, rotateSession } = await import("../modules/auth/auth.tokens.js");
const { __resetInstalledCache } = await import("../shared/middleware/installGuard.js");
const { createApp } = await import("../app/app.js");
const { adminService } = await import("../modules/admin/admin.service.js");
const { moderationService } = await import("../modules/moderation/moderation.service.js");
const { accountService } = await import("../modules/account/account.service.js");
const { confirmPasswordReset } = await import("../modules/auth/auth.service.js");

const P = "lifecyc";
let app: Express;
let installRowCreated = false;
let member = "", mod = "";
const meta = { ip: "127.0.0.1", userAgent: "test" };

async function clean() {
  const ids = (await prisma.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } })).map((u) => u.id);
  await prisma.moderationLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { targetId: { in: ids } }] } });
  await prisma.moderationBan.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  assertDisposableDatabase();
  // An installed site, so /api/auth/me answers (the guard 503s everything else).
  const install = await prisma.install.findUnique({ where: { singleton: true } });
  if (!install?.completedAt) {
    installRowCreated = !install;
    await prisma.install.upsert({
      where: { singleton: true }, update: { completedAt: new Date() },
      create: { singleton: true, completedAt: new Date() } as never,
    });
  }
  __resetInstalledCache();
  app = createApp();
});
afterAll(async () => {
  if (installRowCreated) await prisma.install.deleteMany({ where: { singleton: true } });
  __resetInstalledCache();
});

beforeEach(async () => {
  assertDisposableDatabase();
  await clean();
  const user = async (s: string, pw = "x") =>
    (await prisma.user.create({ data: { email: `${P}_${s}@example.test`, username: `${P}_${s}`, passwordHash: pw } })).id;
  member = await user("member", await hashPassword("correct horse battery"));
  mod = await user("mod");
});
afterEach(clean);

/** A signed-in device: its access token still valid, its refresh token unused. */
async function device() {
  const s = await createSession(member, meta);
  return { access: s.accessToken, refresh: s.refreshToken };
}

/** Whether a device is still signed in, by either token. */
async function stillIn(d: { access: string; refresh: string }) {
  // The real request guard, as the browser would meet it.
  const accessOk = (await request(app).get("/api/auth/me").set("Authorization", `Bearer ${d.access}`)).status === 200;
  const rotated = await rotateSession(d.refresh, meta);
  return { access: accessOk, refresh: !!rotated };
}

const out = { access: false, refresh: false };

describe("a member is put out of their account", () => {
  it("before anything happens, both tokens work", async () => {
    expect(await stillIn(await device())).toEqual({ access: true, refresh: true });
  });

  it("banned by a moderator", async () => {
    const d = await device();
    await adminService.banUser({ userId: member, issuedById: mod, type: "permanent", reason: "test" });
    expect(await stillIn(d)).toEqual(out);
  });

  it("banned by the warning ladder", async () => {
    const d = await device();
    await moderationService.autoBan(member, mod, "temporary", new Date(Date.now() + 86_400_000));
    expect(await stillIn(d)).toEqual(out);
  });

  it("deactivated", async () => {
    const d = await device();
    await adminService.setUserActive(member, false, mod);
    expect(await stillIn(d)).toEqual(out);
  });

  it("signed out everywhere by staff", async () => {
    const d = await device();
    await adminService.forceLogoutUser(member, mod);
    expect(await stillIn(d)).toEqual(out);
  });

  it("their password reset by email", async () => {
    const d = await device();
    const raw = randomBytes(32).toString("hex");
    await prisma.passwordResetToken.create({
      data: { userId: member, tokenHash: createHmac("sha256", process.env.REFRESH_TOKEN_HMAC_SECRET || process.env.JWT_SECRET || "").update(raw).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) },
    });
    await confirmPasswordReset(raw, "a brand new passphrase", meta);
    expect(await stillIn(d)).toEqual(out);
  });

  it("changing their password signs out the OTHER devices, not this one", async () => {
    const here = await createSession(member, meta);
    const other = await device();
    const hereId = (await prisma.session.findFirstOrThrow({ where: { userId: member }, orderBy: { createdAt: "asc" } })).id;
    await accountService.changePassword(member, "correct horse battery", "another long passphrase", hereId);
    expect(await stillIn(other)).toEqual(out);
    expect(await stillIn({ access: here.accessToken, refresh: here.refreshToken })).toEqual({ access: true, refresh: true });
  });
});
