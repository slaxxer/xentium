/**
 * Profile views — who looked at whose profile.
 *
 * Two counters that answer different questions, deliberately kept apart:
 *
 * - `ncf_profile_views` holds NAMED visitors, one row per pair, refreshed on a
 *   revisit. It is what the rail card lists, and it is pruned on a schedule.
 * - `ncf_users.profile_view_count` is the all-time total INCLUDING guests. It is a
 *   column rather than a count over the table above, because that table is pruned —
 *   counting it would make a profile's total shrink over time.
 *
 * ⚠ A write on a read path. Every guard below exists to keep it from being one write
 * per page load: self-views are skipped, guests never write a row, and a repeat visit
 * inside the throttle window is dropped in Redis before it reaches Postgres.
 */
import crypto from "node:crypto";
import { prisma } from "../../infrastructure/db.js";
import { redis, rkey } from "../../infrastructure/redis.js";
import { env } from "../../config/env.js";
import { storage } from "../../infrastructure/storage/LocalStorageProvider.js";

/**
 * How long a viewer's visit "lasts" before it is recorded again.
 *
 * ⚠ Not a dedup — the row is upserted, so recording twice is harmless. This exists
 * so that reloading a profile, or clicking between its tabs, is not a database write
 * each time. Fifteen minutes is long enough to cover reading a profile and short
 * enough that coming back later still moves the visitor to the top of the card.
 */
const THROTTLE_SECONDS = 15 * 60;

/** All-time totals dedupe per IP, exactly as article views do. */
const TOTAL_SET   = (profileId: string) => rkey("profile", "views", profileId);
const THROTTLE_KEY = (profileId: string, viewerId: string) =>
  rkey("profile", "seen", `${profileId}:${viewerId}`);

function hashIp(ip: string): string {
  return crypto.createHash("sha256").update(ip + env.JWT_SECRET).digest("hex").slice(0, 24);
}

export interface ProfileVisitor {
  id:       string;
  username: string;
  avatar:   string | null;
  viewedAt: string;
}

export interface ProfileVisitorSummary {
  items:     ProfileVisitor[];
  /** Named visitors held for this profile — what "+N" counts beyond `items`. */
  visitors:  number;
  /** Distinct named visitors in the last seven days. */
  thisWeek:  number;
  /** All-time views, guests included. */
  totalViews: number;
  /** The most recent visit, or null when nobody named has been. */
  lastAt:    string | null;
}

/**
 * Record that `viewerId` looked at `profileId`.
 *
 * Returns quietly and does nothing at all when there is nothing worth recording —
 * the caller is a GET handler and must never fail because of this.
 */
export async function recordProfileView(
  profileId: string,
  viewerId: string | undefined,
  ip: string | undefined,
): Promise<void> {
  try {
    // ⚠ The total counts a guest; the visitor list cannot. Both are skipped for the
    // owner — a profile's own author is not a visitor to it.
    if (viewerId && viewerId === profileId) return;

    if (ip) {
      const added = await redis.sadd(TOTAL_SET(profileId), hashIp(ip));
      if (added === 1) {
        await prisma.user.update({
          where: { id: profileId },
          data:  { profileViewCount: { increment: 1 } },
        });
      }
    }

    if (!viewerId) return;

    // Throttled: a reload, or clicking between a profile's tabs, is not a write.
    const fresh = await redis.set(THROTTLE_KEY(profileId, viewerId), "1", "EX", THROTTLE_SECONDS, "NX");
    if (fresh !== "OK") return;

    await prisma.profileView.upsert({
      where:  { profileId_viewerId: { profileId, viewerId } },
      update: { viewedAt: new Date(), visits: { increment: 1 } },
      create: { profileId, viewerId },
    });
  } catch {
    // Recording a visit is never worth failing a profile page over — a Redis blip
    // or a user deleted mid-request must not turn a GET into a 500.
  }
}

/** The rail card's data: who has been here lately, and how many. */
export async function getProfileVisitors(
  profileId: string,
  limit: number,
): Promise<ProfileVisitorSummary> {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);

  const [rows, visitors, thisWeek, owner] = await Promise.all([
    prisma.profileView.findMany({
      where:   { profileId },
      orderBy: { viewedAt: "desc" },
      take:    limit,
      select:  {
        viewedAt: true,
        viewer:   { select: { id: true, username: true, avatar: true } },
      },
    }),
    prisma.profileView.count({ where: { profileId } }),
    prisma.profileView.count({ where: { profileId, viewedAt: { gte: weekAgo } } }),
    prisma.user.findUnique({ where: { id: profileId }, select: { profileViewCount: true } }),
  ]);

  return {
    items: rows.map((r) => ({
      id:       r.viewer.id,
      username: r.viewer.username,
      avatar:   r.viewer.avatar ? storage.publicUrl(r.viewer.avatar) : null,
      viewedAt: r.viewedAt.toISOString(),
    })),
    visitors,
    thisWeek,
    totalViews: owner?.profileViewCount ?? 0,
    // ⚠ From the FIRST row, which is the newest — `orderBy viewedAt desc` is what
    // makes that true, so the two must not drift apart.
    lastAt: rows[0]?.viewedAt.toISOString() ?? null,
  };
}
