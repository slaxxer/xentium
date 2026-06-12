import { prisma } from "../../infrastructure/db.js";
import { env } from "../../config/env.js";
import { searchRegistry } from "../../core/search-registry/search-registry.js";

function avatarUrl(path: string | null): string | null {
  return path ? `${env.APP_URL}/uploads/${path}` : null;
}

export interface ArticleResult {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  featuredImage: string | null;
  publishedAt: Date | null;
  likeCount: number;
  commentCount: number;
  categoryName: string | null;
  categorySlug: string | null;
  author: { id: string; username: string; avatar: string | null; badgeColor: string | null; roleKey: string | null };
  rank: number;
}

export interface UserResult {
  id: string;
  username: string;
  displayName: string | null;
  bio: string | null;
  avatar: string | null;
  badgeColor: string | null;
  badgeLabel: string | null;
  roleKey: string | null;
  rank: number;
}

export const searchService = {
  async searchArticles(opts: {
    query:      string;
    isLoggedIn: boolean;
    page:       number;
    limit:      number;
  }): Promise<{ data: ArticleResult[]; total: number }> {
    const { query, isLoggedIn, page, limit } = opts;
    const offset = (page - 1) * limit;

    // Article-level visibility (public/members/private)
    const articleVisibility = isLoggedIn
      ? `a.visibility IN ('public', 'members')`
      : `a.visibility = 'public'`;

    // Category-level visibility using the precomputed effective_visibility.
    // Groups/level categories with hide_if_no_access=true are excluded — we can't
    // resolve full group/level membership in this query context.
    // hide_if_no_access=false means show a locked notice → still appears in search.
    const categoryVisibility = isLoggedIn
      ? `(
          a.category_id IS NULL
          OR c.effective_visibility = 'public'
          OR c.effective_visibility = 'members'
          OR c.hide_if_no_access = false
        )`
      : `(
          a.category_id IS NULL
          OR c.effective_visibility = 'public'
          OR c.hide_if_no_access = false
        )`;

    const rows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        a.id, a.slug, a.title, a.excerpt,
        a.featured_image   AS "featuredImage",
        a.published_at     AS "publishedAt",
        a.like_count       AS "likeCount",
        a.comment_count    AS "commentCount",
        c.name             AS "categoryName",
        c.slug             AS "categorySlug",
        u.id               AS "authorId",
        u.username         AS "authorUsername",
        u.avatar           AS "authorAvatar",
        gp.badge_color     AS "authorBadgeColor",
        ug.group_key       AS "authorRoleKey",
        ts_rank(a.search_vector, plainto_tsquery('english', $1)) AS rank
      FROM ncf_articles a
      JOIN ncf_users u ON u.id = a.author_id
      LEFT JOIN (
        SELECT DISTINCT ON (ug."userId") ug."userId", ug."groupId", g.key AS group_key
        FROM ncf_user_groups ug
        JOIN ncf_groups g ON g.id = ug."groupId"
        ORDER BY ug."userId", g.display_order ASC
      ) ug ON ug."userId" = u.id
      LEFT JOIN group_progression gp ON gp.group_id = ug."groupId"
      LEFT JOIN ncf_article_categories c ON c.id = a.category_id
      WHERE a.search_vector @@ plainto_tsquery('english', $1)
        AND a.status = 'published'
        AND a.deleted_at IS NULL
        AND ${articleVisibility}
        AND ${categoryVisibility}
      ORDER BY rank DESC
      LIMIT $2 OFFSET $3
    `, query, limit, offset);

    const countRows = await prisma.$queryRawUnsafe<[{ count: bigint }]>(`
      SELECT COUNT(*) AS count
      FROM ncf_articles a
      LEFT JOIN ncf_article_categories c ON c.id = a.category_id
      WHERE a.search_vector @@ plainto_tsquery('english', $1)
        AND a.status = 'published'
        AND a.deleted_at IS NULL
        AND ${articleVisibility}
        AND ${categoryVisibility}
    `, query);

    return {
      data: rows.map(r => ({
        id:            r.id,
        slug:          r.slug,
        title:         r.title,
        excerpt:       r.excerpt,
        featuredImage: r.featuredImage ? `/uploads/${r.featuredImage}` : null,
        publishedAt:   r.publishedAt,
        likeCount:     Number(r.likeCount),
        commentCount:  Number(r.commentCount),
        categoryName:  r.categoryName,
        categorySlug:  r.categorySlug,
        author: {
          id:         r.authorId,
          username:   r.authorUsername,
          avatar:     avatarUrl(r.authorAvatar),
          badgeColor: r.authorBadgeColor ?? null,
          roleKey:    r.authorRoleKey ?? null,
        },
        rank: Number(r.rank),
      })),
      total: Number(countRows[0]?.count ?? 0),
    };
  },

  async searchUsers(opts: {
    query: string;
    page:  number;
    limit: number;
  }): Promise<{ data: UserResult[]; total: number }> {
    const { query, page, limit } = opts;
    const offset = (page - 1) * limit;

    const rows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        u.id, u.username, u.display_name AS "displayName", u.bio, u.avatar,
        gp.badge_color  AS "badgeColor",
        COALESCE(gp.badge_label, ug.group_name) AS "badgeLabel",
        ug.group_key    AS "roleKey",
        ts_rank(u.search_vector, plainto_tsquery('english', $1)) AS rank
      FROM ncf_users u
      LEFT JOIN (
        SELECT DISTINCT ON (ug."userId") ug."userId", ug."groupId", g.key AS group_key, g.name AS group_name
        FROM ncf_user_groups ug
        JOIN ncf_groups g ON g.id = ug."groupId"
        ORDER BY ug."userId", g.display_order ASC
      ) ug ON ug."userId" = u.id
      LEFT JOIN group_progression gp ON gp.group_id = ug."groupId"
      WHERE u.search_vector @@ plainto_tsquery('english', $1)
        AND u."isActive" = true
      ORDER BY rank DESC
      LIMIT $2 OFFSET $3
    `, query, limit, offset);

    const countRows = await prisma.$queryRawUnsafe<[{ count: bigint }]>(`
      SELECT COUNT(*) AS count FROM ncf_users
      WHERE search_vector @@ plainto_tsquery('english', $1) AND "isActive" = true
    `, query);

    return {
      data: rows.map(r => ({
        id:          r.id,
        username:    r.username,
        displayName: r.displayName ?? null,
        bio:         r.bio ?? null,
        avatar:      avatarUrl(r.avatar),
        badgeColor:  r.badgeColor ?? null,
        badgeLabel:  r.badgeLabel ?? null,
        roleKey:     r.roleKey ?? null,
        rank:        Number(r.rank),
      })),
      total: Number(countRows[0]?.count ?? 0),
    };
  },

  /**
   * Aggregate search. Built-in core types are "articles" and "users"; everything
   * else (e.g. "forum") comes from plugin-registered sources in the searchRegistry.
   * Core never queries a plugin's tables — it asks each source to run the search.
   * `type` is "all" | "articles" | "users" | <registered source id>.
   */
  async search(opts: {
    query:      string;
    type:       string;
    isLoggedIn: boolean;
    page:       number;
    limit:      number;
  }) {
    const { query, type, isLoggedIn, page, limit } = opts;

    const wantArticles = type === "all" || type === "articles";
    const wantUsers    = type === "all" || type === "users";
    const wantedSources = searchRegistry.getAll().filter((s) => type === "all" || type === s.id);

    const [articles, users, sourceResults] = await Promise.all([
      wantArticles ? searchService.searchArticles({ query, isLoggedIn, page, limit }) : { data: [], total: 0 },
      wantUsers    ? searchService.searchUsers({ query, page, limit })                : { data: [], total: 0 },
      Promise.all(wantedSources.map(async (s) => {
        try {
          return [s.id, await s.search(query, { isLoggedIn, page, limit })] as const;
        } catch {
          return [s.id, { data: [], total: 0 }] as const;
        }
      })),
    ]);

    const response: Record<string, unknown> = {
      query,
      articles: { data: articles.data, total: articles.total },
      users:    { data: users.data,    total: users.total },
    };
    for (const [id, res] of sourceResults) response[id] = res;
    return response;
  },
};
