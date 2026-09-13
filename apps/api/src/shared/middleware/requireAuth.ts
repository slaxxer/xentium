/**
 * The CMS's binding of the framework request guards (`@xentium/auth`).
 *
 * The package owns Bearer parsing, verification, the revocation check and the
 * NEC error shapes. This file supplies the verifier, the denylist, and the one
 * thing that is purely this application's: online-presence tracking.
 */
import { createAuthMiddleware, unauthenticatedError, invalidTokenError } from "@xentium/auth";
import { verifyAccess } from "../../modules/auth/auth.tokens.js";
import { isAccessTokenRevoked } from "../../modules/auth/session-revocation.js";
import { redis, rkey } from "../../infrastructure/redis.js";

const ONLINE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const { requireAuth, optionalAuth } = createAuthMiddleware({
  verifyAccess,
  isAccessTokenRevoked,
  // Fire-and-forget: online presence sorted set (score = timestamp).
  onAuthenticated: (userId) => {
    redis.zadd(rkey("online:users"), Date.now(), userId).catch(() => {});
  },
});

export { requireAuth, optionalAuth, unauthenticatedError, invalidTokenError, ONLINE_TTL_MS };
