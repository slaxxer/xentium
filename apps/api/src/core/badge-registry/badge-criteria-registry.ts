/**
 * What a badge can be earned FOR.
 *
 * Core measures what core knows about — articles, comments, likes received,
 * followers. Anything else is a plugin's business: the forum contributes posts and
 * threads, and core neither queries `forum_posts` nor knows it exists. Same split as
 * `progression-criteria-registry`, `stat-registry` and `search-registry`.
 *
 * ⚠ NOT `ProgressionCriteria`, deliberately. That one is shaped
 * `evaluate(userId, groupId)` — the plugin reads its OWN per-group thresholds and
 * answers yes/no. A badge's thresholds live on the BADGE, so the plugin's job here is
 * only to report a NUMBER and let core compare it. Reusing the group-shaped interface
 * would have meant storing badge thresholds inside every plugin.
 *
 * ⚠ A metric whose plugin is disabled simply disappears: the admin's stored threshold
 * stays in the badge's JSON untouched, is not evaluated while the plugin is gone, and
 * starts counting again when it comes back. Silently dropping the threshold instead
 * would destroy configuration on a routine disable.
 */
import { prisma } from "../../infrastructure/db.js";

export interface BadgeMetric {
  /** Unique and stable; a plugin's own are namespaced, e.g. `forum.posts`. */
  key: string;
  /** Doubles as a translation key and as the fallback text, so keep it readable. */
  label: string;
  /** This member's current value for the metric. */
  valueFor(userId: string): Promise<number>;
}

interface Entry { pluginId: string | null; metric: BadgeMetric }

class BadgeCriteriaRegistry {
  private entries = new Map<string, Entry>();

  /** `pluginId: null` marks a core metric, which nothing can deregister. */
  register(pluginId: string | null, metric: BadgeMetric): void {
    this.entries.set(metric.key, { pluginId, metric });
  }

  deregister(pluginId: string): void {
    for (const [key, e] of this.entries) if (e.pluginId === pluginId) this.entries.delete(key);
  }

  /** Everything currently measurable — what the ACP offers as thresholds. */
  getAll(): BadgeMetric[] {
    return [...this.entries.values()].map((e) => e.metric);
  }

  get(key: string): BadgeMetric | undefined {
    return this.entries.get(key)?.metric;
  }

  /**
   * Does this member meet EVERY threshold on the badge?
   *
   * ⚠ ALL, never any — a list of requirements reads that way, and a badge called
   * "10 articles" that someone got for likes alone confuses everyone who sees it.
   * ⚠ A badge with the reward system on and NO thresholds set is not earnable by
   * anyone: `every` over an empty list is true, which would hand the badge to the
   * entire membership on the first sweep.
   * ⚠ An unknown key — a plugin that is disabled or gone — is skipped, not failed.
   * The alternative is that disabling the forum silently awards every forum badge.
   */
  async meets(userId: string, criteria: Record<string, number>): Promise<boolean> {
    const wanted = Object.entries(criteria).filter(([, need]) => Number(need) > 0);
    if (wanted.length === 0) return false;

    const checks = await Promise.all(
      wanted.map(async ([key, need]) => {
        const metric = this.get(key);
        if (!metric) return null;               // plugin absent — not a failure
        try {
          return (await metric.valueFor(userId)) >= Number(need);
        } catch {
          return false;                          // a broken source never awards
        }
      }),
    );

    const evaluated = checks.filter((c): c is boolean => c !== null);
    // Every threshold belonged to an absent plugin: nothing was actually tested.
    if (evaluated.length === 0) return false;
    return evaluated.every(Boolean);
  }
}

export const badgeCriteriaRegistry = new BadgeCriteriaRegistry();

/**
 * Core's own metrics — the four counters `ncf_users` already maintains, so a sweep
 * costs one row read per member rather than four aggregate queries.
 */
const coreCounter = (key: string, label: string, column: "articleCount" | "commentCount" | "likeCountReceived" | "followerCount"): BadgeMetric => ({
  key, label,
  async valueFor(userId) {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { [column]: true } as never });
    return (u as Record<string, number> | null)?.[column] ?? 0;
  },
});

export function registerCoreBadgeMetrics(): void {
  badgeCriteriaRegistry.register(null, coreCounter("articles",  "articles",  "articleCount"));
  badgeCriteriaRegistry.register(null, coreCounter("comments",  "comments",  "commentCount"));
  badgeCriteriaRegistry.register(null, coreCounter("likes",     "likes received", "likeCountReceived"));
  badgeCriteriaRegistry.register(null, coreCounter("followers", "followers", "followerCount"));
}
