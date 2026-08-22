import { SignJWT, jwtVerify } from "jose";
import crypto from "node:crypto";

/**
 * Access-token lifetime. Exported because the revocation denylist's markers
 * only need to outlive an access token — before the extraction that constant
 * was duplicated in the revocation module with a comment explaining that
 * importing the token module would drag Prisma and BullMQ onto the request hot
 * path. A framework package has neither, so there is one constant again.
 */
export const ACCESS_TTL_SECONDS = 15 * 60;

export const REFRESH_TTL_DAYS = 30;

export interface AccessClaims {
  userId: string;
  sessionId: string;
  /** Issue time in MILLISECONDS. See `ims` below. */
  issuedAtMs: number | undefined;
}

export interface TokenServiceOptions {
  /**
   * Symmetric signing secret for access tokens (HS256).
   *
   * NOTE: §43 describes RS256. The implementation this was extracted from signs
   * HS256 with a shared secret, and that behaviour is preserved verbatim here —
   * changing the algorithm during a refactor would invalidate every access token
   * in flight. The spec/code divergence is real and wants resolving separately.
   */
  accessSecret: string;
  /**
   * Keyed (HMAC) hash for refresh tokens (§43/§17b) — an attacker who reads the
   * database without the secret cannot confirm or derive tokens. Applications
   * that have not provisioned a dedicated secret may pass the access secret.
   */
  refreshHmacSecret: string;
  /** Override for tests. Defaults to ACCESS_TTL_SECONDS. */
  accessTtlSeconds?: number;
}

export interface TokenService {
  /** Mint an access token for a user's session. */
  issueAccess(userId: string, sessionId: string): Promise<string>;
  /** Verify and decode an access token. Throws when the signature is bad. */
  verifyAccess(token: string): Promise<AccessClaims>;
  /** A fresh, unguessable refresh token. Store only its hash. */
  generateRefreshToken(): string;
  /** The stored form of a refresh token. */
  hashRefreshToken(raw: string): string;
  /** Expiry for a refresh token minted now. */
  refreshExpiryFrom(now?: Date): Date;
}

export function createTokenService(opts: TokenServiceOptions): TokenService {
  const secret = new TextEncoder().encode(opts.accessSecret);
  const ttl = opts.accessTtlSeconds ?? ACCESS_TTL_SECONDS;
  const hmacKey = opts.refreshHmacSecret;

  return {
    async issueAccess(userId, sessionId) {
      // `ims` = issued-at in MILLISECONDS. The standard `iat` claim is only
      // second-granular, which makes the revocation denylist ambiguous for a
      // token minted in the same second as a revocation. `ims` gives the check
      // exact ordering.
      return new SignJWT({ sid: sessionId, ims: Date.now() })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(userId)
        .setIssuedAt()
        .setExpirationTime(`${ttl}s`)
        .sign(secret);
    },

    async verifyAccess(token) {
      const { payload } = await jwtVerify(token, secret);
      // Prefer the millisecond `ims` claim; fall back to `iat` seconds for any
      // token minted before `ims` existed (bounded by the access-token lifetime).
      const issuedAtMs =
        (payload.ims as number | undefined) ??
        (payload.iat !== undefined ? payload.iat * 1000 : undefined);
      return {
        userId: payload.sub as string,
        sessionId: payload.sid as string,
        issuedAtMs,
      };
    },

    generateRefreshToken() {
      return crypto.randomBytes(32).toString("base64url");
    },

    hashRefreshToken(raw) {
      return crypto.createHmac("sha256", hmacKey).update(raw).digest("hex");
    },

    refreshExpiryFrom(now = new Date()) {
      return new Date(now.getTime() + REFRESH_TTL_DAYS * 864e5);
    },
  };
}
