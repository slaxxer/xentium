import type { Request, Response } from "express";
import { loginSchema, registerSchema, sendCodeSchema, checkAvailabilitySchema, requestPasswordResetSchema, confirmPasswordResetSchema } from "./auth.validation.js";
import { login, register, sendRegistrationCode, checkAvailability, requestPasswordReset, confirmPasswordReset } from "./auth.service.js";
import { rotateSession, revokeSession } from "./auth.tokens.js";
import { getRequestMeta } from "../../shared/http/requestMeta.js";
import { setRefreshCookie, clearRefreshCookie, REFRESH_COOKIE_NAME } from "../../shared/http/cookies.js";
import { authGuardRegistry } from "../../core/auth-guard-registry/auth-guard-registry.js";
import { prisma } from "../../infrastructure/db.js";
import { resolveAvatar } from "../../shared/utils/resolveAvatar.js";
import { primaryGroupOrder } from "../../shared/utils/userRef.js";
import { getSetting } from "../../shared/utils/settings.js";
import { NodevoError } from "../../shared/errors/NodevoError.js";
import { NEC } from "../../shared/errors/nec.js";



/** The request's user-agent, however Express hands it over. */
function uaOf(req: Request): string | null {
  const raw = req.headers["user-agent"];
  return Array.isArray(raw) ? raw[0] ?? null : (raw ?? null);
}

/** Staff = admin / supermod / moderator. Passed to guards so THEY decide whether
 *  a policy exempts staff; core takes no view. */
async function isStaffUser(userId: string): Promise<boolean> {
  const groups = await prisma.userGroup.findMany({
    where: { userId }, select: { group: { select: { key: true } } },
  });
  return groups.some((ug) => ["admin", "supermod", "moderator"].includes(ug.group.key));
}

/**
 * Public — the frontend uses this to show or hide the register button.
 *
 * Core answers for its OWN policy (`auth.registration_mode`) and then lets auth
 * guards amend it. A private beta used to be branched into this handler; core no
 * longer knows what a beta is, so the plugin enforcing one supplies both the
 * answer and the wording shown when it says no.
 */
export async function registrationStatusHandler(req: Request, res: Response) {
  const mode = await getSetting("auth.registration_mode", "open");

  const base = {
    open:           mode !== "closed",
    mode:           mode as string,
    inviteRequired: mode === "invite",
  };

  const uaRaw = req.headers["user-agent"];
  const patch = await authGuardRegistry.registrationStatus({
    ip:        req.ip ?? "",
    userAgent: Array.isArray(uaRaw) ? uaRaw[0] ?? null : (uaRaw ?? null),
    cookies:   (req.signedCookies ?? {}) as Record<string, string>,
  });

  res.json({ ...base, ...patch });
}

export async function sendCodeHandler(req: Request, res: Response) {
  const parsed = sendCodeSchema.parse(req.body);

  await sendRegistrationCode(parsed.email);
  res.json({ sent: true });
}

/** Public — step-1 availability probe for the registration wizard. */
export async function checkAvailabilityHandler(req: Request, res: Response) {
  const parsed = checkAvailabilitySchema.parse(req.body);

  res.json(await checkAvailability(parsed.email, parsed.username));
}

export async function registerHandler(req: Request, res: Response) {
  const parsed = registerSchema.parse(req.body);

  const { email, username, password, emailCode, loginPinEnabled, loginPin, fields, inviteCode, name } = parsed;
  const meta           = getRequestMeta(req, res);
  const result = await register(email, username, password, emailCode, loginPinEnabled, loginPin, fields, meta, inviteCode, name);
  setRefreshCookie(res, result.refreshToken);
  res.status(201).json({ accessToken: result.accessToken, user: result.user });
}

