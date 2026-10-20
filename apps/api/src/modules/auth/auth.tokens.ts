/**
 * The CMS's session flow, built on the framework token primitives
 * (`@xentium/auth`).
 *
 * The package mints and verifies tokens and hashes refresh tokens. Everything
 * below is application logic and stays here: sessions live in `xcf_sessions`,
 * "banned" and "deactivated" are this application's states, login events feed
 * its security analysis, and the device-cookie plumbing is its own. A framework
 * package may not know what a user is (ADR-0006), and all of this does.
 */
import { randomUUID } from "node:crypto";
import { createTokenService } from "@xentium/auth";
import { logger } from "../../infrastructure/logging/logger.js";
import { prisma } from "../../infrastructure/db.js";
import { queues } from "../../infrastructure/queue.js";
import { revokeSessionAccessToken } from "./session-revocation.js";

const tokens = createTokenService({
  accessSecret: process.env.JWT_SECRET ?? "",
  // Keyed (HMAC) hash for refresh tokens (§43/§17b). Falls back to JWT_SECRET
  // when the dedicated secret isn't provisioned, so existing installs start.
  refreshHmacSecret: process.env.REFRESH_TOKEN_HMAC_SECRET || process.env.JWT_SECRET || "",
});

export const verifyAccess = tokens.verifyAccess;

/**
 * Enqueue an immediate security analysis run.
 * Uses a fixed jobId so rapid logins never stack up duplicate jobs —
 * if one is already queued it is replaced with a fresh 5-second delay.
 */
async function triggerSecurityCheck(): Promise<void> {
  await queues.securityAnalysis.add(
    "security-analysis",
    {},
    {
      jobId:           "security-analysis-realtime",
      delay:           5_000,   // let the DB write settle first
      removeOnComplete: true,
      removeOnFail:     { count: 5 },
    },
  ).catch(() => null); // never throw — this is fire-and-forget
}

type Meta = { ip?: string; userAgent?: string; deviceCookieId?: string };

/** How long a "don't keep me signed in" session lives past its last use. */
export const SESSION_ONLY_TTL_MS = 12 * 60 * 60_000;

const expiryFor = (persistent: boolean) =>
  persistent ? tokens.refreshExpiryFrom() : new Date(Date.now() + SESSION_ONLY_TTL_MS);

/**
 * Called on every successful sign-in, whatever the method. `persistent` is "keep
 * me signed in": false gives a browser-session cookie and a row that dies 12h
 * after its last use. Defaults to true so a caller that says nothing keeps the
 * 30-day behaviour it always had.
 */
export async function createSession(userId: string, meta: Meta, opts: { persistent?: boolean } = {}) {
  const persistent = opts.persistent ?? true;
  const raw = tokens.generateRefreshToken();
  // A sign-in starts a family: every rotation of this token joins it.
  const id = randomUUID();
  const session = await prisma.session.create({
    data: {
      id,
      familyId: id,
      userId,
      persistent,
      refreshTokenHash: tokens.hashRefreshToken(raw),
      expiresAt: expiryFor(persistent),
      ip: meta.ip,
      userAgent: meta.userAgent,
      deviceCookieId: meta.deviceCookieId,
    },
  });
  // Trigger security analysis shortly after login so multi-account / IP
  // patterns are detected in near real-time instead of waiting 30 minutes.
  triggerSecurityCheck().catch(() => null);
  return { refreshToken: raw, persistent, accessToken: await tokens.issueAccess(userId, session.id) };
}

/**
 * How long a rotated-away refresh token still counts as "another tab got there
 * first" rather than a replay. Two tabs that refresh at the same moment send the
 * same cookie; the loser must not log the user out, and must not be read as theft.
 */
export const ROTATION_GRACE_MS = 30_000;

/** How far a straggling refresh may follow a chain of rotations inside the window. */
const MAX_ROTATION_HOPS = 10;

/** Thrown inside the rotation transaction when another request rotated first. */
class LostRotationRace extends Error {}

type Rotated =
  /** A new refresh token: set it as the cookie. */
  | { refreshToken: string; persistent: boolean; accessToken: string }
  /** Another request just rotated this token: an access token for its successor, cookie untouched. */
  | { refreshToken: null; persistent: boolean; accessToken: string };

/**
 * POST /auth/refresh: rotate the refresh token.
 *
 * - Exactly one request can rotate a token. The revoke is conditional on the row
 *   still being live, so two simultaneous refreshes can't both mint a session.
 * - The loser of that race (within ROTATION_GRACE_MS) gets an access token for
 *   the session that replaced it, and no cookie: the browser already has the
 *   winner's.
 * - A rotated token presented after the grace window is a replay. Someone holds a
 *   copy, so every session of that sign-in is revoked, the real user's included.
 */
