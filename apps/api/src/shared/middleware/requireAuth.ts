/**
 * The CMS's binding of the framework request guards (`@xentium/auth`).
 *
 * The package owns Bearer parsing, verification, the revocation check and the
 * XEC error shapes. This file supplies the verifier, the denylist, and the one
 * thing that is purely this application's: online-presence tracking.
 */
import { createAuthMiddleware, unauthenticatedError, invalidTokenError } from "@xentium/auth";
import { verifyAccess } from "../../modules/auth/auth.tokens.js";
import { isAccessTokenRevoked } from "../../modules/auth/session-revocation.js";
import { redis, rkey } from "../../infrastructure/redis.js";
import { prisma } from "../../infrastructure/db.js";

const ONLINE_TTL_MS = 5 * 60 * 1000; // 5 minutes
/** How often a member's stored "last seen" is written: once per window, not per request. */
const LAST_SEEN_EVERY_S = 5 * 60;

const { requireAuth, optionalAuth } = createAuthMiddleware({
  verifyAccess,
  isAccessTokenRevoked,
  // Fire-and-forget: online presence sorted set (score = timestamp).
  onAuthenticated: (userId) => {
    redis.zadd(rkey("online:users"), Date.now(), userId).catch(() => {});
    // "Last seen" survives a sign-out, so it lives on the account. The Redis key lets one
    // request per window through; the rest skip the write.
    redis.set(rkey(`lastseen:${userId}`), "1", "EX", LAST_SEEN_EVERY_S, "NX")
      .then((first) => (first ? prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date() } }) : null))
      .catch(() => {});
  },
});

export { requireAuth, optionalAuth, unauthenticatedError, invalidTokenError, ONLINE_TTL_MS };
