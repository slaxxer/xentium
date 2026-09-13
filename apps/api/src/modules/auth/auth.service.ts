import crypto from "node:crypto";
import { prisma } from "../../infrastructure/db.js";
import { redis, rkey } from "../../infrastructure/redis.js";
import { verifyPassword, hashPassword } from "./auth.password.js";
import { verifyLegacyPassword, isLegacyScheme } from "./auth.legacyPassword.js";
import { createSession } from "./auth.tokens.js";
import { revokeUserAccessTokens } from "./session-revocation.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { authGuardRegistry } from "../../core/auth-guard-registry/auth-guard-registry.js";
import { sendEmail } from "../../infrastructure/email/email.service.js";
import { renderEmailTemplate, siteVars } from "../../infrastructure/email/email-templates.js";
import { notificationService } from "../notifications/notification.service.js";
import { getSetting } from "../../shared/utils/settings.js";

/** `cookies` carries the SIGNED cookies through to auth guards, which read their
 *  own (a beta plugin needs `nv_beta`). Core never inspects them itself. */
type Meta = { ip?: string; userAgent?: string; deviceCookieId?: string; cookies?: Record<string, string> };

const DUMMY_HASH = process.env.DUMMY_ARGON2_HASH!;

const REG_CODE_TTL = 600; // 10 minutes
const RESET_TOKEN_TTL_MS = 15 * 60_000; // 15 minutes (§17b)

function generateCode(): string {
  // Cryptographically-secure 6-digit code (not Math.random, which is predictable).
  return String(crypto.randomInt(100000, 1000000));
}

// Same keyed (HMAC) hashing as refresh tokens (auth.tokens.ts) per §43/§17b: the
// raw value is a 32-byte random token, and the server-side secret means a
// DB-read attacker without it cannot confirm or derive reset/verify tokens.
const TOKEN_HMAC_KEY = process.env.REFRESH_TOKEN_HMAC_SECRET || process.env.JWT_SECRET || "";
const hashToken = (raw: string) => crypto.createHmac("sha256", TOKEN_HMAC_KEY).update(raw).digest("hex");

/** Resolve the account for a login identifier per the admin auth.login_method:
 *  email → email only; username → username only; either → either field. */
async function resolveLoginUser(identifier: string) {
  const method = String(await getSetting("auth.login_method", "email"));
  const id = identifier.trim();
  if (method === "username") {
    return prisma.user.findFirst({ where: { username: { equals: id, mode: "insensitive" } } });
  }
  if (method === "either") {
    return prisma.user.findFirst({
      where: { OR: [{ email: id.toLowerCase() }, { username: { equals: id, mode: "insensitive" } }] },
    });
  }
  return prisma.user.findUnique({ where: { email: id.toLowerCase() } });
}

// Failed-login lockout (§43). Rolling Redis counter keyed by identifier: after
// `max` failures it stays set for `duration` minutes, blocking further attempts
// (the DB audit log in ncf_login_events is written separately, on every try).
const lockKey = (identifier: string) => rkey("authfail", identifier.trim().toLowerCase());

async function getLockout(): Promise<{ enabled: boolean; max: number; durationSec: number }> {
  const [enabled, max, minutes] = await Promise.all([
    getSetting("auth.lockout_enabled", true),
    getSetting("auth.lockout_max_attempts", 5),
    getSetting("auth.lockout_duration_minutes", 10),
  ]);
  return { enabled: enabled !== false, max: Math.max(1, Number(max) || 5), durationSec: Math.max(1, Number(minutes) || 10) * 60 };
}

/** Throw NEC-AUTH-1040 if the identifier is currently locked out. Includes the
 *  attempted account + source IP as error details so the error log records who
 *  was being targeted and from where. */