export async function rotateSession(rawRefresh: string, meta: Meta): Promise<Rotated | null> {
  const current = await prisma.session.findUnique({
    where: { refreshTokenHash: tokens.hashRefreshToken(rawRefresh) },
  });
  if (!current) return null;
  if (current.revokedAt) return afterRotation(current);
  if (current.expiresAt < new Date()) return null;
  // Defense-in-depth: even if a ban/deactivation somehow didn't revoke this
  // session, refuse to mint a new token for a banned or deactivated user and
  // revoke the session now. This bounds a mid-session ban to the access-token
  // TTL (§43) regardless of which admin path triggered it.
  const owner = await prisma.user.findUnique({
    where:  { id: current.userId },
    select: { bannedUntil: true, isActive: true },
  });
  const isBanned = !!owner?.bannedUntil && owner.bannedUntil > new Date();
  if (!owner || !owner.isActive || isBanned) {
    await prisma.session.update({ where: { id: current.id }, data: { revokedAt: new Date() } });
    return null; // caller clears the cookie and forces re-login
  }
  const raw = tokens.generateRefreshToken();
  let next;
  try {
    next = await prisma.$transaction(async (tx) => {
      const created = await tx.session.create({
        data: {
          userId: current.userId,
          familyId: current.familyId ?? current.id,
          // The choice made at sign-in holds for the life of the session.
          persistent: current.persistent,
          refreshTokenHash: tokens.hashRefreshToken(raw),
          expiresAt: expiryFor(current.persistent),
          ip: meta.ip,
          userAgent: meta.userAgent,
          deviceCookieId: meta.deviceCookieId,
        },
      });
      // Only a live row is rotated. A concurrent rotation holds the row lock until
      // it commits; this one then matches nothing and rolls its new session back.
      const { count } = await tx.session.updateMany({
        where: { id: current.id, revokedAt: null },
        data:  { revokedAt: new Date(), replacedById: created.id },
      });
      if (count !== 1) throw new LostRotationRace();
      return created;
    });
  } catch (err) {
    if (!(err instanceof LostRotationRace)) throw err;
    const now = await prisma.session.findUnique({ where: { id: current.id } });
    return now ? afterRotation(now) : null;
  }

  // Log every token rotation as a security event so the analysis job
  // has real IP / device cookie / user agent data to work with.
  // Fire-and-forget — a logging failure must never break the auth flow.
  prisma.loginEvent.create({
    data: {
      userId:         current.userId,
      emailAttempted: "",
      success:        true,
      eventType:      "refresh",
      ip:             meta.ip,
      userAgent:      meta.userAgent,
      deviceCookieId: meta.deviceCookieId,
    },
  }).then(() => triggerSecurityCheck()).catch(() => null);

  return { refreshToken: raw, persistent: current.persistent, accessToken: await tokens.issueAccess(next.userId, next.id) };
}

type SessionRow = { id: string; userId: string; familyId: string | null; replacedById: string | null; revokedAt: Date | null; persistent: boolean };

/** A refresh with a token that is no longer live: a lost race, a replay, or just old. */
async function afterRotation(session: SessionRow): Promise<Rotated | null> {
  // Logged out, banned or revoked by hand: nothing to tell apart.
  if (!session.replacedById || !session.revokedAt) return null;

  if (Date.now() - session.revokedAt.getTime() <= ROTATION_GRACE_MS) {
    // Several tabs loading at once can rotate the token more than once inside the
    // window, so follow the replacements to the session that is live now.
    let nextId: string | null = session.replacedById;
    for (let hop = 0; nextId && hop < MAX_ROTATION_HOPS; hop++) {
      const next: SessionRow & { expiresAt: Date } | null = await prisma.session.findUnique({ where: { id: nextId } });
      if (!next) return null;
      if (!next.revokedAt) {
        if (next.expiresAt < new Date()) return null;
        return { refreshToken: null, persistent: session.persistent, accessToken: await tokens.issueAccess(next.userId, next.id) };
      }
      nextId = next.replacedById; // null: logged out or revoked, not rotated
    }
    return null;
  }

  await revokeFamily(session.familyId ?? session.id);
  logger.warn({ userId: session.userId, sessionId: session.id }, "Rotated refresh token replayed; signed out every session of that sign-in");
  return null;
}

/** Revoke every live session of one sign-in, access tokens included. */
async function revokeFamily(familyId: string): Promise<void> {
  const live = await prisma.session.findMany({
    where:  { OR: [{ familyId }, { id: familyId }], revokedAt: null },
    select: { id: true },
  });
  if (live.length === 0) return;
  await prisma.session.updateMany({
    where: { id: { in: live.map((s) => s.id) }, revokedAt: null },
    data:  { revokedAt: new Date() },
  });
  await Promise.all(live.map((s) => revokeSessionAccessToken(s.id)));
}

export async function revokeSession(rawRefresh: string) {
  const session = await prisma.session.findUnique({
    where:  { refreshTokenHash: tokens.hashRefreshToken(rawRefresh) },
    select: { id: true, revokedAt: true },
  });
  if (!session || session.revokedAt) return;
  await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
  // Immediate revocation (BUGS.md #4): kill this session's in-flight access token
  // so self-logout takes effect on the next request, not after the 15-min TTL.
  await revokeSessionAccessToken(session.id);
}
