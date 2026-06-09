import crypto from "node:crypto";
import { prisma } from "../../infrastructure/db.js";
import { redis, rkey } from "../../infrastructure/redis.js";
import { env } from "../../config/env.js";

/**
 * Per-IP view tracking with Redis-backed dedup.
 *
 * For each article we keep a Redis SET of SHA-256(ip + JWT_SECRET) hashes.
 * SADD returns 1 only the first time a given hash is added; we increment
 * articles.view_count exactly when SADD reports a new member. No TTL —
 * one IP counts once per article forever.
 *
 * Hashing the IP (salted with the server's existing JWT secret) avoids
 * persisting raw addresses while still giving stable per-IP dedup.
 */

const VIEWS_SET = (articleId: string) => rkey("article", "views", articleId);

function hashIp(ip: string): string {
  return crypto
    .createHash("sha256")
    .update(ip + env.JWT_SECRET)
    .digest("hex")
    .slice(0, 24);
}

/** Returns true if this IP's hit was new and the counter was incremented. */
export async function trackArticleView(articleId: string, ip: string | undefined): Promise<boolean> {
  if (!ip) return false;
  const hash = hashIp(ip);
  const added = await redis.sadd(VIEWS_SET(articleId), hash);
  if (added !== 1) return false;
  await prisma.article.update({
    where: { id: articleId },
    data: { viewCount: { increment: 1 } },
  });
  return true;
}
