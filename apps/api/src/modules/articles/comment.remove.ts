import type { Prisma } from "../../generated/prisma/client.js";

/**
 * Take an article comment down, together with its live replies when it is a
 * top-level one: a deleted comment leaves the thread without a trace, so its
 * replies would otherwise answer nothing. Counters drop once per published
 * comment removed, as `create` raised them. Both delete paths (the author's own
 * and a moderator's) come through here. Returns how many comments were removed.
 */
export async function removeArticleComment(
  tx: Prisma.TransactionClient,
  commentId: string,
  actorId: string,
  reason: string | null,
): Promise<number> {
  const rows = await tx.articleComment.findMany({
    where: { OR: [{ id: commentId }, { parentId: commentId }], deletedAt: null },
    select: { id: true, articleId: true, authorId: true, status: true },
  });
  if (rows.length === 0) return 0;
  await tx.articleComment.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: { deletedAt: new Date(), deletedById: actorId, deletedReason: reason },
  });
  const counted = rows.filter((r) => r.status === "published");
  if (counted.length > 0) {
    await tx.article.update({
      where: { id: counted[0]!.articleId },
      data: { commentCount: { decrement: counted.length } },
    });
    const perAuthor = new Map<string, number>();
    for (const r of counted) perAuthor.set(r.authorId, (perAuthor.get(r.authorId) ?? 0) + 1);
    for (const [authorId, n] of perAuthor) {
      await tx.user.update({ where: { id: authorId }, data: { commentCount: { decrement: n } } });
    }
  }
  return rows.length;
}
