import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client.js";

/**
 * The ACP Articles page's list query and bulk actions: what the page may ask
 * for, and how a query becomes a `where`.
 */
export const ARTICLE_LIST_SORTS = ["new", "edited", "read", "comments", "title"] as const;

export const articleListSchema = z.object({
  page:     z.coerce.number().int().positive().default(1),
  limit:    z.coerce.number().int().min(1).max(100).default(20),
  // "hidden" is not a status: it is any status with hiddenAt set.
  status:   z.enum(["draft", "review", "published", "hidden"]).optional(),
  // A category id, or "none" for uncategorised.
  category: z.string().max(64).optional(),
  q:        z.string().trim().max(120).optional(),
  sort:     z.enum(ARTICLE_LIST_SORTS).optional(),
});
export type ArticleListQuery = z.infer<typeof articleListSchema>;

export const articleBulkSchema = z.object({
  ids:        z.array(z.string().min(1).max(64)).min(1).max(100),
  action:     z.enum(["move", "hide", "show", "delete"]),
  // move only: the target category, null = uncategorised.
  categoryId: z.string().min(1).max(64).nullable().optional(),
}).refine((b) => b.action !== "move" || b.categoryId !== undefined, { path: ["categoryId"], message: "Required to move" });
export type ArticleBulkInput = z.infer<typeof articleBulkSchema>;

export const ARTICLE_SORT: Record<(typeof ARTICLE_LIST_SORTS)[number], Prisma.ArticleOrderByWithRelationInput[]> = {
  new:      [{ createdAt: "desc" }],
  edited:   [{ updatedAt: "desc" }],
  read:     [{ viewCount: "desc" }, { createdAt: "desc" }],
  comments: [{ commentCount: "desc" }, { createdAt: "desc" }],
  title:    [{ title: "asc" }],
};

export function adminArticleWhere(q: Pick<ArticleListQuery, "status" | "category" | "q">): Prisma.ArticleWhereInput {
  const where: Prisma.ArticleWhereInput = { deletedAt: null };
  if (q.status === "hidden") where.hiddenAt = { not: null };
  else if (q.status) where.status = q.status;
  if (q.category === "none") where.categoryId = null;
  else if (q.category) where.categoryId = q.category;
  if (q.q) {
    where.OR = [
      { title: { contains: q.q, mode: "insensitive" } },
      { author: { username: { contains: q.q, mode: "insensitive" } } },
    ];
  }
  return where;
}
