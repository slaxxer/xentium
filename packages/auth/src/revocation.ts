import { ACCESS_TTL_SECONDS } from "./tokens.js";

/**
 * The three Redis commands the denylist needs, declared structurally so the
 * package does not depend on a particular client. ioredis satisfies it as-is.
 */
export interface RevocationRedis {
  set(key: string, value: string, mode: "EX", ttl: number): Promise<unknown>;
  mget(...keys: string[]): Promise<(string | null)[]>;
}

export interface RevocationOptions {
  redis: RevocationRedis;
  /** Namespaces the keys. Applications sharing a Redis MUST differ here. */
  keyPrefix: (...parts: string[]) => string;
  /** Marker lifetime. Defaults to the access-token lifetime, which is the point. */
  ttlSeconds?: number;
}

export interface RevocationList {
  /**
   * Revoke EVERY access token issued for this user before now — ban, deactivate,
   * force-logout, password reset. Tokens minted afterwards (a fresh login) are
   * unaffected, because they carry a later issue time.
   */
  revokeUserAccessTokens(userId: string): Promise<void>;
  /**
   * Revoke a single session's access token — self-logout, "revoke this session",
   * "change password" for the other sessions. Scoped by session so the caller's
   * own session can be left alone.
   */
  revokeSessionAccessToken(sessionId: string): Promise<void>;
  /** True if the presented token has been revoked. One MGET per call. */
  isAccessTokenRevoked(
    userId: string,
    sessionId: string,
    issuedAtMs: number | undefined,
  ): Promise<boolean>;
}

/**
 * Access-token revocation denylist.
 *
 * Access tokens are stateless and live for 15 minutes, so deleting a user's
 * sessions on ban / deactivate / force-logout / password change does NOT stop an
 * already-issued token — it stays valid until it expires. Rechecking on refresh
 * bounds the window to the token TTL, but not to *immediate*.
 *
 * This denylist is consulted on every authenticated request, so a revoked token
 * is rejected on its very next call. Markers only need to outlive an access
 * token, so they carry that TTL and self-clean — no growth, no reaper.
 */
export function createRevocationList(opts: RevocationOptions): RevocationList {
  const { redis, keyPrefix } = opts;
  const ttl = opts.ttlSeconds ?? ACCESS_TTL_SECONDS;

  const userKey = (userId: string) => keyPrefix("revoked:user", userId);
  const sessKey = (sessionId: string) => keyPrefix("revoked:sess", sessionId);

  return {
    async revokeUserAccessTokens(userId) {
      // Never throw: a revocation that cannot reach Redis must not break the
      // ban/logout it accompanies. The refresh-time recheck still bounds it.
      await redis.set(userKey(userId), Date.now().toString(), "EX", ttl).catch(() => {});
    },

    async revokeSessionAccessToken(sessionId) {
      await redis.set(sessKey(sessionId), "1", "EX", ttl).catch(() => {});
    },

    async isAccessTokenRevoked(userId, sessionId, issuedAtMs) {
      const [userTs, sessFlag] = await redis.mget(userKey(userId), sessKey(sessionId));
      if (sessFlag) return true;
      if (userTs && issuedAtMs !== undefined && issuedAtMs < Number(userTs)) return true;
      return false;
    },
  };
}
