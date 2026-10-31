import crypto from "node:crypto";
import type { RequestHandler } from "express";
import { prisma } from "../../infrastructure/db.js";
import { redis, rkey } from "../../infrastructure/redis.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { XEC } from "../../shared/errors/xec.js";
import { decryptSecret, encryptSecret } from "../../shared/utils/secretBox.js";
import { getSetting } from "../../shared/utils/settings.js";
import { CorePermissions } from "@xentium/contracts";
import { hasPermission } from "../../shared/middleware/requirePermission.js";
import { revokeSessionAccessToken } from "./session-revocation.js";
import { sendSecurityAlert } from "./securityAlert.js";
import { generateSecret, otpauthUri, verifyCode } from "./totp.js";

/**
 * Two-factor sign-in with an authenticator app (Google Authenticator, 1Password,
 * Authy… anything that speaks TOTP).
 *
 * Any member may turn it on; a group holding `account.twofactor.required` MUST
 * before the ACP opens to them (see `assertTwoFactorIfRequired`). Three places
 * ask for a code:
 *
 *  1. Signing in. Every method except a passkey (which is already two factors
 *     in one) ends at a code step instead of a session — see auth.signin.ts.
 *  2. Step-up. The ACP actions that hand out power, replace code or reach every
 *     member ask again, even inside a live session (`requireStepUp`).
 *  3. Changing 2FA itself (turning it off, new recovery codes).
 *
 * A code is spent once (`totpLastStep`), wrong codes count toward a per-ACCOUNT
 * lockout across sign-ins and step-ups, and recovery codes are stored hashed.
 */

/** Wrong codes per account per window, across sign-in steps and step-ups. */
const ACCOUNT_FAILS = 10;
const ACCOUNT_FAIL_WINDOW_SEC = 15 * 60;
/** One step-up covers this long, so a run of edits does not ask for a code each. */
const STEP_UP_TTL_SEC = 5 * 60;
const RECOVERY_CODES = 10;

export const STEP_UP_HEADER = "x-xentium-otp";

const failKey = (userId: string) => rkey(`auth:2fa:fail:${userId}`);
const stepUpKey = (familyId: string) => rkey(`auth:2fa:stepup:${familyId}`);

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const normaliseRecovery = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

type Request = { ip?: string | null; userAgent?: string | null };

const stateError = (message: string) =>
  new XentiumError({ code: XEC.AUTH_2FA_STATE, httpStatus: 409, message, persist: false });

const badCode = () => new XentiumError({
  code: XEC.AUTH_2FA_CODE_INVALID, httpStatus: 401,
  message: "That code is not right. Use the current code from your authenticator app.",
  persist: false,
});

const lockedOut = () => new XentiumError({
  code: XEC.AUTH_2FA_LOCKED, httpStatus: 429,
  message: "Too many wrong codes. Wait 15 minutes and try again.",
  persist: false,
});

function recoveryCode(): string {
  const alphabet = "23456789abcdefghjkmnpqrstuvwxyz";
  const pick = () => Array.from(crypto.randomBytes(5)).map((b) => alphabet[b % alphabet.length]).join("");
  return `${pick()}-${pick()}`;
}

function newRecoveryCodes() {
  const codes = Array.from({ length: RECOVERY_CODES }, recoveryCode);
  return { codes, hashes: codes.map((c) => sha256(normaliseRecovery(c))) };
}

// ── state ───────────────────────────────────────────────────────────────────

export async function isTwoFactorOn(userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { totpEnabledAt: true } });
  return !!u?.totpEnabledAt;
}

/** What the account page and `/auth/me` show. */
export async function twoFactorState(userId: string) {
  const [u, required] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { totpEnabledAt: true, totpRecoveryHashes: true } }),
    hasPermission(userId, CorePermissions.ACCOUNT_TWO_FACTOR_REQUIRED),
  ]);
  return {
    enabled: u.totpEnabledAt !== null,
    enabledAt: u.totpEnabledAt?.toISOString() ?? null,
    recoveryCodesLeft: u.totpEnabledAt ? u.totpRecoveryHashes.length : 0,
    required,
  };
}

/**
 * The ACP gate: an account that must use 2FA and has not turned it on is
 * refused. Called from the admin-access permission check, so every ACP route —
 * core and plugin — gets it without each one remembering to.
 */
