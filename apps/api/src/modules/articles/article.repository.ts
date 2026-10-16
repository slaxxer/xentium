import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../infrastructure/db.js";

export const articleInclude = {
  author: {
    select: {
      id: true, username: true, avatar: true, hiddenBadges: true,
      groups: {
        include: {
          group: {
            select: {
              id: true, name: true, key: true, icon: true, displayOrder: true,
              progression: { select: { badgeColor: true, badgeLabel: true } },
            },
          },
        },
      },
    },
  },
  category: { select: { id: true, name: true, slug: true } },
  tags: { include: { tag: true } },
} satisfies Prisma.ArticleInclude;

export type ArticleWithIncludes = Prisma.ArticleGetPayload<{
  include: typeof articleInclude;
}>;

export const articleRepository = {
  /** Tags ranked by how many articles use them. */
  async popularTags(limit: number) {
    const rows = await prisma.tag.findMany({
      orderBy: { articles: { _count: "desc" } },
      take: limit,
      select: { name: true, slug: true, _count: { select: { articles: true } } },
    });
    return rows
      .filter((r) => r._count.articles > 0)
      .map((r) => ({ name: r.name, slug: r.slug, count: r._count.articles }));
  },

  async slugExists(slug: string): Promise<boolean> {
    const found = await prisma.article.findUnique({ where: { slug }, select: { id: true } });
    return found !== null;
  },

  async findById(id: string) {
    return prisma.article.findUnique({ where: { id }, include: articleInclude });
  },

  async findBySlug(slug: string) {
    return prisma.article.findUnique({ where: { slug }, include: articleInclude });
  },

  async listPublished(opts: {
    page: number;
    limit: number;
    categoryId?: string;
    authorId?: string;
    viewerId?: string;
    feed?: "latest" | "following" | "top" | "liked" | "saved" | "mine";
    hiddenAuthorIds?: string[];
  }) {
    // Visibility filter:
    //  - guests see only public
    //  - authed users see public + members, plus any of their OWN private articles
    const visibilityFilter: Prisma.ArticleWhereInput = opts.viewerId
      ? {
          OR: [
            { visibility: { in: ["public", "members"] } },
            { authorId: opts.viewerId },
          ],
        }
      : { visibility: "public" };

    // Feed mode (home chips and menu). "following" is the categories and tags the
    // viewer follows; "liked", "saved" and "mine" are the viewer's own lists. "top"
    // ranks by likes within the last 7 days. Default = latest (chronological).
    let feedWhere: Prisma.ArticleWhereInput = {};
    let orderBy: Prisma.ArticleOrderByWithRelationInput = { publishedAt: "desc" };

    const personal = opts.feed === "following" || opts.feed === "liked" || opts.feed === "saved" || opts.feed === "mine";
    if (personal && !opts.viewerId) return { data: [], total: 0 };
    const viewerId = opts.viewerId!;

    if (opts.feed === "following") {
      const [cats, tags] = await Promise.all([
        prisma.articleCategoryFollow.findMany({ where: { userId: viewerId }, select: { categoryId: true } }),
        prisma.tagFollow.findMany({ where: { userId: viewerId }, select: { tagId: true } }),
      ]);
      if (cats.length === 0 && tags.length === 0) return { data: [], total: 0 };
      feedWhere = {
        OR: [
          ...(cats.length ? [{ categoryId: { in: cats.map((c) => c.categoryId) } }] : []),
          ...(tags.length ? [{ tags: { some: { tagId: { in: tags.map((t) => t.tagId) } } } }] : []),
        ],
      };
    } else if (opts.feed === "liked") {
      feedWhere = { likes: { some: { userId: viewerId } } };
    } else if (opts.feed === "saved") {
      feedWhere = { bookmarks: { some: { userId: viewerId } } };
    } else if (opts.feed === "mine") {
      feedWhere = { authorId: viewerId };
    } else if (opts.feed === "top") {
      const weekAgo = new Date(Date.now() - 7 * 86_400_000);
      feedWhere = { publishedAt: { gte: weekAgo } };
      orderBy = { likeCount: "desc" };
    }

    // Author scoping: an explicit authorId filter and the blocked-author exclusion
    // both constrain authorId, so they must be ANDed rather than overwrite each other.
    const authorConds: Prisma.ArticleWhereInput[] = [];
    if (opts.authorId) authorConds.push({ authorId: opts.authorId });
    if (opts.hiddenAuthorIds?.length) authorConds.push({ authorId: { notIn: opts.hiddenAuthorIds } });

    const where: Prisma.ArticleWhereInput = {
      status: "published",
      deletedAt: null,
      ...(opts.categoryId ? { categoryId: opts.categoryId } : {}),
      // ANDed, never spread: the feed and the visibility rule can BOTH be an `OR`
      // (followed categories or tags; public-or-own), and spreading one over the other
      // silently dropped the feed's.
      AND: [...authorConds, feedWhere, visibilityFilter],
    };
    const [data, total] = await Promise.all([
      prisma.article.findMany({
        where,
        include: articleInclude,
        orderBy,
        skip: (opts.page - 1) * opts.limit,
        take: opts.limit,
      }),
      prisma.article.count({ where }),
    ]);
    return { data, total };
  },

  async listForAuthor(opts: {
    authorId: string;
    page: number;
    limit: number;
    status?: string;
  }) {
    const where: Prisma.ArticleWhereInput = {
      authorId: opts.authorId,
      deletedAt: null,
      ...(opts.status ? { status: opts.status } : {}),
    };
    const [data, total] = await Promise.all([
      prisma.article.findMany({
        where,
        include: articleInclude,
        orderBy: { updatedAt: "desc" },
        skip: (opts.page - 1) * opts.limit,
        take: opts.limit,
      }),
      prisma.article.count({ where }),
    ]);
    return { data, total };
  },

  async listRevisions(articleId: string) {
    return prisma.articleRevision.findMany({
      where: { articleId },
      orderBy: { createdAt: "desc" },
      include: { author: { select: { id: true, username: true } } },
    });
  },
};
