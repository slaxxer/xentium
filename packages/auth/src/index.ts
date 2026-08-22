/**
 * @nodevo/auth — the authentication PRIMITIVES shared by every Nodevo-framework
 * application (ADR-0006): token minting and verification, password hashing,
 * the access-token revocation denylist, and the two request guards.
 *
 * Deliberately NOT here: the login flow. Sessions, bans, lockout, login events,
 * email verification and permission checks all read an application's own tables
 * and enforce its own rules, so `createSession` / `rotateSession` / `login` stay
 * in the application that owns those concepts.
 *
 * That split answers ADR-0006's open question about a "principal shape" by
 * dissolving it: nothing here ever sees a user record. A user is an opaque id.
 */
export { createTokenService, ACCESS_TTL_SECONDS, REFRESH_TTL_DAYS } from "./tokens.js";
export type { AccessClaims, TokenService, TokenServiceOptions } from "./tokens.js";

export { hashPassword, verifyPassword } from "./password.js";
export { isLegacyScheme, verifyLegacyPassword } from "./legacyPassword.js";
export type { LegacyPasswordScheme } from "./legacyPassword.js";

export { createRevocationList } from "./revocation.js";
export type { RevocationList, RevocationOptions, RevocationRedis } from "./revocation.js";

export { createAuthMiddleware, unauthenticatedError, invalidTokenError } from "./middleware.js";
export type { AuthMiddlewareDeps } from "./middleware.js";
