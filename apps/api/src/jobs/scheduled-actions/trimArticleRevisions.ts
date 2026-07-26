/**
 * system.trim-article-revisions — keep only the newest N revisions per article.
 *
 * ncf_article_revisions stores a full copy of the title and the ProseMirror body
 * on every save, and nothing ever removes one. An article edited daily for a year
 * carries 365 full copies of itself. The tail of that history is worth very
 * little — nobody restores the 200th-newest draft — but it is the bulk of the
 * table.
 *
 * Non-destructive in the way that matters: the newest `keep` revisions are always
 * retained, so undo depth is bounded, never removed. The current article body
 * lives in ncf_articles and is not a revision, so trimming to keep=1 still cannot
 * lose the live content.
 */
import { z } from "zod";
import { prisma } from "../../infrastructure/db.js";
import { registerScheduledAction, type ActionResult, type ActionRunCtx } from "./action-registry.js";

const paramsSchema = z.object({
  keep: z
    .number().int().min(1).max(500).default(20)
    .meta({
      title:       "Revisions to keep",
      description: "How many of the most recent revisions to keep for each article. Older ones are removed.",
    }),
});
type Params = z.infer<typeof paramsSchema>;

/** Revisions beyond the newest `keep` of their own article. One window function
 *  rather than a query per article — the count of articles is unbounded. */
const OVER_LIMIT = (keep: number) => `
  SELECT id FROM (
    SELECT id, row_number() OVER (PARTITION BY article_id ORDER BY created_at DESC) AS rn
      FROM ncf_article_revisions
  ) ranked
  WHERE rn > ${keep}`;

export async function runTrimArticleRevisions(
  params: Params,
  ctx: ActionRunCtx,
): Promise<ActionResult> {
  // `keep` is a validated integer (Zod, 1..500) — never interpolated user text.
  const sql = OVER_LIMIT(params.keep);

  if (ctx.dryRun) {
    const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*)::bigint AS n FROM (${sql}) t`,
    );
    const n = Number(rows[0]?.n ?? 0);
    return {
      changed: 0,
      summary: n === 0
        ? `No article has more than ${params.keep} revisions.`
        : `would delete ${n} revision(s) beyond the newest ${params.keep} per article.`,
    };
  }

  const deleted = await prisma.$executeRawUnsafe(
    `DELETE FROM ncf_article_revisions WHERE id IN (${sql})`,
  );
  return {
    changed: deleted,
    summary: deleted === 0
      ? `No article has more than ${params.keep} revisions.`
      : `deleted ${deleted} revision(s) beyond the newest ${params.keep} per article.`,
  };
}

registerScheduledAction({
  key:   "system.trim-article-revisions",
  label: "Trim article revisions",
  description:
    "Keeps only the most recent revisions of each article and deletes the rest. Every save stores a full copy of " +
    "the article body, so a frequently edited article accumulates them indefinitely. The live article is not a " +
    "revision and is never affected.",
  domain:         "System",
  params:         paramsSchema,
  minIntervalSec: 6 * 60 * 60,
  destructive:    true,
  run:            runTrimArticleRevisions,
});
