/**
 * system.recompute-counters — repair drifted denormalized counters.
 *
 * Every counter here is maintained incrementally at write time, so any bug in an
 * increment/decrement path leaves permanent drift that a one-off backfill
 * migration has to chase. Two such bugs shipped in the article-comment paths
 * alone (a pending comment decrementing a count it never incremented, and the
 * moderator-side delete maintaining none), plus `comment_count` needed a
 * backfill when it was introduced. Running this on a schedule turns each of
 * those from "write another migration" into "self-heals overnight".
 *
 * Idempotent and safe to run any time: each statement recomputes from the source
 * rows and writes only where the stored value differs.
 *
 * NOT recomputed — deliberately:
 *  - `post_count` / `thread_count` on xcf_users are FORUM-populated. Core does
 *    not know forum schema and the forum owns its own scheduling, so the forum
 *    ships its own repair. Recomputing them here would zero them.
 *  - `view_count` on articles is telemetry, not derivable from any source table.
 *
 * SEMANTIC NOTE — `article_count`: the write path increments on first publish
 * and never decrements (not on unpublish, not on delete), so "articles ever
 * published" is not derivable from current state. This recomputes it as
 * "currently published and not deleted", which is the only derivable reading and
 * the sane one for progression. Users who deleted published articles will see
 * this value fall. It cannot demote anyone — promotion is one-way — but it can
 * delay a future promotion. Use dry-run first on an established site.
 */
import { z } from "zod";
import { prisma } from "../../infrastructure/db.js";
import { registerScheduledAction, type ActionResult, type ActionRunCtx } from "./action-registry.js";

const paramsSchema = z.object({});

/** One repairable counter: a SELECT that yields (id, correct) and the target. */
interface CounterRepair {
  label:  string;
  table:  string;
  column: string;
  /** Correlated subquery producing the correct value for row `t`. */
  correct: string;
}

const REPAIRS: CounterRepair[] = [
  {
    label: "users.article_count", table: "xcf_users", column: "article_count",
    correct: `(SELECT COUNT(*) FROM xcf_articles a
                WHERE a.author_id = t.id AND a.deleted_at IS NULL AND a.status = 'published')`,
  },
  {
    label: "users.comment_count", table: "xcf_users", column: "comment_count",
    correct: `(SELECT COUNT(*) FROM xcf_article_comments c
                WHERE c.author_id = t.id AND c.deleted_at IS NULL AND c.status = 'published')`,
  },
  {
    // Three independent sources feed this one at write time: likes on the user's
    // articles, on their article comments, and on their profile comments.
    label: "users.like_count_received", table: "xcf_users", column: "like_count_received",
    correct: `(
      (SELECT COUNT(*) FROM xcf_article_likes al
         JOIN xcf_articles a ON a.id = al.article_id
        WHERE a.author_id = t.id AND a.deleted_at IS NULL)
    + (SELECT COUNT(*) FROM xcf_article_comment_likes cl
         JOIN xcf_article_comments c ON c.id = cl.comment_id
        WHERE c.author_id = t.id AND c.deleted_at IS NULL)
    + (SELECT COUNT(*) FROM xcf_profile_comment_likes pl
         JOIN xcf_profile_comments p ON p.id = pl.comment_id
        WHERE p.author_id = t.id AND p.deleted_at IS NULL)
    )`,
  },
  {
    label: "users.follower_count", table: "xcf_users", column: "follower_count",
    correct: `(SELECT COUNT(*) FROM xcf_user_follows f WHERE f.following_id = t.id)`,
  },
  {
    label: "users.following_count", table: "xcf_users", column: "following_count",
    correct: `(SELECT COUNT(*) FROM xcf_user_follows f WHERE f.follower_id = t.id)`,
  },
  {
    label: "articles.comment_count", table: "xcf_articles", column: "comment_count",
    correct: `(SELECT COUNT(*) FROM xcf_article_comments c
                WHERE c.article_id = t.id AND c.deleted_at IS NULL AND c.status = 'published')`,
  },
  {
    label: "articles.like_count", table: "xcf_articles", column: "like_count",
    correct: `(SELECT COUNT(*) FROM xcf_article_likes al WHERE al.article_id = t.id)`,
  },
  {
    label: "articles.dislike_count", table: "xcf_articles", column: "dislike_count",
    correct: `(SELECT COUNT(*) FROM xcf_article_dislikes ad WHERE ad.article_id = t.id)`,
  },
  // NOTE: xcf_article_comments has NO like_count column — article-comment likes
  // are counted live from the join table (`_count: { likes: true }`). Nothing to
  // repair there, which is the ideal case: a counter that cannot drift.
  {
    label: "profile_comments.like_count", table: "xcf_profile_comments", column: "like_count",
    correct: `(SELECT COUNT(*) FROM xcf_profile_comment_likes pl WHERE pl.comment_id = t.id)`,
  },
];

/** Rows whose stored counter disagrees with the recomputed value. */
async function countDrift(r: CounterRepair): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*)::bigint AS n FROM "${r.table}" t WHERE t."${r.column}" <> ${r.correct}`,
  );
  return Number(rows[0]?.n ?? 0);
}

async function repair(r: CounterRepair): Promise<number> {
  return prisma.$executeRawUnsafe(
    `UPDATE "${r.table}" t SET "${r.column}" = ${r.correct} WHERE t."${r.column}" <> ${r.correct}`,
  );
}

export async function runRecomputeCounters(
  _params: unknown,
  ctx: ActionRunCtx,
): Promise<ActionResult> {
  const drifted: string[] = [];
  let changed = 0;

  for (const r of REPAIRS) {
    // Dry-run counts the same predicate the UPDATE would use, so the reported
    // number is exactly what a real run would write.
    const n = ctx.dryRun ? await countDrift(r) : await repair(r);
    if (n > 0) {
      drifted.push(`${r.label}: ${n}`);
      if (!ctx.dryRun) changed += n;
    }
  }

  if (drifted.length === 0) {
    return { changed: 0, summary: `All ${REPAIRS.length} counters consistent — nothing to repair.` };
  }
  const verb = ctx.dryRun ? "would repair" : "repaired";
  return {
    changed,
    summary: `${verb} ${drifted.reduce((s, d) => s + Number(d.split(": ")[1]), 0)} row(s) — ${drifted.join(", ")}.`,
  };
}

registerScheduledAction({
  key:         "system.recompute-counters",
  label:       "Recompute counters",
  description:
    "Recomputes denormalized counters (article/comment/like/follower counts) from their source rows " +
    "and repairs any drift. Idempotent and non-destructive. Does not touch forum post/thread counts " +
    "(owned by the forum plugin) or article view counts (telemetry, not derivable).",
  domain:      "System",
  params:      paramsSchema,
  minIntervalSec: 60 * 60,   // full-table scans; hourly is already generous
  run:         runRecomputeCounters,
});
