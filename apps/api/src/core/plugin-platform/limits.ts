import type { RequestHandler } from "express";
import type { PluginCache, PluginLimits } from "@xentium/plugin-sdk";
import { redis, rkey } from "../../infrastructure/redis.js";
import { byUserId, makeRateLimiter } from "../../shared/middleware/rateLimit.js";

/**
 * Rate limits and a cache for plugins (`host.limits`, `host.cache`), on the site's
 * Redis, so they hold across every API process. Every key lives under the plugin's
 * own namespace (`pl:<pluginId>:…`): a plugin can never read, fill or reset another
 * plugin's, or core's.
 */

const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const MAX_KEY = 200;
const ns = (pluginId: string, ...parts: string[]) => rkey("pl", pluginId, ...parts);

function checkName(what: string, name: string): void {
  if (!NAME.test(name)) throw new Error(`[plugin ${what}] "${name}" is not a valid name (letters, digits, . _ -; up to 64).`);
}
function checkKey(key: string): void {
  if (typeof key !== "string" || !key || key.length > MAX_KEY) throw new Error(`[plugin cache] keys are 1–${MAX_KEY} characters.`);
}

export function limitsFor(pluginId: string): PluginLimits {
  return {
    middleware(name, opts): RequestHandler {
      checkName("limits", name);
      if (!(opts.windowSec >= 1 && opts.max >= 1)) throw new Error(`[plugin limits] "${name}": windowSec and max must be at least 1.`);
      // Per member (place it after requireAuth), or per IP for guests.
      return makeRateLimiter(`pl:${pluginId}:${name}`, opts.windowSec * 1000, opts.max, opts.by === "ip" ? undefined : byUserId);
    },

    async check(name, key, opts) {
      checkName("limits", name);
      checkKey(key);
      const k = ns(pluginId, "limit", name, key);
      const count = await redis.incr(k);
      if (count === 1) await redis.expire(k, opts.windowSec);
      const ttl = await redis.ttl(k);
      return { ok: count <= opts.max, remaining: Math.max(0, opts.max - count), retryAfterSec: count <= opts.max ? 0 : Math.max(1, ttl) };
    },
  };
}

export function cacheFor(pluginId: string): PluginCache {
  const cache: PluginCache = {
    async get<T>(key: string): Promise<T | null> {
      checkKey(key);
      const raw = await redis.get(ns(pluginId, "cache", key));
      return raw === null ? null : (JSON.parse(raw) as T);
    },
    async set(key, value, ttlSec = 300) {
      checkKey(key);
      const ttl = Math.min(Math.max(1, Math.floor(ttlSec)), 30 * 86_400);
      await redis.set(ns(pluginId, "cache", key), JSON.stringify(value), "EX", ttl);
    },
    async del(key) {
      checkKey(key);
      await redis.del(ns(pluginId, "cache", key));
    },
    async remember<T>(key: string, ttlSec: number, compute: () => Promise<T> | T): Promise<T> {
      const hit = await cache.get<T>(key);
      if (hit !== null) return hit;
      const value = await compute();
      if (value !== null && value !== undefined) await cache.set(key, value, ttlSec);
      return value;
    },
  };
  return cache;
}

/** Uninstall: every key the plugin left in Redis (cache and counters). */
export async function dropPluginKeys(pluginId: string): Promise<void> {
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", `${ns(pluginId)}:*`, "COUNT", 500);
    if (keys.length) await redis.del(...keys);
    cursor = next;
  } while (cursor !== "0");
}
