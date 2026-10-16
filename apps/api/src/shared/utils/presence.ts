import { redis, rkey } from "../../infrastructure/redis.js";
import { ONLINE_TTL_MS } from "../middleware/requireAuth.js";

/**
 * The set of user IDs currently considered online — read from the Redis
 * `online:users` sorted set (last-seen timestamp as score), pruning stale
 * entries first. Fails closed (empty set) if Redis is unavailable.
 */
/** Whether one member is online now — the same window as `getOnlineUserIds`. Fails closed. */
export async function isUserOnline(userId: string): Promise<boolean> {
  try {
    const seen = await redis.zscore(rkey("online:users"), userId);
    return seen !== null && Number(seen) >= Date.now() - ONLINE_TTL_MS;
  } catch {
    return false;
  }
}

export async function getOnlineUserIds(): Promise<Set<string>> {
  try {
    const since = Date.now() - ONLINE_TTL_MS;
    await redis.zremrangebyscore(rkey("online:users"), 0, since);
    const ids = await redis.zrangebyscore(rkey("online:users"), since, "+inf");
    return new Set(ids);
  } catch {
    return new Set();
  }
}