async function assertNotLockedOut(identifier: string, cfg: { enabled: boolean; max: number; durationSec: number }, ip?: string) {
  if (!cfg.enabled) return;
  const key = lockKey(identifier);
  const count = Number(await redis.get(key)) || 0;
  if (count >= cfg.max) {
    const ttl = await redis.ttl(key);
    const minutes = Math.max(1, Math.ceil((ttl > 0 ? ttl : cfg.durationSec) / 60));
    throw new XentiumError({
      code: "NEC-AUTH-1040",
      httpStatus: 429,
      message: `Too many failed login attempts. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      details: { username: identifier, ip: ip ?? null, failedAttempts: count },
    });
  }
}

/** Record a failed attempt against the rolling lockout counter. */
async function recordLoginFailure(identifier: string, cfg: { enabled: boolean; durationSec: number }) {
  if (!cfg.enabled) return;
  const key = lockKey(identifier);
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, cfg.durationSec); // start the window on the first failure
}

export async function login(identifier: string, password: string, pin: string | undefined, meta: Meta) {
  const lockCfg = await getLockout();
  await assertNotLockedOut(identifier, lockCfg, meta.ip);

  const user = await resolveLoginUser(identifier);

  let ok: boolean;
  if (user && isLegacyScheme(user.passwordScheme)) {
    // Migrated account (§34): verify with the source platform's algorithm,
    // then transparently upgrade to argon2 so the legacy path runs once.
    ok = await verifyLegacyPassword(user.passwordScheme, user.passwordHash, password).catch(() => false);
    // Keep the timing profile >= an argon2 verify so legacy accounts are not
    // distinguishable from native ones (account-enumeration hardening, §43).
    await verifyPassword(DUMMY_HASH, password).catch(() => false);
    if (ok) {
      await prisma.user.update({
        where: { id: user.id },
        data:  { passwordHash: await hashPassword(password), passwordScheme: "argon2" },
      }).catch(() => { /* upgrade retried on next login */ });
    }
  } else {
    ok = await verifyPassword(user?.passwordHash ?? DUMMY_HASH, password).catch(() => false);
  }
  const authed = !!user && user.isActive && ok;

  // Audit log — every attempt (success or failure) with the identifier + IP + time.
  await prisma.loginEvent.create({
    data: {
      userId: user?.id ?? null,
      emailAttempted: identifier,
      success: authed,
      ip: meta.ip,
      userAgent: meta.userAgent,
      deviceCookieId: meta.deviceCookieId,
    },
  });

  if (!authed) {
    await recordLoginFailure(identifier, lockCfg);
    return null;
  }
  // Success clears the lockout counter for this identifier.
  await redis.del(lockKey(identifier)).catch(() => { /* best-effort */ });

  // Ban check — runs after password verification to prevent user enumeration
  if (user.bannedUntil) {
    const isPermanent = user.bannedUntil.getFullYear() >= 9999;
    if (isPermanent || user.bannedUntil > new Date()) {
      const activeBan = await prisma.moderationBan.findFirst({
        where:   { userId: user.id, status: "active" },
        orderBy: { createdAt: "desc" },
        select:  { reason: true },
      });
      return {
        banned:    true,
        reason:    activeBan?.reason ?? "Account suspended",
        expiresAt: isPermanent ? null : user.bannedUntil.toISOString(),
      } as const;
    }
  }

  // PIN check: if user has PIN enabled, validate it
  if (user.loginPinEnabled && user.loginPinHash) {
    if (!pin) {
      return { requiresPin: true } as const;
    }
    const pinOk = await verifyPassword(user.loginPinHash, pin).catch(() => false);
    if (!pinOk) return null;
  }

  const tokens = await createSession(user.id, meta);
  return {
    user: { id: user.id, email: user.email },
    ...tokens,
  };
}

/**
 * Pre-flight uniqueness probe for the registration wizard — lets step 1 reject a
 * taken email/username before the user fills in the rest of the form (and before
 * a verification code is ever sent). Mirrors the lookups `register()` performs so
 * the answer matches the eventual outcome; `register()` remains authoritative.
 */
export async function checkAvailability(
  email?: string,
  username?: string,
): Promise<{ email?: boolean; username?: boolean }> {
  const [existingEmail, existingUsername] = await Promise.all([
    email ? prisma.user.findUnique({ where: { email }, select: { id: true } }) : null,
    username
      ? prisma.user.findFirst({ where: { username: { equals: username, mode: "insensitive" } }, select: { id: true } })
      : null,
  ]);

  return {
    ...(email    !== undefined ? { email:    !existingEmail    } : {}),
    ...(username !== undefined ? { username: !existingUsername } : {}),
  };
}

export async function sendRegistrationCode(email: string): Promise<void> {
  // Check email not already taken
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new XentiumError({ code: "NEC-AUTH-2001", httpStatus: 409, message: "Email is already registered" });
  }

  const code = generateCode();
  await redis.setex(rkey("regcode", email), REG_CODE_TTL, code);

  const { subject, html } = await renderEmailTemplate("email_verify", {
    ...(await siteVars()),
    code,
    expiry_minutes: String(Math.round(REG_CODE_TTL / 60)),
  });
  const sent = await sendEmail(email, subject, html);

  if (!sent) {
    // pino-pretty's transport worker captures stdout and discards non-JSON lines.
    // Write to stderr directly so the code is always visible in dev.
    process.stderr.write(
      `\n\x1b[33m┌─────────────────────────────────────────┐\x1b[0m\n` +
      `\x1b[33m│  [DEV] Email verification code          │\x1b[0m\n` +
      `\x1b[33m│  To: ${email.padEnd(35)}│\x1b[0m\n` +
      `\x1b[33m│  Code: \x1b[1m${code}\x1b[0m\x1b[33m                            │\x1b[0m\n` +
      `\x1b[33m└─────────────────────────────────────────┘\x1b[0m\n\n`,
    );
  }
}

export async function register(
  email: string,
  username: string,
  password: string,
  emailCode: string,
  loginPinEnabled: boolean,
  loginPin: string | undefined,
  fields: Array<{ fieldId: string; value: string; privacy: string }>,
  meta: Meta,
  inviteCode?: string,
  name?: string,
) {
  /**
   * Plugin gates run FIRST, and one of them may own registration outright.
   *
   * Core used to hardcode the private-beta policy here. It is a policy, not an
   * identity concern, so it now lives in whatever plugin implements it: core
   * asks its registered guards, and enforces its own `registration_mode` only
   * when no guard has already authorised the request. A beta plugin returns
   * "allow" because its invite IS the credential — which is what lets a beta run
   * on a site whose registration is otherwise closed.
   */
  const guardAuthorised = await authGuardRegistry.beforeRegister({
    ip:        meta.ip ?? "",
    userAgent: meta.userAgent ?? null,
    cookies:   meta.cookies ?? {},
  });

  if (!guardAuthorised) {
    // Normal mode: check registration_mode setting
    const mode = await getSetting("auth.registration_mode", "open");
    if (mode === "closed") {
      throw new XentiumError({ code: "NEC-AUTH-2010", httpStatus: 403, message: "Registration is currently disabled" });
    }
    if (mode === "invite") {
      if (!inviteCode) {
        throw new XentiumError({ code: "NEC-AUTH-1020", httpStatus: 403, message: "An invite code is required to register" });
      }
      const invite = await prisma.inviteCode.findUnique({ where: { code: inviteCode.toUpperCase().trim() } });
      if (!invite || (invite.expiresAt && invite.expiresAt < new Date()) || invite.useCount >= invite.maxUses) {
        throw new XentiumError({ code: "NEC-AUTH-1021", httpStatus: 400, message: "Invalid or expired invite code" });
      }
    }
  }
  // Validate email verification code from Redis
  // In non-production, the magic code "000000" bypasses verification
  const isDev = process.env.NODE_ENV !== "production";
  if (!(isDev && emailCode === "000000")) {
    const stored = await redis.get(rkey("regcode", email));
    if (!stored || stored !== emailCode) {
      throw new XentiumError({ code: "NEC-AUTH-2003", httpStatus: 400, message: "Invalid or expired verification code" });
    }
  }

  // Check uniqueness
  const [existingEmail, existingUsername] = await Promise.all([
    prisma.user.findUnique({ where: { email } }),
    prisma.user.findFirst({ where: { username: { equals: username, mode: "insensitive" } } }),
  ]);
  if (existingEmail) {
    throw new XentiumError({ code: "NEC-AUTH-2001", httpStatus: 409, message: "Email is already registered" });
  }
  if (existingUsername) {
    throw new XentiumError({ code: "NEC-AUTH-2002", httpStatus: 409, message: "Username is already taken" });
  }

  // Optional display / full name (registration.collect_name). Only stored when
  // collection is on; required only when the admin marked it required.
  const collectName = (await getSetting("registration.collect_name", false)) === true;
  const cleanName   = collectName ? (name ?? "").trim().slice(0, 80) : "";
  if (collectName && (await getSetting("registration.name_required", false)) === true && !cleanName) {
    throw new XentiumError({ code: "NEC-AUTH-2004", httpStatus: 400, message: "Your name is required to register" });
  }

  // Use the admin-configured default group (falls back to "member" if not set)
  const defaultGroupKey = await getSetting("auth.default_group", "member");
  const [memberGroup, hash, pinHash] = await Promise.all([
    prisma.group.findFirst({ where: { key: String(defaultGroupKey) } }),
    hashPassword(password),
    loginPinEnabled && loginPin ? hashPassword(loginPin) : Promise.resolve(undefined),
  ]);

  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        email,
        username,
        displayName: cleanName || null,
        passwordHash: hash,
        isActive: true,
        emailVerifiedAt: new Date(),
        loginPinEnabled: loginPinEnabled && !!pinHash,
        loginPinHash: pinHash ?? null,
      },
    });
    if (memberGroup) {
      await tx.userGroup.create({ data: { userId: u.id, groupId: memberGroup.id } });
    }
    if (fields.length > 0) {
      await tx.userProfileFieldValue.createMany({
        data: fields
          .filter((f) => f.value.trim() !== "")
          .map((f) => ({ userId: u.id, fieldId: f.fieldId, value: f.value, privacy: f.privacy })),
        skipDuplicates: true,
      });
    }
    return u;
  });

  // Invalidate the email verification code
  await redis.del(rkey("regcode", email));

  // Let whichever guard authorised this link the account to what let them in.
  // Isolated inside the registry: the row already exists, so a bookkeeping
  // failure must never look like a failed registration.
  await authGuardRegistry.afterRegister({
    ip:        meta.ip ?? "",
    userAgent: meta.userAgent ?? null,
    cookies:   meta.cookies ?? {},
    userId:    user.id,
  });

  if (inviteCode) {
    // Consume the invite code (normal invite mode)
    const { inviteService } = await import("../invite/invite.service.js");
    await inviteService.consume(inviteCode, user.id).catch(() => {
      console.warn("[invite] Failed to consume invite code after registration:", inviteCode);
    });
  }

  // Log registration event for security analysis (§15)
  await prisma.loginEvent.create({
    data: {
      userId:         user.id,
      emailAttempted: email,
      success:        true,
      eventType:      "register",
      ip:             meta.ip,
      userAgent:      meta.userAgent,
      deviceCookieId: meta.deviceCookieId,
    },
  }).catch(() => null);

  const tokens = await createSession(user.id, meta);
  return { user: { id: user.id, email: user.email }, ...tokens };
}

/**
 * Request a password reset. Always resolves the same way regardless of whether
 * the email exists (§43 — account enumeration prevention). When the account is
 * found and active, a single-use DB-backed token is created and emailed.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) return; // silent no-op — never leak existence

  const raw = crypto.randomBytes(32).toString("base64url");
  await prisma.passwordResetToken.create({
    data: {
      userId:    user.id,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    },
  });

  const appUrl = process.env.APP_URL ?? "http://localhost:5173";
  const link = `${appUrl.replace(/\/$/, "")}/reset-password?token=${raw}`;

  const reset = await renderEmailTemplate("password_reset", {
    ...(await siteVars()),
    reset_url: link,
    expiry_minutes: String(Math.round(RESET_TOKEN_TTL_MS / 60_000)),
  });
  const sent = await sendEmail(email, reset.subject, reset.html);
  if (!sent) {
    // Dev fallback — see sendRegistrationCode for why this writes to stderr.
    process.stderr.write(
      `\n\x1b[33m[DEV] Password reset link for ${email}:\x1b[0m\n  ${link}\n\n`,
    );
  }
}

/**
 * Complete a password reset using a raw token from the email link. Validates
 * the token is unused and unexpired, sets the new password, marks the token
 * used, and revokes ALL of the user's sessions (§17b — credential change ends
 * every active session). Other outstanding reset tokens are invalidated too.
 */
export async function confirmPasswordReset(
  token: string,
  newPassword: string,
  meta: Meta,
): Promise<void> {
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!row || row.usedAt || row.expiresAt < new Date()) {
    throw new XentiumError({
      code: "NEC-AUTH-1007",
      httpStatus: 400,
      message: "This password reset link is invalid or has expired",
    });
  }

  const hash = await hashPassword(newPassword);
  const now = new Date();
  await prisma.$transaction([
    prisma.user.update({ where: { id: row.userId }, data: { passwordHash: hash } }),
    prisma.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: now } }),
    // Invalidate any other outstanding reset tokens for this user
    prisma.passwordResetToken.updateMany({
      where: { userId: row.userId, usedAt: null, id: { not: row.id } },
      data:  { usedAt: now },
    }),
    // Revoke all active sessions — the password just changed
    prisma.session.updateMany({
      where: { userId: row.userId, revokedAt: null },
      data:  { revokedAt: now },
    }),
  ]);
  // Denylist any in-flight access token so the reset signs the user out
  // everywhere immediately (BUGS.md #4), not just on next refresh.
  await revokeUserAccessTokens(row.userId);

  // Security event (§43) — fire-and-forget, must not break the reset flow
  prisma.loginEvent.create({
    data: {
      userId:         row.userId,
      emailAttempted: "",
      success:        true,
      eventType:      "password_change",
      ip:             meta.ip,
      userAgent:      meta.userAgent,
      deviceCookieId: meta.deviceCookieId,
    },
  }).catch(() => null);

  // Notify the user their password changed (§29 auth.password_changed)
  notificationService.dispatch({
    userId:   row.userId,
    type:     "auth.password_changed",
    title:    "Your password was changed",
    body:     "Your account password was just reset. If this wasn't you, contact an administrator immediately.",
    channels: ["in_app", "email"],
  }).catch(() => null);
}
