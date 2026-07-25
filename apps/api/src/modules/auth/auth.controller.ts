import type { Request, Response } from "express";
import { loginSchema, registerSchema, sendCodeSchema, requestPasswordResetSchema, confirmPasswordResetSchema } from "./auth.validation.js";
import { login, register, sendRegistrationCode, requestPasswordReset, confirmPasswordReset } from "./auth.service.js";
import { rotateSession, revokeSession } from "./auth.tokens.js";
import { getRequestMeta } from "../../shared/http/requestMeta.js";
import { setRefreshCookie, clearRefreshCookie, REFRESH_COOKIE_NAME, clearBetaCookie } from "../../shared/http/cookies.js";
import { prisma } from "../../infrastructure/db.js";
import { resolveAvatar } from "../../shared/utils/resolveAvatar.js";
import { primaryGroupOrder } from "../../shared/utils/userRef.js";
import { getSetting } from "../../shared/utils/settings.js";
import { betaService } from "../beta/beta.service.js";
import { NodevoError } from "../../shared/errors/NodevoError.js";
import { NEC } from "../../shared/errors/nec.js";

const BETA_COOKIE = "nv_beta";

/** Public — returns registration mode so the frontend can show/hide the register button and invite field. */
export async function registrationStatusHandler(req: Request, res: Response) {
  const [mode, betaEnabled] = await Promise.all([
    getSetting("auth.registration_mode", "open"),
    betaService.isEnabled(),
  ]);

  if (betaEnabled) {
    const cookieCode = req.signedCookies?.[BETA_COOKIE] as string | undefined;

    // No cookie at all → blocked
    if (!cookieCode) {
      return res.json({ open: false, mode: "beta", inviteRequired: false, betaMode: true });
    }

    // Admin bypass key → never grants registration access
    const adminKey = (await getSetting("beta.admin_key", "")) as string;
    if (adminKey && cookieCode === adminKey) {
      return res.json({ open: false, mode: "beta", inviteRequired: false, betaMode: true });
    }

    // Check IP validity and whether registration was already completed for this code
    const record = await prisma.betaCode.findUnique({ where: { code: cookieCode } });
    if (!record) {
      return res.json({ open: false, mode: "beta", inviteRequired: false, betaMode: true });
    }
    if (record.redeemerIp && record.redeemerIp !== (req.ip ?? "")) {
      return res.json({ open: false, mode: "beta", inviteRequired: false, betaMode: true });
    }
    if (record.registeredUserId) {
      // Code already consumed — an account exists for this beta code
      return res.json({ open: false, mode: "beta", inviteRequired: false, betaMode: true });
    }

    // Valid unredeemed code — allow registration
    return res.json({ open: true, mode: "beta", inviteRequired: false, betaMode: true });
  }

  res.json({
    open:           mode !== "closed",
    mode:           mode as string,
    inviteRequired: mode === "invite",
    betaMode:       false,
  });
}

export async function sendCodeHandler(req: Request, res: Response) {
  const parsed = sendCodeSchema.parse(req.body);

  await sendRegistrationCode(parsed.email);
  res.json({ sent: true });
}

export async function registerHandler(req: Request, res: Response) {
  const parsed = registerSchema.parse(req.body);

  const { email, username, password, emailCode, loginPinEnabled, loginPin, fields, inviteCode, name } = parsed;
  const meta           = getRequestMeta(req, res);
  const betaCookieCode = (req.signedCookies?.[BETA_COOKIE] as string | undefined) || undefined;
  const result = await register(email, username, password, emailCode, loginPinEnabled, loginPin, fields, meta, inviteCode, betaCookieCode, name);
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

  // Staff accounts (admin / supermod / moderator) are never gated by beta mode.
  const userGroups = await prisma.userGroup.findMany({
    where:  { userId: result.user.id },
    select: { group: { select: { key: true } } },
  });
  const isStaff = userGroups.some((ug) =>
    ["admin", "supermod", "moderator"].includes(ug.group.key),
  );

  if (!isStaff) {
    const betaCheck = await betaService.checkAccess(
      req.signedCookies?.[BETA_COOKIE],
      req.ip ?? "",
    );
    if (!betaCheck.hasAccess) {
      throw new NodevoError({
        code:       betaCheck.necCode ?? NEC.AUTH_BETA_REQUIRED,
        httpStatus: 403,
        message:    betaCheck.message ?? "Beta access required",
      });
    }
  }

  // Log beta login event — staff accounts are excluded from beta logs
  if (!isStaff) {
    const betaCookieForLog = req.signedCookies?.[BETA_COOKIE] as string | undefined;
    if (betaCookieForLog) {
      const uaRaw = req.headers["user-agent"];
      const ua    = Array.isArray(uaRaw) ? (uaRaw[0] ?? "") : (uaRaw ?? "");
      betaService.logEvent({
        eventType: "login",
        betaCode:  betaCookieForLog,
        userId:    result.user.id,
        username:  undefined, // resolved from userId by ACP display
        ip:        req.ip ?? undefined,
        userAgent: ua || undefined,
      });
    }
  }

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
  clearBetaCookie(res);   // always clear beta cookie on logout
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