export async function loginHandler(req: Request, res: Response) {
  const parsed = loginSchema.parse(req.body);

  const meta = getRequestMeta(req, res);
  const identifier = parsed.identifier ?? parsed.email ?? "";
  const result = await login(identifier, parsed.password, parsed.loginPin, meta);
  // Failed logins are already tracked via login_events + lockout — persist:false
  // keeps the error_log free of routine credential noise.
  if (!result) {
    throw new NodevoError({ code: NEC.AUTH_INVALID_CREDENTIALS, httpStatus: 401, message: "Invalid credentials", persist: false });
  }
  if ("banned" in result) {
    throw new NodevoError({
      code: result.expiresAt ? NEC.AUTH_BANNED : NEC.AUTH_BANNED_PERMANENT,
      httpStatus: 401,
      message: "Account suspended",
      details: { reason: result.reason, expiresAt: result.expiresAt },
      persist: false,
    });
  }
  if ("requiresPin" in result) return res.status(200).json({ requiresPin: true });

  /**
   * Plugin gates decide whether this identity may come in RIGHT NOW.
   *
   * Core has verified WHO they are; whether the door is open is a policy, and it
   * belongs to whatever implements it. `isStaff` is passed rather than acted on:
   * core does not assume a policy exempts staff, the guard decides. A refusal
   * throws with the guard's own NEC code, so the client sees why.
   */
  const guardReq = {
    ip:        req.ip ?? "",
    userAgent: uaOf(req),
    cookies:   (req.signedCookies ?? {}) as Record<string, string>,
    userId:    result.user.id,
    isStaff:   await isStaffUser(result.user.id),
  };
  await authGuardRegistry.beforeLogin(guardReq);
  await authGuardRegistry.afterLogin(guardReq);

  setRefreshCookie(res, result.refreshToken);
  res.json({ accessToken: result.accessToken, user: result.user });
}

export async function refreshHandler(req: Request, res: Response) {
  // Guest refresh attempts + expired sessions fire constantly — persist:false.
  const raw = req.cookies?.[REFRESH_COOKIE_NAME];
  if (!raw) {
    throw new NodevoError({ code: NEC.AUTH_NO_SESSION, httpStatus: 401, message: "No active session", persist: false });
  }
  const result = await rotateSession(raw, getRequestMeta(req, res));
  if (!result) {
    clearRefreshCookie(res);
    throw new NodevoError({ code: NEC.AUTH_SESSION_EXPIRED, httpStatus: 401, message: "Session expired", persist: false });
  }
  setRefreshCookie(res, result.refreshToken);
  res.json({ accessToken: result.accessToken });
}

/** Request a password reset link. Always returns 200 to prevent enumeration (§43). */
export async function requestPasswordResetHandler(req: Request, res: Response) {
  const parsed = requestPasswordResetSchema.parse(req.body);

  await requestPasswordReset(parsed.email);
  res.json({ ok: true });
}

/** Complete a password reset using the emailed token. Throws NEC-AUTH-1007 on bad/expired token. */
export async function confirmPasswordResetHandler(req: Request, res: Response) {
  const parsed = confirmPasswordResetSchema.parse(req.body);

  await confirmPasswordReset(parsed.token, parsed.password, getRequestMeta(req, res));
  res.json({ ok: true });
}

export async function logoutHandler(req: Request, res: Response) {
  const raw = req.cookies?.[REFRESH_COOKIE_NAME];
  if (raw) await revokeSession(raw);
  clearRefreshCookie(res);
  // Cookies plugin gates asked core to drop — a gate's cookie is its own, but
  // only core holds the response, so it declares the name and core clears it.
  for (const name of authGuardRegistry.cookiesToClearOnLogout()) {
    res.clearCookie(name, { path: "/" });
  }
  res.status(204).end();
}

export async function meHandler(req: Request, res: Response) {
  const user = await prisma.user.findUnique({
    where: { id: req.userId! },
    select: {
      id: true,
      email: true,
      username: true,
      displayName: true,
      avatar: true,
      bio: true,
      postCount: true,
      articleCount: true,
      followerCount: true,
      followingCount: true,
      likeCountReceived: true,
      createdAt: true,
      loginPinEnabled: true,
      dobDisplay: true,
      preferredLocale: true,
      hiddenBadges: true,
      groups: {
        orderBy: primaryGroupOrder,
        include: {
          group: {
            include: { progression: { select: { badgeColor: true, badgeLabel: true } } },
          },
        },
      },
    },
  });
  if (!user) throw NodevoError.notFound("User not found");
  // `me` returns the user's FULL group membership — this payload is the client's
  // source of truth for role gating (ACP access, staff UI). Badge *visibility* is
  // a presentational choice: `hiddenBadges` is sent alongside so the client can
  // hide badges at render time WITHOUT dropping groups from the identity list.
  // (Filtering groups here previously made "hide my Administrator badge" also
  // revoke ACP access client-side — BUGS.md #1.) Badges shown to OTHER viewers
  // are still filtered server-side in the profile/article/user endpoints.
  res.json({ user: { ...user, avatar: resolveAvatar(user.avatar) } });
}
