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
import { createTokenService } from "@xentium/auth";
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

// called on successful login
export async function createSession(userId: string, meta: Meta) {
  const raw = tokens.generateRefreshToken();
  const session = await prisma.session.create({
    data: {
      userId,
      refreshTokenHash: tokens.hashRefreshToken(raw),
      expiresAt: tokens.refreshExpiryFrom(),
      ip: meta.ip,
      userAgent: meta.userAgent,
      deviceCookieId: meta.deviceCookieId,
    },
  });
  // Trigger security analysis shortly after login so multi-account / IP
  // patterns are detected in near real-time instead of waiting 30 minutes.
  triggerSecurityCheck().catch(() => null);
  return { refreshToken: raw, accessToken: await tokens.issueAccess(userId, session.id) };
}

// called on POST /auth/refresh — rotates the refresh token
export async function rotateSession(rawRefresh: string, meta: Meta) {
  const current = await prisma.session.findUnique({
    where: { refreshTokenHash: tokens.hashRefreshToken(rawRefresh) },
  });
  if (!current || current.revokedAt || current.expiresAt < new Date()) {
    return null; // invalid / reused / expired → caller forces re-login
  }
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
  const [, next] = await prisma.$transaction([
    prisma.session.update({
      where: { id: current.id },
      data: { revokedAt: new Date() },
    }),
    prisma.session.create({
      data: {
        userId: current.userId,
        refreshTokenHash: tokens.hashRefreshToken(raw),
        expiresAt: tokens.refreshExpiryFrom(),
        ip: meta.ip,
        userAgent: meta.userAgent,
        deviceCookieId: meta.deviceCookieId,
      },
    }),
  ]);

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

  return { refreshToken: raw, accessToken: await tokens.issueAccess(next.userId, next.id) };
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
