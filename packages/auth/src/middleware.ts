import type { Request, RequestHandler } from "express";
import { NEC } from "@nodevo/contracts";
import { NodevoError } from "@nodevo/errors";
import type { AccessClaims } from "./tokens.js";

/**
 * Fields the middleware sets. Declared locally because each application
 * augments Express itself — a framework package must not require any particular
 * augmentation to exist (ADR-0006).
 */
type AuthedRequest = Request & { userId?: string; sessionId?: string };

export interface AuthMiddlewareDeps {
  verifyAccess(token: string): Promise<AccessClaims>;
  /**
   * Consulted on every authenticated request. Omit it and only the signature is
   * checked — which means a revoked token stays usable until it expires, so
   * omit it deliberately.
   */
  isAccessTokenRevoked?(
    userId: string,
    sessionId: string,
    issuedAtMs: number | undefined,
  ): Promise<boolean>;
  /**
   * Fire-and-forget hook after a successful `requireAuth` — Nodevo's CMS uses it
   * for online-presence tracking. It must not throw and is never awaited.
   */
  onAuthenticated?(userId: string, req: Request): void;
}

/**
 * Expected high-frequency rejections — guests hitting a protected route, and the
 * 15-minute token expiry every client rides into. Canonical NEC shape, but
 * `persist: false` keeps them out of the error log, where they would otherwise
 * drown everything worth reading.
 */
export function unauthenticatedError() {
  return new NodevoError({
    code: NEC.AUTH_UNAUTHENTICATED,
    httpStatus: 401,
    message: "Authentication required",
    persist: false,
  });
}

export function invalidTokenError() {
  return new NodevoError({
    code: NEC.AUTH_TOKEN_INVALID,
    httpStatus: 401,
    message: "Invalid or expired token",
    persist: false,
  });
}

/**
 * Behaviour preserved from before the extraction, including its leniency: a
 * header with no "Bearer " prefix is passed through as the token rather than
 * refused. Every first-party client sends the prefix, so this only matters to a
 * third-party caller that does not — which is exactly why tightening it belongs
 * in its own change rather than smuggled into a refactor.
 */
const bearer = (req: Request): string | undefined =>
  req.headers.authorization?.replace("Bearer ", "") || undefined;

export function createAuthMiddleware(deps: AuthMiddlewareDeps): {
  requireAuth: RequestHandler;
  optionalAuth: RequestHandler;
} {
  const { verifyAccess, isAccessTokenRevoked, onAuthenticated } = deps;

  const requireAuth: RequestHandler = async (req, _res, next) => {
    const token = bearer(req);
    if (!token) throw unauthenticatedError();

    let claims: AccessClaims;
    try {
      claims = await verifyAccess(token);
    } catch {
      throw invalidTokenError();
    }

    // Immediate revocation: the signature can be perfectly valid while the
    // session or the whole user has been revoked since it was issued — ban,
    // deactivate, force-logout, password change, self-logout.
    if (
      isAccessTokenRevoked &&
      (await isAccessTokenRevoked(claims.userId, claims.sessionId, claims.issuedAtMs))
    ) {
      throw invalidTokenError();
    }

    const r = req as AuthedRequest;
    r.userId = claims.userId;
    r.sessionId = claims.sessionId;

    onAuthenticated?.(claims.userId, req);

    next();
  };

  /**
   * Soft authentication: attach identity when a valid token is present, and
   * carry on silently when it is not. For endpoints whose behaviour varies by
   * viewer without requiring one — a public profile, a privacy-filtered read.
   *
   * Deliberately does NOT consult the denylist: a revoked token here degrades to
   * anonymous rather than to an error, which is the same outcome by a cheaper
   * path. Anything that must reject a revoked token belongs behind `requireAuth`.
   */
  const optionalAuth: RequestHandler = async (req, _res, next) => {
    const token = bearer(req);
    if (!token) return next();
    try {
      const { userId, sessionId } = await verifyAccess(token);
      const r = req as AuthedRequest;
      r.userId = userId;
      r.sessionId = sessionId;
    } catch {
      // Ignore an invalid token — treat the caller as anonymous.
    }
    next();
  };

  return { requireAuth, optionalAuth };
}
