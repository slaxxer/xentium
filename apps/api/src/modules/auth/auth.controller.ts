import type { Request, Response } from "express";
import { loginSchema, checkInviteSchema, pinStepSchema, magicLinkRequestSchema, magicLinkConsumeSchema, registerSchema, sendCodeSchema, checkAvailabilitySchema, requestPasswordResetSchema, confirmPasswordResetSchema } from "./auth.validation.js";
import { login, register, sendRegistrationCode, checkAvailability, requestPasswordReset, confirmPasswordReset } from "./auth.service.js";
import { rotateSession, revokeSession } from "./auth.tokens.js";
import { getRequestMeta } from "../../shared/http/requestMeta.js";
import { setRefreshCookie, clearRefreshCookie, REFRESH_COOKIE_NAME } from "../../shared/http/cookies.js";
import { authGuardRegistry } from "../../core/auth-guard-registry/auth-guard-registry.js";
import { prisma } from "../../infrastructure/db.js";
import { resolveAvatar } from "../../shared/utils/resolveAvatar.js";
import { primaryGroupOrder } from "../../shared/utils/userRef.js";
import { getSetting } from "../../shared/utils/settings.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { XEC } from "../../shared/errors/xec.js";
import { effectivePermissions } from "../../shared/middleware/requirePermission.js";
import { legalService } from "../legal/legal.service.js";
import { bustLegalGate } from "../legal/legalGate.js";
import { z } from "zod";
import { LEGAL_DOCUMENTS } from "@xentium/contracts";



/** The request's user-agent, however Express hands it over. */
function uaOf(req: Request): string | null {
  const raw = req.headers["user-agent"];
  return Array.isArray(raw) ? raw[0] ?? null : (raw ?? null);
}

import { completePinStep, isStaffUser, respondSignIn } from "./auth.signin.js";
import { consumeMagicLink, requestMagicLink } from "./magicLink.service.js";
import { requestLocaleHint } from "../../shared/i18n/serverText.js";

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

  await sendRegistrationCode(parsed.email, requestLocaleHint(req));
  res.json({ sent: true });
}

/** Public — step-1 availability probe for the registration wizard. */
export async function checkAvailabilityHandler(req: Request, res: Response) {
  const parsed = checkAvailabilitySchema.parse(req.body);

  res.json(await checkAvailability(parsed.email, parsed.username));
}

export async function registerHandler(req: Request, res: Response) {
  const parsed = registerSchema.parse(req.body);

  const { email, username, password, emailCode, loginPinEnabled, loginPin, fields, inviteCode, name, addons } = parsed;
  // The form asks for consent while terms or a privacy policy are published; the server
  // holds it to that, since the account records that it was given.
  if (!parsed.acceptLegal && await legalService.consentRequired()) {
    throw new XentiumError({ code: XEC.AUTH_LEGAL_CONSENT_REQUIRED, httpStatus: 422, message: "Accept the documents members must accept to register" });
  }
  const meta           = getRequestMeta(req, res);
  const result = await register(email, username, password, emailCode, loginPinEnabled, loginPin, fields, meta, inviteCode, name, addons);
  setRefreshCookie(res, result.refreshToken);
  res.status(201).json({ accessToken: result.accessToken, user: result.user });
}