export async function assertTwoFactorIfRequired(userId: string, effective: readonly string[]): Promise<void> {
  if (!effective.includes(CorePermissions.ACCOUNT_TWO_FACTOR_REQUIRED)) return;
  if (await isTwoFactorOn(userId)) return;
  throw new XentiumError({
    code: XEC.AUTH_2FA_REQUIRED, httpStatus: 403,
    message: "Turn on two-factor sign-in in your account settings to use the admin panel.",
    details: { twoFactorRequired: true },
    persist: false,
  });
}

// ── turning it on and off ───────────────────────────────────────────────────

/** A fresh secret to scan. Replaces any half-finished setup; refused while 2FA is on. */
export async function beginSetup(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId }, select: { email: true, username: true, totpEnabledAt: true },
  });
  if (user.totpEnabledAt) {
    throw stateError("Two-factor sign-in is already on. Turn it off first to move it to a new device.");
  }
  const secret = generateSecret();
  await prisma.user.update({
    where: { id: userId },
    data: { totpSecret: encryptSecret(secret), totpLastStep: null, totpRecoveryHashes: [] },
  });
  const issuer = await getSetting<string>("site.name", "Xentium");
  return { secret, uri: otpauthUri(secret, user.email, issuer) };
}

/**
 * Finish setup with a first code. Every OTHER session is signed out — none of
 * them passed the second factor — and the login PIN goes: an authenticator code
 * is the stronger second step, and asking for both would be one too many.
 */
export async function enable(userId: string, sessionId: string, code: string, request: Request) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId }, select: { totpSecret: true, totpEnabledAt: true },
  });
  if (user.totpEnabledAt) throw stateError("Two-factor sign-in is already on.");
  if (!user.totpSecret) throw stateError("Start the setup first.");
  await assertNotLockedOut(userId);
  const step = verifyCode(decryptSecret(user.totpSecret), code, null);
  if (step === null) { await countFailure(userId); throw badCode(); }

  const { codes, hashes } = newRecoveryCodes();
  const others = await prisma.session.findMany({
    where: { userId, revokedAt: null, id: { not: sessionId } }, select: { id: true },
  });
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        totpEnabledAt: new Date(), totpLastStep: step, totpRecoveryHashes: hashes,
        loginPinEnabled: false, loginPinHash: null,
      },
    }),
    prisma.session.updateMany({
      where: { userId, revokedAt: null, id: { not: sessionId } },
      data: { revokedAt: new Date() },
    }),
  ]);
  await Promise.all(others.map((s) => revokeSessionAccessToken(s.id)));
  await grantStepUp(sessionId);
  sendSecurityAlert(userId, "twofactor_enabled", request);
  return { recoveryCodes: codes };
}

export async function disable(userId: string, code: string, request: Request) {
  await verifyUserCode(userId, code, { allowRecovery: true, request });
  await prisma.user.update({
    where: { id: userId },
    data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null, totpRecoveryHashes: [] },
  });
  sendSecurityAlert(userId, "twofactor_disabled", request);
}

export async function regenerateRecoveryCodes(userId: string, code: string, request: Request) {
  await verifyUserCode(userId, code, { allowRecovery: false, request });
  const { codes, hashes } = newRecoveryCodes();
  await prisma.user.update({ where: { id: userId }, data: { totpRecoveryHashes: hashes } });
  sendSecurityAlert(userId, "recovery_regenerated", request);
  return { recoveryCodes: codes };
}

/**
 * An admin takes 2FA off someone who lost their phone AND their recovery codes.
 * Their sessions end too: whoever holds them did not just prove anything.
 */
