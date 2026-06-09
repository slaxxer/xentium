import { SignJWT, jwtVerify } from "jose";
import crypto from "node:crypto";
import { prisma } from "../../infrastructure/db.js";
import { queues } from "../../infrastructure/queue.js";

const secret = new TextEncoder().encode(process.env.JWT_SECRET);
const ACCESS_TTL = "15m";
const REFRESH_TTL_DAYS = 30;

const hashToken = (raw: string) =>
  crypto.createHash("sha256").update(raw).digest("hex");

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

async function issueAccess(userId: string, sessionId: string) {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TTL)
    .sign(secret);
}

// called on successful login
export async function createSession(userId: string, meta: Meta) {
  const raw = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 864e5);
  const session = await prisma.session.create({
    data: {
      userId,
      refreshTokenHash: hashToken(raw),
      expiresAt,
      ip: meta.ip,
      userAgent: meta.userAgent,
      deviceCookieId: meta.deviceCookieId,
    },
  });
  // Trigger security analysis shortly after login so multi-account / IP
  // patterns are detected in near real-time instead of waiting 30 minutes.
  triggerSecurityCheck().catch(() => null);
  return { refreshToken: raw, accessToken: await issueAccess(userId, session.id) };
}

// called on POST /auth/refresh — rotates the refresh token
export async function rotateSession(rawRefresh: string, meta: Meta) {
  const current = await prisma.session.findUnique({
    where: { refreshTokenHash: hashToken(rawRefresh) },
  });
  if (!current || current.revokedAt || current.expiresAt < new Date()) {
    return null; // invalid / reused / expired → caller forces re-login
  }
  const raw = crypto.randomBytes(32).toString("base64url");
  const [, next] = await prisma.$transaction([
    prisma.session.update({
      where: { id: current.id },
      data: { revokedAt: new Date() },
    }),
    prisma.session.create({
      data: {
        userId: current.userId,
        refreshTokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 864e5),
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

  return { refreshToken: raw, accessToken: await issueAccess(next.userId, next.id) };
}

export async function verifyAccess(token: string) {
  const { payload } = await jwtVerify(token, secret);
  return { userId: payload.sub as string, sessionId: payload.sid as string };
}

export async function revokeSession(rawRefresh: string) {
  await prisma.session.updateMany({
    where: { refreshTokenHash: hashToken(rawRefresh), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
