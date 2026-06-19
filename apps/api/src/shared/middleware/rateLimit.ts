import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis, rkey } from '../../infrastructure/redis';
import { isProd } from '../../config/env';

/**
 * Redis-backed rate limiter (shared store — safe across multiple processes, §55).
 * Responds with NEC-API-4290 + standard Retry-After headers on limit.
 *
 * @param keyGenerator optional — e.g. key by authenticated user id for per-user
 *        limits (place the limiter AFTER requireAuth so req.userId is set).
 */
export const makeRateLimiter = (
  name: string,
  windowMs: number,
  max: number,
  keyGenerator?: Options['keyGenerator'],
) =>
  rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    ...(keyGenerator ? { keyGenerator } : {}),
    store: new RedisStore({
      sendCommand: (...args: string[]) =>
        redis.call(...(args as [string, ...string[]])) as Promise<number>,
      prefix: rkey('rl', name) + ':',
    }),
    handler: (_req, res) =>
      res.status(429).json({ error: { code: 'NEC-API-4290', message: 'Rate limit exceeded' } }),
  });

/** Keys a per-user limiter by authenticated user id, falling back to a
 *  normalized IP key (ipKeyGenerator handles IPv6 subnets safely). */
export const byUserId: Options['keyGenerator'] = (req) =>
  (req as { userId?: string }).userId ?? ipKeyGenerator(req.ip ?? '');

/**
 * Coarse per-IP limiter for all /api traffic (§26: 200/min authenticated,
 * 60/min unauthenticated — "authenticated" detected by a Bearer header).
 * Mounted globally (`app.use`). Skipped outside production and for the
 * installer / health / meta paths (the installer must not depend on Redis,
 * and health/meta are polled). Per-route limiters still apply on top.
 */
export const globalApiLimiter = rateLimit({
  windowMs: 60_000,
  limit: (req) => (req.headers.authorization ? 200 : 60),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
  skip: (req) =>
    !isProd ||
    !req.path.startsWith('/api/') ||
    req.path.startsWith('/api/install') ||
    req.path.startsWith('/api/health') ||
    req.path.startsWith('/api/meta') ||
    // Live style sync: every client (incl. guests) holds an SSE connection to
    // /stream and fetches /css on theme changes. /stream is a long-lived stream
    // (one request that never "completes"); /css is a cheap cached read. /version
    // is the legacy poll endpoint, kept for one-shot checks. None should count
    // against the per-IP budget or a few tabs behind one NAT would 429 the API.
    req.path === '/api/appearance/stream' ||
    req.path === '/api/appearance/version' ||
    req.path === '/api/appearance/css',
  store: new RedisStore({
    sendCommand: (...args: string[]) =>
      redis.call(...(args as [string, ...string[]])) as Promise<number>,
    prefix: rkey('rl', 'api-global') + ':',
  }),
  handler: (_req, res) =>
    res.status(429).json({ error: { code: 'NEC-API-4290', message: 'Rate limit exceeded' } }),
});
