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
    q?: string;
    tag?: string;
    period?: "week" | "month" | "year";
    length?: "short" | "medium" | "long";
    sort?: "latest" | "popular" | "discussed";
    exclude?: string;
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

    // The article index's filters, each its own AND term for the same reason.
    const indexConds: Prisma.ArticleWhereInput[] = [];
    if (opts.q) {
      const contains = { contains: opts.q, mode: "insensitive" as const };
      indexConds.push({ OR: [
        { title: contains },
        { excerpt: contains },
        { author: { username: contains } },
        { tags: { some: { tag: { name: contains } } } },
      ] });
    }
    if (opts.tag) indexConds.push({ tags: { some: { tag: { slug: opts.tag } } } });
    if (opts.period) {
      const since = opts.period === "year"
        ? new Date(new Date().getFullYear(), 0, 1)
        : new Date(Date.now() - (opts.period === "week" ? 7 : 30) * 86_400_000);
      indexConds.push({ publishedAt: { gte: since } });
    }
    if (opts.length === "short") indexConds.push({ readTime: { lt: 5 } });
    if (opts.length === "medium") indexConds.push({ readTime: { gte: 5, lte: 10 } });
    if (opts.length === "long") indexConds.push({ readTime: { gt: 10 } });
    if (opts.exclude) indexConds.push({ id: { not: opts.exclude } });
    if (opts.sort === "popular") orderBy = { likeCount: "desc" };
    if (opts.sort === "discussed") orderBy = { commentCount: "desc" };

    const where: Prisma.ArticleWhereInput = {
      status: "published",
      deletedAt: null,
      ...(opts.categoryId ? { categoryId: opts.categoryId } : {}),
      // ANDed, never spread: the feed and the visibility rule can BOTH be an `OR`
      // (followed categories or tags; public-or-own), and spreading one over the other
      // silently dropped the feed's.
      AND: [...authorConds, feedWhere, visibilityFilter, ...indexConds],
    };
    const [data, total] = await Promise.all([
      prisma.article.findMany({
        where,
        include: articleInclude,
        // Newest first among equals, so "most liked" is stable across pages.
        orderBy: [orderBy, { publishedAt: "desc" }],
        skip: (opts.page - 1) * opts.limit,
        take: opts.limit,
      }),
      prisma.article.count({ where }),
    ]);
    return { data, total };
  },

  /** The visibility rule a list applies, for the index's featured and trending reads. */
  visibleTo(viewerId: string | undefined, hiddenAuthorIds: string[] = []): Prisma.ArticleWhereInput {
    return {
      status: "published",
      deletedAt: null,
      AND: [
        viewerId
          ? { OR: [{ visibility: { in: ["public", "members"] } }, { authorId: viewerId }] }
          : { visibility: "public" },
        ...(hiddenAuthorIds.length ? [{ authorId: { notIn: hiddenAuthorIds } }] : []),
      ],
    };
  },

  /** The most recently pinned article this viewer may see, or null. */
  async featured(viewerId: string | undefined, hiddenAuthorIds: string[]) {
    return prisma.article.findFirst({
      where: { ...this.visibleTo(viewerId, hiddenAuthorIds), pinnedAt: { not: null } },
      include: articleInclude,
      orderBy: { pinnedAt: "desc" },
    });
  },

  /**
   * Trending: published in the last `days`, scored likes + comments × 2. Ranked in
   * memory over a bounded candidate set (the newest 200 of the window), since the
   * score is not a column; ample for one index rail.
   */
  async trending(viewerId: string | undefined, hiddenAuthorIds: string[], days: number, max: number) {
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await prisma.article.findMany({
      where: { ...this.visibleTo(viewerId, hiddenAuthorIds), publishedAt: { gte: since } },
      select: { id: true, slug: true, title: true, likeCount: true, commentCount: true, publishedAt: true },
      orderBy: { publishedAt: "desc" },
      take: 200,
    });
    return rows
      .map((r) => ({ ...r, score: r.likeCount + r.commentCount * 2 }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || +(b.publishedAt ?? 0) - +(a.publishedAt ?? 0))
      .slice(0, max)
      .map(({ id, slug, title, likeCount, commentCount }) => ({ id, slug, title, likeCount, commentCount }));
  },

  async setPinned(id: string, pinned: boolean) {
    return prisma.article.updateMany({ where: { id, deletedAt: null }, data: { pinnedAt: pinned ? new Date() : null } });
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
