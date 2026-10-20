/**
 * Refresh-token rotation against the real test database and Redis.
 *
 * What must hold: one token rotates once, even when two requests race; the loser
 * of that race (another tab) keeps the user signed in without a new cookie; a
 * rotated token replayed after the grace window signs out every session of that
 * sign-in, and only that sign-in.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { prisma } = await import("../../infrastructure/db.js");
const { assertDisposableDatabase } = await import("../../test/testDatabase.js");
const { hashPassword } = await import("./auth.password.js");
const { createSession, rotateSession, verifyAccess, ROTATION_GRACE_MS } = await import("./auth.tokens.js");
const { isAccessTokenRevoked } = await import("./session-revocation.js");

const EMAIL = "rotation-probe@example.test";
const meta = { ip: "127.0.0.1", userAgent: "vitest" };
let userId: string;

beforeEach(async () => {
  assertDisposableDatabase();
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  const user = await prisma.user.create({
    data: { email: EMAIL, username: "rotation_probe", passwordHash: await hashPassword("irrelevant-password") },
  });
  userId = user.id;
});
afterEach(async () => { await prisma.user.deleteMany({ where: { email: EMAIL } }); });

const sessionOf = async (accessToken: string) => (await verifyAccess(accessToken)).sessionId;
const live = () => prisma.session.findMany({ where: { userId, revokedAt: null } });
/** Pretend the rotation of `sessionId` happened longer ago than the grace window. */
const ageRotation = (sessionId: string) =>
  prisma.session.update({ where: { id: sessionId }, data: { revokedAt: new Date(Date.now() - ROTATION_GRACE_MS - 5_000) } });

describe("refresh-token rotation", () => {
  it("rotates into a new session of the same family", async () => {
    const first = await createSession(userId, meta);
    const firstId = await sessionOf(first.accessToken);
    const rotated = await rotateSession(first.refreshToken, meta);

    expect(rotated?.refreshToken).toBeTypeOf("string");
    expect(rotated!.refreshToken).not.toBe(first.refreshToken);
    const old = await prisma.session.findUniqueOrThrow({ where: { id: firstId } });
    const next = await prisma.session.findUniqueOrThrow({ where: { id: await sessionOf(rotated!.accessToken) } });
    expect(old.revokedAt).not.toBeNull();
    expect(old.replacedById).toBe(next.id);
    expect(next.familyId).toBe(firstId);
  });

  it("lets only one of two simultaneous refreshes rotate", async () => {
    const first = await createSession(userId, meta);
    const results = await Promise.all([
      rotateSession(first.refreshToken, meta),
      rotateSession(first.refreshToken, meta),
    ]);

    // Both callers stay signed in...
    expect(results.every((r) => r !== null)).toBe(true);
    // ...but only one new refresh token exists, and both access tokens name its session.
    const withCookie = results.filter((r) => r!.refreshToken !== null);
    expect(withCookie).toHaveLength(1);
    const sessions = await live();
    expect(sessions).toHaveLength(1);
    for (const r of results) expect(await sessionOf(r!.accessToken)).toBe(sessions[0]!.id);
  });

  it("treats the old token inside the grace window as another tab, not a replay", async () => {
    const first = await createSession(userId, meta);
    const rotated = await rotateSession(first.refreshToken, meta);
    const again = await rotateSession(first.refreshToken, meta);

    expect(again).not.toBeNull();
    expect(again!.refreshToken).toBeNull();
    expect(await sessionOf(again!.accessToken)).toBe(await sessionOf(rotated!.accessToken));
    expect(await live()).toHaveLength(1);
  });

  it("follows several quick rotations to the live session (three tabs loading at once)", async () => {
    const first = await createSession(userId, meta);
    const second = await rotateSession(first.refreshToken, meta);
    const third = await rotateSession(second!.refreshToken!, meta);
    const straggler = await rotateSession(first.refreshToken, meta);

    expect(straggler).not.toBeNull();
    expect(straggler!.refreshToken).toBeNull();
    expect(await sessionOf(straggler!.accessToken)).toBe(await sessionOf(third!.accessToken));
    expect(await live()).toHaveLength(1);
  });

  it("signs out the whole sign-in when a rotated token is replayed later", async () => {
    const first = await createSession(userId, meta);
    const firstId = await sessionOf(first.accessToken);
    const second = await rotateSession(first.refreshToken, meta);
    const third = await rotateSession(second!.refreshToken!, meta);
    const thirdId = await sessionOf(third!.accessToken);
    await ageRotation(firstId);

    expect(await rotateSession(first.refreshToken, meta)).toBeNull();
    expect(await live()).toHaveLength(0);
    // The current token is dead too, and so is its access token.
    expect(await rotateSession(third!.refreshToken!, meta)).toBeNull();
    expect(await isAccessTokenRevoked(userId, thirdId, Date.now())).toBe(true);
  });

  it("leaves the user's other sign-ins alone on a replay", async () => {
    const laptop = await createSession(userId, meta);
    const phone = await createSession(userId, meta);
    const phoneId = await sessionOf(phone.accessToken);
    const laptopId = await sessionOf(laptop.accessToken);
    await rotateSession(laptop.refreshToken, meta);
    await ageRotation(laptopId);

    expect(await rotateSession(laptop.refreshToken, meta)).toBeNull();
    const remaining = await live();
    expect(remaining.map((s) => s.id)).toEqual([phoneId]);
  });

  it("does not resurrect a logged-out token, and a logout is not read as a replay", async () => {
    const laptop = await createSession(userId, meta);
    const phone = await createSession(userId, meta);
    await prisma.session.update({
      where: { id: await sessionOf(laptop.accessToken) },
      data:  { revokedAt: new Date(Date.now() - ROTATION_GRACE_MS - 5_000) },
    });

    expect(await rotateSession(laptop.refreshToken, meta)).toBeNull();
    expect((await live()).map((s) => s.id)).toEqual([await sessionOf(phone.accessToken)]);
  });

  it("brings sessions from before families into one on their first rotation", async () => {
    const legacy = await createSession(userId, meta);
    const legacyId = await sessionOf(legacy.accessToken);
    await prisma.session.update({ where: { id: legacyId }, data: { familyId: null } });

    const rotated = await rotateSession(legacy.refreshToken, meta);
    const next = await prisma.session.findUniqueOrThrow({ where: { id: await sessionOf(rotated!.accessToken) } });
    expect(next.familyId).toBe(legacyId);

    await ageRotation(legacyId);
    expect(await rotateSession(legacy.refreshToken, meta)).toBeNull();
    expect(await live()).toHaveLength(0);
  });

  it("refuses a token nobody issued", async () => {
    expect(await rotateSession("not-a-real-refresh-token", meta)).toBeNull();
  });
});
