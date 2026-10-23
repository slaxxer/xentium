import crypto from "node:crypto";
import type { Response } from "express";
import { prisma } from "../../infrastructure/db.js";
import { redis, rkey } from "../../infrastructure/redis.js";
import { authGuardRegistry } from "../../core/auth-guard-registry/auth-guard-registry.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { XEC } from "../../shared/errors/xec.js";
import { CorePermissions } from "@xentium/contracts";
import { hasPermission } from "../../shared/middleware/requirePermission.js";
import { setRefreshCookie } from "../../shared/http/cookies.js";
import { verifyPassword } from "./auth.password.js";
import { createSession } from "./auth.tokens.js";
import { emit } from "../../core/events/events.js";

/**
 * The last mile of every sign-in method that is not a password.
 *
 * A sign-in link, a passkey and an OAuth provider each answer "who is this?" in
 * their own way; everything after that is the same and lives here, once: the
 * account must be active and not banned, a login PIN still stands in front of
 * the session (a stolen inbox or a linked Google account must not skip the
 * factor the member chose), plugin auth guards get their say, and only then is
 * a session minted. Password sign-in keeps its own path in auth.service.ts
 * because it re-sends the PIN with the credentials, but the rules match.
 */

export type SignInMethod = "magic_link" | "passkey" | "oauth";

export interface SignInContext {
  ip?: string;
  userAgent?: string;
  deviceCookieId?: string;
  /** Signed cookies, for auth guards that read their own. */
  cookies?: Record<string, string>;
}

export type SignInResult =
  | { kind: "session"; accessToken: string; refreshToken: string; persistent: boolean; user: { id: string; email: string } }
  | { kind: "pin"; ticket: string }
  | { kind: "banned"; reason: string; expiresAt: string | null };

/** How long a PIN step may wait, and how many wrong PINs it tolerates. */
const PIN_TICKET_TTL_SEC = 300;
const PIN_TICKET_MAX_ATTEMPTS = 5;

interface PinTicket { userId: string; method: SignInMethod; persistent: boolean; attempts: number }
const ticketKey = (ticket: string) => rkey(`auth:pin-ticket:${ticket}`);

/** Staff = holds `moderation.protected` (ACP → Permissions). Passed to guards so
 *  THEY decide whether a policy exempts staff; core takes no view. */
export async function isStaffUser(userId: string): Promise<boolean> {
  return hasPermission(userId, CorePermissions.MODERATION_PROTECTED);
}

/** The active ban on an account, if any — the same rule the password path applies. */
export async function activeBanOf(user: { id: string; bannedUntil: Date | null }): Promise<{ reason: string; expiresAt: string | null } | null> {
  if (!user.bannedUntil) return null;
  const isPermanent = user.bannedUntil.getFullYear() >= 9999;
  if (!isPermanent && user.bannedUntil <= new Date()) return null;
  const ban = await prisma.moderationBan.findFirst({
    where: { userId: user.id, status: "active" }, orderBy: { createdAt: "desc" }, select: { reason: true },
  });
  return { reason: ban?.reason ?? "Account suspended", expiresAt: isPermanent ? null : user.bannedUntil.toISOString() };
}

export async function finishSignIn(
  userId: string,
  ctx: SignInContext,
  opts: { method: SignInMethod; persistent: boolean; pinVerified?: boolean },
): Promise<SignInResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, isActive: true, bannedUntil: true, loginPinEnabled: true, loginPinHash: true },
  });
  if (!user || !user.isActive) {
    throw new XentiumError({ code: XEC.AUTH_INVALID_CREDENTIALS, httpStatus: 401, message: "Invalid credentials", persist: false });
  }

  const ban = await activeBanOf(user);
  if (ban) return { kind: "banned", ...ban };

  if (user.loginPinEnabled && user.loginPinHash && !opts.pinVerified) {
    const ticket = crypto.randomBytes(24).toString("base64url");
    const data: PinTicket = { userId: user.id, method: opts.method, persistent: opts.persistent, attempts: 0 };
    await redis.set(ticketKey(ticket), JSON.stringify(data), "EX", PIN_TICKET_TTL_SEC);
    return { kind: "pin", ticket };
  }

  const guardReq = {
    ip: ctx.ip ?? "", userAgent: ctx.userAgent ?? null, cookies: ctx.cookies ?? {},
    userId: user.id, isStaff: await isStaffUser(user.id),
  };
  await authGuardRegistry.beforeLogin(guardReq);
  await authGuardRegistry.afterLogin(guardReq);

  await prisma.loginEvent.create({
    data: {
      userId: user.id, emailAttempted: user.email, success: true,
      ip: ctx.ip, userAgent: ctx.userAgent, deviceCookieId: ctx.deviceCookieId,
    },
  });
  const tokens = await createSession(user.id, ctx, { persistent: opts.persistent });
  emit("user.loggedIn", { userId: user.id, method: opts.method });
  return { kind: "session", ...tokens, user: { id: user.id, email: user.email } };
}

/**
 * The PIN step for a sign-in that already proved who it is. The ticket is
 * single-use, lives five minutes and survives four wrong PINs; the fifth burns
 * it and the member starts again — a PIN is four digits, so guesses must cost.
 */
export async function completePinStep(ticket: string, pin: string, ctx: SignInContext): Promise<SignInResult | null> {
  const key = ticketKey(ticket);
  const raw = await redis.get(key);
  if (!raw) return null;
  const data = JSON.parse(raw) as PinTicket;

  const user = await prisma.user.findUnique({ where: { id: data.userId }, select: { loginPinHash: true } });
  const ok = !!user?.loginPinHash && await verifyPassword(user.loginPinHash, pin).catch(() => false);
  if (!ok) {
    data.attempts += 1;
    if (data.attempts >= PIN_TICKET_MAX_ATTEMPTS) await redis.del(key);
    else await redis.set(key, JSON.stringify(data), "KEEPTTL");
    return null;
  }
  // GETDEL-style: only the request that deletes the ticket may use it.
  if ((await redis.del(key)) === 0) return null;
  return finishSignIn(data.userId, ctx, { method: data.method, persistent: data.persistent, pinVerified: true });
}

/** Send a SignInResult the way the password endpoint answers, so the client has one shape to read. */
export function respondSignIn(res: Response, result: SignInResult): void {
  if (result.kind === "banned") {
    throw new XentiumError({
      code: result.expiresAt ? XEC.AUTH_BANNED : XEC.AUTH_BANNED_PERMANENT,
      httpStatus: 401, message: "Account suspended",
      details: { reason: result.reason, expiresAt: result.expiresAt }, persist: false,
    });
  }
  if (result.kind === "pin") {
    res.json({ requiresPin: true, ticket: result.ticket });
    return;
  }
  setRefreshCookie(res, result.refreshToken, result.persistent);
  res.json({ accessToken: result.accessToken, user: result.user });
}
