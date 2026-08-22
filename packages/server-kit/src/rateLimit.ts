import rateLimit, { ipKeyGenerator, type Options } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import type { RequestHandler } from "express";
import { NEC } from "@nodevo/contracts";

/**
 * The one Redis call the limiter store makes. Declared structurally so the
 * package does not depend on a particular client library — ioredis satisfies it
 * as-is.
 */
export interface RateLimitRedis {
  call(...args: [string, ...string[]]): unknown;
}

export interface RateLimiterDeps {
  redis: RateLimitRedis;
  /**
   * Namespaces the counter keys. Applications sharing one Redis MUST supply
   * distinct prefixes, or they share rate-limit budgets — Nodevo's own pass
   * their `rkey` helper.
   */
  keyPrefix: (name: string) => string;
}

export interface RateLimiterOptions {
  windowMs: number;
  /** A number, or a function of the request for per-caller ceilings. */
  limit: Options["limit"];
  keyGenerator?: Options["keyGenerator"];
  skip?: Options["skip"];
}

/**
 * Keys a per-user limiter by authenticated user id, falling back to a
 * normalized IP key (`ipKeyGenerator` handles IPv6 subnets safely). Place the
 * limiter AFTER authentication so the id is populated.
 */
export const byUserId: Options["keyGenerator"] = (req) =>
  (req as { userId?: string }).userId ?? ipKeyGenerator(req.ip ?? "");

/**
 * Redis-backed rate limiting with a shared store, so limits hold across every
 * process rather than per-instance. Responds with NEC-API-4290 and standard
 * `draft-7` headers.
 *
 * Returns a factory rather than a limiter: an application builds as many as it
 * needs from one set of dependencies.
 */
export function createRateLimiterFactory(deps: RateLimiterDeps) {
  const { redis, keyPrefix } = deps;

  return function makeRateLimiter(name: string, opts: RateLimiterOptions): RequestHandler {
    return rateLimit({
      windowMs: opts.windowMs,
      limit: opts.limit,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      ...(opts.keyGenerator ? { keyGenerator: opts.keyGenerator } : {}),
      ...(opts.skip ? { skip: opts.skip } : {}),
      store: new RedisStore({
        sendCommand: (...args: string[]) =>
          redis.call(...(args as [string, ...string[]])) as Promise<number>,
        prefix: keyPrefix(name) + ":",
      }),
      handler: (_req, res) =>
        res.status(429).json({ error: { code: NEC.API_RATE_LIMIT, message: "Rate limit exceeded" } }),
    });
  };
}

export { ipKeyGenerator };
