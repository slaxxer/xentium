/**
 * The CMS's binding of the framework rate limiter (`@xentium/server-kit`).
 *
 * The factory is framework — a Redis-backed store, XEC-API-4290, draft-7
 * headers. `globalApiLimiter` is NOT: its skip list names this application's
 * routes, which is exactly the kind of knowledge a framework package may not
 * hold (ADR-0006).
 */
import { createHash } from "node:crypto";
import type { Options } from "express-rate-limit";
import { createRateLimiterFactory, byUserId, ipKeyGenerator } from "@xentium/server-kit";
import { redis, rkey } from "../../infrastructure/redis.js";
import { isProd } from "../../config/env.js";

const factory = createRateLimiterFactory({ redis, keyPrefix: (name) => rkey("rl", name) });

export { byUserId };

/**
 * Positional signature kept from before the extraction so the 12 call sites are
 * unchanged.
 *
 * @param keyGenerator optional — e.g. `byUserId` for per-user limits (place the
 *        limiter AFTER requireAuth so req.userId is set).
 */
export const makeRateLimiter = (
  name: string,
  windowMs: number,
  max: number,
  keyGenerator?: Options["keyGenerator"],
) => factory(name, { windowMs, limit: max, ...(keyGenerator ? { keyGenerator } : {}) });

/**
 * Coarse limiter for all /api traffic (§26, raised 2026-10-17: 600/min per
 * authenticated SESSION, 300/min per unauthenticated IP — the SPA's polling
 * widgets make 60 too tight). Mounted globally. Skipped outside production and
 * for the installer / health / meta paths (the installer must not depend on
 * Redis, and health/meta are polled). Per-route limiters still apply on top.
 *
 * Keying: authenticated requests count per TOKEN (hashed), not per IP — with
 * one shared per-IP counter, an authed tab's traffic pushed the count past the
 * guest ceiling and 429'd every guest request from the same IP/NAT (the limit
 * callback varies per request but the counter did not).
 */
export const globalApiLimiter = factory("api-global", {
  windowMs: 60_000,
  // One page asks the API ~25-35 times (layout, stats, feeds, presence…), so 120 a
  // minute let a guest who opened five pages, or a few people behind one router,
  // run into 429s. Raised 2026-10-17; per-route limiters still guard the costly ones.
  limit: (req) => (req.headers.authorization ? 600 : 300),
  keyGenerator: (req) =>
    req.headers.authorization
      ? "tok:" + createHash("sha256").update(req.headers.authorization).digest("hex").slice(0, 32)
      : "ip:" + ipKeyGenerator(req.ip ?? ""),
  skip: (req) =>
    !isProd ||
    !req.path.startsWith("/api/") ||
    req.path.startsWith("/api/install") ||
    req.path.startsWith("/api/health") ||
    req.path.startsWith("/api/meta") ||
    // Live style sync: every client (incl. guests) holds an SSE connection to
    // /stream and fetches /css on theme changes. /stream is a long-lived stream
    // (one request that never "completes"); /css is a cheap cached read. /version
    // is the legacy poll endpoint, kept for one-shot checks. None should count
    // against the per-IP budget or a few tabs behind one NAT would 429 the API.
    req.path === "/api/appearance/stream" ||
    req.path === "/api/appearance/version" ||
    req.path === "/api/appearance/css",
});
