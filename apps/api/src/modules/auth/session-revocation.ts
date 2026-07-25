import { redis, rkey } from "../../infrastructure/redis.js";

// Access-token revocation denylist (BUGS.md #4 / audit).
//
// Access JWTs are stateless and live for 15 min (ACCESS_TTL in auth.tokens.ts),
// so deleting a user's DB sessions on ban / deactivate / force-logout / password
// change does NOT stop an already-issued access token — it stays valid until it
// expires. rotateSession() rechecks ban/active on /auth/refresh, which bounds the
// window to the token TTL, but not to *immediate*.
//
// This module adds a short-lived Redis denylist that requireAuth consults on every
// authenticated request, so a revoked token is rejected on its very next call. The
// markers only need to outlive the access token, so they carry a TTL equal to the
// access-token lifetime and self-clean — no growth, no separate reaper.
//
// IMPORTANT: keep ACCESS_TTL_SECONDS in sync with ACCESS_TTL ("15m") in
// auth.tokens.ts. It is intentionally duplicated here to avoid importing the
// token module (and its queue/prisma deps) into the request hot path.
export const ACCESS_TTL_SECONDS = 15 * 60;

const userKey = (userId: string) => rkey("revoked:user", userId);
const sessKey = (sessionId: string) => rkey("revoked:sess", sessionId);

/**
 * Revoke EVERY access token issued for this user before now (ban, deactivate,
 * force-logout, password reset). Tokens minted afterwards — e.g. a fresh login —
 * are unaffected because they carry a later `iat`.
 */
export async function revokeUserAccessTokens(userId: string): Promise<void> {
  await redis.set(userKey(userId), Date.now().toString(), "EX", ACCESS_TTL_SECONDS).catch(() => {});
}

/**
 * Revoke a single session's access token (self-logout, "revoke this session",
 * "change password" for the non-current sessions). Scoped by session id so the
 * caller's own session can be left untouched.
 */
export async function revokeSessionAccessToken(sessionId: string): Promise<void> {
  await redis.set(sessKey(sessionId), "1", "EX", ACCESS_TTL_SECONDS).catch(() => {});
}

/**
 * True if the presented access token has been revoked — either its specific
 * session is denylisted, or the user was revoked at/after the token was issued.
 * `issuedAtMs` is the token's issue time in milliseconds (the `ims` claim), for
 * exact ordering against the millisecond revocation timestamp. One MGET per call.
 */
export async function isAccessTokenRevoked(
  userId: string,
  sessionId: string,
  issuedAtMs: number | undefined,
): Promise<boolean> {
  const [userTs, sessFlag] = await redis.mget(userKey(userId), sessKey(sessionId));
  if (sessFlag) return true;
  if (userTs && issuedAtMs !== undefined && issuedAtMs < Number(userTs)) return true;
  return false;
}