export async function loginHandler(req: Request, res: Response) {
  const parsed = loginSchema.parse(req.body);

  const meta = getRequestMeta(req, res);
  const identifier = parsed.identifier ?? parsed.email ?? "";
  const result = await login(identifier, parsed.password, parsed.loginPin, meta, { persistent: parsed.remember });
  // Failed logins are already tracked via login_events + lockout — persist:false
  // keeps the error_log free of routine credential noise.
  if (!result) {
    throw new XentiumError({ code: XEC.AUTH_INVALID_CREDENTIALS, httpStatus: 401, message: "Invalid credentials", persist: false });
  }
  if ("banned" in result) {
    throw new XentiumError({
      code: result.expiresAt ? XEC.AUTH_BANNED : XEC.AUTH_BANNED_PERMANENT,
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
   * throws with the guard's own XEC code, so the client sees why.
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

  setRefreshCookie(res, result.refreshToken, result.persistent);
  res.json({ accessToken: result.accessToken, user: result.user });
}

/**
 * Public: is this invite code usable right now? The same test registration
 * applies (exists, not expired, uses left), so "Redeem" can answer before the
 * whole form is filled in. Rate-limited like the availability probe; it says
 * nothing about who issued the code or how often it was used.
 */
export async function checkInviteHandler(req: Request, res: Response) {
  const { code } = checkInviteSchema.parse(req.body);
  const invite = await prisma.inviteCode.findUnique({ where: { code: code.toUpperCase() } });
  const valid = !!invite && !(invite.expiresAt && invite.expiresAt < new Date()) && invite.useCount < invite.maxUses;
  res.json({ valid });
}

/** Email a one-time sign-in link. Always 200: the answer must not reveal who has an account. */
export async function magicLinkRequestHandler(req: Request, res: Response) {
  const { email, remember } = magicLinkRequestSchema.parse(req.body);
  await requestMagicLink(email, remember, requestLocaleHint(req));
  res.json({ ok: true });
}

/** Use a sign-in link. */
export async function magicLinkConsumeHandler(req: Request, res: Response) {
  const { token } = magicLinkConsumeSchema.parse(req.body);
  const meta = getRequestMeta(req, res);
  const result = await consumeMagicLink(token, { ...meta, cookies: (req.signedCookies ?? {}) as Record<string, string> });
  if (!result) {
    throw new XentiumError({ code: XEC.AUTH_LINK_INVALID, httpStatus: 400, message: "This sign-in link is invalid or has expired", persist: false });
  }
  respondSignIn(res, result);
}

/** Finish a link / passkey / provider sign-in whose account has a login PIN. */
export async function pinStepHandler(req: Request, res: Response) {
  const { ticket, pin } = pinStepSchema.parse(req.body);
  const meta = getRequestMeta(req, res);
  const result = await completePinStep(ticket, pin, { ...meta, cookies: (req.signedCookies ?? {}) as Record<string, string> });
  if (!result) {
    throw new XentiumError({ code: XEC.AUTH_INVALID_CREDENTIALS, httpStatus: 401, message: "Invalid or expired PIN step", persist: false });
  }
  respondSignIn(res, result);
}

export async function refreshHandler(req: Request, res: Response) {
  // Guest refresh attempts + expired sessions fire constantly — persist:false.
  const raw = req.cookies?.[REFRESH_COOKIE_NAME];
  if (!raw) {
    throw new XentiumError({ code: XEC.AUTH_NO_SESSION, httpStatus: 401, message: "No active session", persist: false });
  }
  const result = await rotateSession(raw, getRequestMeta(req, res));
  if (!result) {
    clearRefreshCookie(res);
    throw new XentiumError({ code: XEC.AUTH_SESSION_EXPIRED, httpStatus: 401, message: "Session expired", persist: false });
  }
  // null: another request (another tab) rotated this token a moment ago and the
  // browser already holds its cookie. Overwriting it would undo that rotation.
  if (result.refreshToken) setRefreshCookie(res, result.refreshToken, result.persistent);
  res.json({ accessToken: result.accessToken });
}

/** Request a password reset link. Always returns 200 to prevent enumeration (§43). */
export async function requestPasswordResetHandler(req: Request, res: Response) {
  const parsed = requestPasswordResetSchema.parse(req.body);

  await requestPasswordReset(parsed.email, requestLocaleHint(req), { ip: req.ip, userAgent: uaOf(req) });
  res.json({ ok: true });
}

/** Complete a password reset using the emailed token. Throws XEC-AUTH-1007 on bad/expired token. */
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
      legalAcceptedAt: true,
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
  if (!user) throw XentiumError.notFound("User not found");
  // `me` returns the user's FULL group membership — this payload is the client's
  // source of truth for role gating (ACP access, staff UI). Badge *visibility* is
  // a presentational choice: `hiddenBadges` is sent alongside so the client can
  // hide badges at render time WITHOUT dropping groups from the identity list.
  // (Filtering groups here previously made "hide my Administrator badge" also
  // revoke ACP access client-side — BUGS.md #1.) Badges shown to OTHER viewers
  // are still filtered server-side in the profile/article/user endpoints.
  //
  // `permissions` is the user's EFFECTIVE keys, so the browser asks "may this user do
  // X?" instead of "is this user in group Y?" — group names are the admin's to rename
  // and re-grant in ACP → Permissions, and a UI that checks them drifts from what the
  // server enforces. It is a hint for what to SHOW; every endpoint still checks.
  const permissions = await effectivePermissions(user.id);
  // Documents this member must accept before going on: never accepted (imported, or
  // made by an admin or a sign-in provider), or asked again for their group. The site
  // sends them to each one in turn (LegalConsentGate).
  const { legalAcceptedAt: _accepted, ...rest } = user;
  const pendingLegal = await legalService.pendingFor(user.id);
  res.json({ user: { ...rest, avatar: resolveAvatar(user.avatar), permissions, pendingLegal, needsLegalConsent: pendingLegal.length > 0 } });
}

const legalConsentSchema = z.object({ keys: z.array(z.enum(LEGAL_DOCUMENTS)).max(LEGAL_DOCUMENTS.length).optional() });

/** Accepted on the document's page (`keys`), or everything at once. Answers what is left. */
export async function legalConsentHandler(req: Request, res: Response) {
  const { keys } = legalConsentSchema.parse(req.body ?? {});
  const pending = await legalService.accept(req.userId!, keys);
  bustLegalGate(req.userId!);
  res.json({ pending });
}