export async function adminReset(targetId: string, request: Request) {
  const sessions = await prisma.session.findMany({ where: { userId: targetId, revokedAt: null }, select: { id: true } });
  await prisma.$transaction([
    prisma.user.update({
      where: { id: targetId },
      data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null, totpRecoveryHashes: [] },
    }),
    prisma.session.updateMany({ where: { userId: targetId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  await Promise.all(sessions.map((s) => revokeSessionAccessToken(s.id)));
  await redis.del(failKey(targetId));
  sendSecurityAlert(targetId, "twofactor_reset", request);
}

// ── checking a code ─────────────────────────────────────────────────────────

async function assertNotLockedOut(userId: string) {
  const fails = Number(await redis.get(failKey(userId)) ?? 0);
  if (fails >= ACCOUNT_FAILS) throw lockedOut();
}

async function countFailure(userId: string) {
  const key = failKey(userId);
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, ACCOUNT_FAIL_WINDOW_SEC);
}

/**
 * Check a code for an account with 2FA on. A TOTP code is spent (its step
 * recorded, so it cannot be replayed); a recovery code, where allowed, is struck
 * off. Throws on anything else, counting toward the account lockout.
 */
export async function verifyUserCode(
  userId: string,
  code: string,
  opts: { allowRecovery: boolean; request?: Request },
): Promise<{ usedRecovery: boolean }> {
  await assertNotLockedOut(userId);
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { totpSecret: true, totpEnabledAt: true, totpLastStep: true, totpRecoveryHashes: true },
  });
  if (!user.totpEnabledAt || !user.totpSecret) throw stateError("Two-factor sign-in is not on for this account.");
  const secret = decryptSecret(user.totpSecret);

  const step = verifyCode(secret, code, user.totpLastStep);
  if (step !== null) {
    // Conditional on the step still being newer: two requests carrying the same
    // code race here, and only one of them may spend it.
    const spent = await prisma.user.updateMany({
      where: { id: userId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
      data: { totpLastStep: step },
    });
    if (spent.count === 1) {
      await redis.del(failKey(userId));
      return { usedRecovery: false };
    }
  }

  if (opts.allowRecovery) {
    const clean = normaliseRecovery(code);
    const hash = sha256(clean);
    if (clean.length === 10 && user.totpRecoveryHashes.includes(hash)) {
      const struck = await prisma.user.updateMany({
        where: { id: userId, totpRecoveryHashes: { has: hash } },
        data: { totpRecoveryHashes: user.totpRecoveryHashes.filter((h) => h !== hash) },
      });
      if (struck.count === 1) {
        await redis.del(failKey(userId));
        sendSecurityAlert(userId, "recovery_used", opts.request ?? {});
        return { usedRecovery: true };
      }
    }
  }

  await countFailure(userId);
  // Right code, already spent — say so, or the person who signed in with that very
  // code a moment ago is told it is wrong and starts doubting their phone's clock.
  if (step === null && verifyCode(secret, code, null) !== null) {
    throw new XentiumError({
      code: XEC.AUTH_2FA_CODE_USED, httpStatus: 401,
      message: "That code was just used. Wait for the next one in your app.",
      persist: false,
    });
  }
  throw badCode();
}

// ── step-up ─────────────────────────────────────────────────────────────────

/**
 * Step-up is held per sign-in, not per session row: refresh rotation makes a new
 * row every 15 minutes, and a grant that died with the row would ask again
 * mid-task. The family id is the first session's id and every rotation keeps it.
 */
async function familyOf(sessionId: string): Promise<string> {
  const s = await prisma.session.findUnique({ where: { id: sessionId }, select: { familyId: true } });
  return s?.familyId ?? sessionId;
}

/**
 * A code typed to sign in (or to turn 2FA on) is as fresh as a step-up, so it
 * counts as one for the same window. Otherwise the first guarded action after
 * signing in would make the person wait out the code they just used.
 */
export async function grantStepUp(sessionId: string) {
  await redis.set(stepUpKey(await familyOf(sessionId)), "1", "EX", STEP_UP_TTL_SEC);
}

/**
 * Ask for a fresh code before the request runs, for an account with 2FA on (one
 * without has nothing to ask for, and the ACP is closed to it where 2FA is
 * required). The browser sends the code in `X-Xentium-OTP` after it prompts; one
 * good code covers this sign-in for five minutes. Mount it BEFORE any upload
 * parser, so a refused request never writes its file.
 */
export const requireStepUp: RequestHandler = async (req, _res, next) => {
  const userId = req.userId!;
  if (!(await isTwoFactorOn(userId))) return next();
  const family = await familyOf(req.sessionId!);
  if (await redis.exists(stepUpKey(family))) return next();

  const code = req.header(STEP_UP_HEADER);
  if (!code) {
    throw new XentiumError({
      code: XEC.AUTH_STEP_UP_REQUIRED, httpStatus: 403,
      message: "Enter a code from your authenticator app to confirm this.",
      details: { stepUp: true },
      persist: false,
    });
  }
  await verifyUserCode(userId, code, { allowRecovery: false, request: { ip: req.ip, userAgent: req.get("user-agent") } });
  await redis.set(stepUpKey(family), "1", "EX", STEP_UP_TTL_SEC);
  next();
};
