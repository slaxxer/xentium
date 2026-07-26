/**
 * system.purge-deleted-content — hard-delete content that has been soft-deleted
 * for longer than a window.
 *
 * Soft deletes are never reclaimed today: `deleted_at` rows sit in ncf_articles,
 * ncf_article_comments and ncf_profile_comments forever. This is the action that
 * finishes the job — and it is the most destructive one in the catalogue, because
 * a hard delete cascades.
 *
 * THE REPLY HAZARD. `ArticleComment.parent` is `onDelete: Cascade`, so deleting a
 * soft-deleted comment also deletes its replies — including replies that are
 * perfectly alive. A moderator hides one spam comment, three people had already
 * answered it, and a naive purge silently destroys all three. The rule here is
 * therefore stricter than "old enough": a comment is only purged when its ENTIRE
 * reply subtree is also soft-deleted past the same cutoff. Anything with a living
 * descendant is skipped and reported, forever if need be.
 *
 * Counters are unaffected by design: every counter in system.recompute-counters
 * already filters `deleted_at IS NULL`, so these rows contribute nothing before
 * the purge and nothing after it.
 *
 * Uploads are NOT deleted here. Hard-deleting an article orphans its
 * `articles/<id>/` directory, which system.purge-orphaned-uploads then reclaims —
 * two actions with one job each, rather than one that does both jobs partly.
 */
import { z } from "zod";
import { prisma } from "../../infrastructure/db.js";
import { registerScheduledAction, type ActionResult, type ActionRunCtx } from "./action-registry.js";

const SCOPES = ["articles", "article_comments", "profile_comments"] as const;

const paramsSchema = z.object({
  days: z
    .number().int().min(1).max(3650).default(30)
    .meta({
      title:       "Delete after (days)",
      description: "Only purge records that have been in the trash longer than this. Until then they stay restorable.",
    }),
  scope: z
    .enum(["all", ...SCOPES]).default("all")
    .meta({
      title:       "Scope",
      description: "Limit the purge to one kind of content.",
    }),
});
type Params = z.infer<typeof paramsSchema>;

/**
 * Soft-deleted comments whose whole reply subtree is also eligible.
 *
 * The recursive term walks each candidate's descendants; the aggregate keeps only
 * those roots where EVERY node in the subtree is itself soft-deleted past the
 * cutoff. A root with one living reply — at any depth — fails `bool_and` and is
 * left alone. Returns the roots to delete plus the total node count, since the
 * cascade removes the subtree along with each root.
 */
async function eligibleCommentTrees(cutoff: Date): Promise<{ roots: string[]; nodes: number }> {
  const [row] = await prisma.$queryRaw<{ roots: string[] | null; nodes: bigint }[]>`
    WITH RECURSIVE tree AS (
      SELECT id AS root, id AS node
        FROM ncf_article_comments
       WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff}
      UNION ALL
      SELECT t.root, c.id
        FROM ncf_article_comments c
        JOIN tree t ON c.parent_id = t.node
    ),
    eligible AS (
      SELECT t.root
        FROM tree t
        JOIN ncf_article_comments c ON c.id = t.node
       GROUP BY t.root
      HAVING bool_and(c.deleted_at IS NOT NULL AND c.deleted_at < ${cutoff})
    )
    SELECT (SELECT array_agg(root) FROM eligible) AS roots,
           -- DISTINCT because a nested comment is both a node of its parent's
           -- subtree and an eligible root in its own right. Summing per-root
           -- counts would report more rows than the delete actually removes.
           (SELECT COUNT(DISTINCT t.node)
              FROM tree t JOIN eligible e ON e.root = t.root) AS nodes
  `;
  // Deleting an outer root cascades any nested root, so passing all of them to
  // one deleteMany is idempotent rather than wrong.
  return { roots: row?.roots ?? [], nodes: Number(row?.nodes ?? 0) };
}

export async function runPurgeDeletedContent(
  params: Params,
  ctx: ActionRunCtx,
): Promise<ActionResult> {
  const cutoff = new Date(Date.now() - params.days * 86_400_000);
  const scopes = params.scope === "all" ? [...SCOPES] : [params.scope as (typeof SCOPES)[number]];
  const parts: string[] = [];
  let changed = 0;
  let skipped = 0;

  if (scopes.includes("articles")) {
    const where = { deletedAt: { not: null, lt: cutoff } } as const;
    const n = ctx.dryRun
      ? await prisma.article.count({ where })
      : (await prisma.article.deleteMany({ where })).count;
    if (n) { parts.push(`${n} article(s)`); changed += ctx.dryRun ? 0 : n; }
  }

  if (scopes.includes("article_comments")) {
    const { roots, nodes } = await eligibleCommentTrees(cutoff);
    // Everything soft-deleted and old enough, minus what we are allowed to take:
    // the difference is exactly the comments held back by a living reply.
    const candidates = await prisma.articleComment.count({
      where: { deletedAt: { not: null, lt: cutoff } },
    });
    skipped = candidates - roots.length;

    if (!ctx.dryRun && roots.length > 0) {
      const { count } = await prisma.articleComment.deleteMany({ where: { id: { in: roots } } });
      changed += count;
    }
    if (nodes) parts.push(`${nodes} article comment(s)`);
  }

  if (scopes.includes("profile_comments")) {
    const where = { deletedAt: { not: null, lt: cutoff } } as const;
    const n = ctx.dryRun
      ? await prisma.profileComment.count({ where })
      : (await prisma.profileComment.deleteMany({ where })).count;
    if (n) { parts.push(`${n} profile comment(s)`); changed += ctx.dryRun ? 0 : n; }
  }

  const held = skipped > 0 ? ` ${skipped} comment(s) kept — they still have live replies.` : "";
  if (parts.length === 0) {
    return { changed: 0, summary: `Nothing has been in the trash longer than ${params.days} days.${held}` };
  }
  const verb = ctx.dryRun ? "would purge" : "purged";
  return { changed, summary: `${verb} ${parts.join(", ")} deleted over ${params.days} days ago.${held}` };
}

registerScheduledAction({
  key:   "system.purge-deleted-content",
  label: "Purge deleted content",
  description:
    "Permanently removes articles and comments that have been in the trash longer than the chosen window. " +
    "Soft-deleted comments that still have live replies are never purged, because deleting them would take the " +
    "replies with them. Article uploads are reclaimed separately by \"Purge orphaned uploads\". " +
    "This cannot be undone — dry-run it first.",
  domain:         "System",
  params:         paramsSchema,
  minIntervalSec: 12 * 60 * 60,
  destructive:    true,
  run:            runPurgeDeletedContent,
});
