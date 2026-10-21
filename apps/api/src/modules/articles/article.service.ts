import { storage } from "../../infrastructure/storage/LocalStorageProvider.js";
import { articleEngagementService } from "./article.engagement.js";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../infrastructure/db.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { XEC } from "@xentium/contracts";
import { buildPaginationMeta, type PaginatedResponse } from "@xentium/contracts";
import { uniqueSlug, slugify } from "@xentium/sdk";
import { tiptapToPlain } from "../../shared/utils/tiptapPlain.js";
import { queues } from "../../infrastructure/queue.js";
import { articleRepository, articleInclude, type ArticleWithIncludes } from "./article.repository.js";
import type { CreateArticleInput, UpdateArticleInput, ListArticlesQuery } from "./article.validation.js";
import type { ArticleDetail, ArticleListItem } from "./article.types.js";
import { resolveAvatar } from "../../shared/utils/resolveAvatar.js";
import { filterHiddenBadges } from "../../shared/utils/badgeVisibility.js";
import { enforceArticleLength, enforceDailyArticleLimit } from "../../shared/middleware/contentLimits.js";
import { getHiddenAuthorIds } from "../../shared/utils/blocks.js";
import { profileAccess } from "../users/profilePrivacy.js";
import { hasPermission } from "../../shared/middleware/requirePermission.js";
import { CorePermissions } from "@xentium/contracts";
import { contentRegistry } from "../../core/content-registry/content-registry.js";
import { embedRegistry } from "../../core/embed-registry/embed-registry.js";

const WORDS_PER_MINUTE = 200;

function estimateReadTime(bodyPlain: string | null): number {
  if (!bodyPlain) return 1;
  const words = bodyPlain.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

function shapeListItem(a: ArticleWithIncludes): ArticleListItem {
  return {
    id: a.id,
    slug: a.slug,
    title: a.title,
    excerpt: a.excerpt,
    featuredImage: a.featuredImage,
    status: a.status as ArticleListItem["status"],
    visibility: a.visibility as ArticleListItem["visibility"],
    publishedAt: a.publishedAt,
    likeCount: a.likeCount,
    dislikeCount: a.dislikeCount,
    commentCount: a.commentCount,
    viewCount: a.viewCount,
    readTime: a.readTime,
    pinned: a.pinnedAt != null,
    author: (() => {
      const visibleGroups = filterHiddenBadges(a.author.groups, a.author.hiddenBadges);
      return {
        id:         a.author.id,
        username:   a.author.username,
        avatar:     resolveAvatar(a.author.avatar),
        badgeColor: visibleGroups[0]?.group.progression?.badgeColor ?? null,
        groups:     visibleGroups,
      };
    })(),
    category: a.category,
    tags: a.tags.map((t) => t.tag),
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

function shapeDetail(a: ArticleWithIncludes): ArticleDetail {
  return {
    ...shapeListItem(a),
    body: a.body,
    seoTitle: a.seoTitle,
    seoDescription: a.seoDescription,
    commentsClosed: a.commentsClosedAt != null,
    hidden: a.hiddenAt != null,
  };
}

/** What the viewer may see beyond the normal rules. */
export interface ArticleViewerCan {
  /** `article.edit.any`: drafts, private and deleted articles. */
  editAny: boolean;
  /** `article.hide`: articles staff hid. */
  seeHidden: boolean;
}

/** Article-specific visibility check. Article uses 3-mode model (public/members/private). */
function canViewArticle(
  article: { authorId: string; visibility: string; status: string; deletedAt: Date | null; hiddenAt: Date | null },
  viewerId: string | undefined,
  can: ArticleViewerCan,
): boolean {
  if (article.deletedAt) return can.editAny;

  // The author sees their own in every state, hidden included.
  const isAuthor = !!viewerId && viewerId === article.authorId;
  if (isAuthor) return true;
  // A hidden article is gone for everyone without `article.hide`, editors included.
  if (article.hiddenAt && !can.seeHidden) return false;
  if (can.editAny) return true;

  if (article.status !== "published") return false;
  switch (article.visibility) {
    case "public":
      return true;
    case "members":
      return !!viewerId;
    case "private":
      return false;
    default:
      return false;
  }
}

/**
 * Articles are a content kind core owns: a plugin embed inside one (a poll) is
 * exactly as visible as the article — the same rule `getBySlug` applies.
 */
contentRegistry.register("core", {
  kind: "article",
  async canView(id, viewerId) {
    const article = await articleRepository.findById(id);
    if (!article) return false;
    const [editAny, seeHidden] = viewerId
      ? await Promise.all([
          hasPermission(viewerId, CorePermissions.ARTICLE_EDIT_ANY),
          hasPermission(viewerId, CorePermissions.ARTICLE_HIDE),
        ])
      : [false, false];
    return canViewArticle(article, viewerId ?? undefined, { editAny, seeHidden });
  },
});

/** Tell embed owners what the saved body now holds. Never fails the save. */
const syncArticleEmbeds = (article: { id: string; authorId: string; body: unknown }) =>
  embedRegistry.sync({ kind: "article", id: article.id, authorId: article.authorId }, article.body);

async function upsertTags(
  tx: Prisma.TransactionClient,
  tagNames: string[],
): Promise<string[]> {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const raw of tagNames) {
    const name = raw.trim();
    if (!name) continue;
    const slug = slugify(name);
    if (seen.has(slug)) continue;
    seen.add(slug);
    const tag = await tx.tag.upsert({
      where: { slug },
      create: { name, slug },
      update: {},
      select: { id: true },
    });
    ids.push(tag.id);
  }
  return ids;
}

export const articleService = {
  async create(authorId: string, input: CreateArticleInput): Promise<ArticleDetail> {
    const bodyPlain = tiptapToPlain(input.body);

    // Enforce progression content limits (§38, Phase 7)
    await enforceDailyArticleLimit(authorId);
    await enforceArticleLength(authorId, bodyPlain);

    const slug = await uniqueSlug(input.title, (s) => articleRepository.slugExists(s));

    const created = await prisma.$transaction(async (tx) => {
      const article = await tx.article.create({
        data: {
          authorId,
          categoryId: input.categoryId,
          title: input.title,
          slug,
          excerpt: input.excerpt,
          body: input.body as Prisma.InputJsonValue,
          bodyPlain,
          readTime: estimateReadTime(bodyPlain),
          visibility: input.visibility,
          seoTitle: input.seoTitle,
          seoDescription: input.seoDescription,
        },
      });

      const tagIds = await upsertTags(tx, input.tags);
      if (tagIds.length > 0) {
        await tx.articleTag.createMany({
          data: tagIds.map((tagId) => ({ articleId: article.id, tagId })),
          skipDuplicates: true,
        });
      }

      return tx.article.findUniqueOrThrow({
        where: { id: article.id },
        include: articleInclude,
      });
    });

    await syncArticleEmbeds(created);
    return shapeDetail(created);
  },

  async update(
    id: string,
    viewerId: string,
    viewerCanEditAny: boolean,
    input: UpdateArticleInput,
  ): Promise<ArticleDetail> {
    const existing = await articleRepository.findById(id);
    if (!existing || existing.deletedAt) {
      throw new XentiumError({
        code: XEC.ARTICLE_NOT_FOUND,
        httpStatus: 404,
        message: "Article not found",
      });
    }

    if (existing.authorId !== viewerId && !viewerCanEditAny) {
      throw new XentiumError({
        code: XEC.PERM_DENIED,
        httpStatus: 403,
        message: "Cannot edit this article",
      });
    }

    const willChangeBody  = input.body  !== undefined;
    const willChangeTitle = input.title !== undefined && input.title !== existing.title;

    // Enforce article-length limit when body is being edited (§38)
    if (willChangeBody && input.body) {
      await enforceArticleLength(viewerId, tiptapToPlain(input.body));
    }

    const updated = await prisma.$transaction(async (tx) => {
      let nextSlug = existing.slug;
      if (willChangeTitle && input.title) {
        nextSlug = await uniqueSlug(input.title, async (s) => {
          if (s === existing.slug) return false;
          return articleRepository.slugExists(s);
        });
      }

      const data: Prisma.ArticleUpdateInput = {
        ...(input.title !== undefined ? { title: input.title, slug: nextSlug } : {}),
        ...(input.excerpt !== undefined ? { excerpt: input.excerpt } : {}),
        ...(input.body !== undefined
          ? (() => {
              const plain = tiptapToPlain(input.body);
              return { body: input.body as Prisma.InputJsonValue, bodyPlain: plain, readTime: estimateReadTime(plain) };
            })()
          : {}),
        ...(input.categoryId !== undefined
          ? { category: input.categoryId ? { connect: { id: input.categoryId } } : { disconnect: true } }
          : {}),
        ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
        ...(input.seoTitle !== undefined ? { seoTitle: input.seoTitle } : {}),
        ...(input.seoDescription !== undefined ? { seoDescription: input.seoDescription } : {}),
      };

      await tx.article.update({ where: { id }, data });

      if (input.tags !== undefined) {
        await tx.articleTag.deleteMany({ where: { articleId: id } });
        const tagIds = await upsertTags(tx, input.tags);
        if (tagIds.length > 0) {
          await tx.articleTag.createMany({
            data: tagIds.map((tagId) => ({ articleId: id, tagId })),
            skipDuplicates: true,
          });
        }
      }

      // Revision snapshot on body change for published articles (§47).
      let didCreateRevision = false;
      if (existing.status === "published" && (willChangeBody || willChangeTitle)) {
        await tx.articleRevision.create({
          data: {
            articleId: id,
            authorId: viewerId,
            title: input.title ?? existing.title,
            body: (input.body ?? existing.body) as Prisma.InputJsonValue,
          },
        });
        didCreateRevision = true;
      }

      const fresh = await tx.article.findUniqueOrThrow({ where: { id }, include: articleInclude });
      return { fresh, didCreateRevision };
    });

    // The article's own author, not the editor: an embed attaches only what the
    // writer of the content created.
    if (willChangeBody) await syncArticleEmbeds(updated.fresh);

    if (updated.didCreateRevision) {
      await queues.articleRevisionCleanup.add("cleanup", { articleId: id });
    }

    return shapeDetail(updated.fresh);
  },

  async publish(id: string, viewerId: string, viewerCanEditAny: boolean): Promise<ArticleDetail> {
    const existing = await articleRepository.findById(id);
    if (!existing || existing.deletedAt) {
      throw new XentiumError({
        code: XEC.ARTICLE_NOT_FOUND,
        httpStatus: 404,
        message: "Article not found",
      });
    }
    // `article.publish` lets a member publish THEIR articles. Someone else's needs
    // `article.edit_any` too, like editing it does.
    if (existing.authorId !== viewerId && !viewerCanEditAny) {
      throw new XentiumError({
        code: XEC.PERM_DENIED,
        httpStatus: 403,
        message: "Cannot publish this article",
      });
    }

    const wasPublished = existing.status === "published";

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.article.update({
        where: { id },
        data: {
          status: "published",
          ...(wasPublished ? {} : { publishedAt: new Date() }),
        },
        include: articleInclude,
      });

      // Increment author article count on first publish
      if (!wasPublished) {
        await tx.user.update({
          where: { id: existing.authorId },
          data: { articleCount: { increment: 1 } },
        });
      }

      // Enqueue promotion check after the transaction (non-blocking, Phase 7)
      if (!wasPublished) {
        queues.checkPromotion
          .add("check-promotion", { userId: existing.authorId }, { delay: 2000 })
          .catch(() => { /* non-critical — promotion can wait for next trigger */ });
      }

      // Revision snapshot on publish (§47)
      await tx.articleRevision.create({
        data: {
          articleId: id,
          authorId: viewerId,
          title: result.title,
          body: result.body as Prisma.InputJsonValue,
        },
      });

      return result;
    });

    await queues.articleRevisionCleanup.add("cleanup", { articleId: id });

    return shapeDetail(updated);
  },

  async unpublish(id: string, viewerCanEditAny: boolean): Promise<ArticleDetail> {
    const existing = await articleRepository.findById(id);
    if (!existing || existing.deletedAt) {
      throw new XentiumError({
        code: XEC.ARTICLE_NOT_FOUND,
        httpStatus: 404,
        message: "Article not found",
      });
    }
    if (!viewerCanEditAny) {
      throw new XentiumError({
        code: XEC.PERM_DENIED,
        httpStatus: 403,
        message: "Cannot unpublish",
      });
    }
    const updated = await prisma.article.update({
      where: { id },
      data: { status: "draft" },
      include: articleInclude,
    });
    return shapeDetail(updated);
  },

  async softDelete(id: string, viewerId: string, viewerCanDeleteAny: boolean): Promise<void> {
    const existing = await articleRepository.findById(id);
    if (!existing || existing.deletedAt) {
      throw new XentiumError({
        code: XEC.ARTICLE_NOT_FOUND,
        httpStatus: 404,
        message: "Article not found",
      });
    }
    if (existing.authorId !== viewerId && !viewerCanDeleteAny) {
      throw new XentiumError({
        code: XEC.PERM_DENIED,
        httpStatus: 403,
        message: "Cannot delete this article",
      });
    }
    await prisma.article.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: viewerId },
    });
  },

  async getBySlug(
    slug: string,
    viewerId: string | undefined,
    can: ArticleViewerCan,
  ): Promise<ArticleDetail> {
    // An id is accepted too: notifications sent before they linked by slug pointed
    // at `/articles/<id>`. The same visibility check applies either way.
    const article = (await articleRepository.findBySlug(slug)) ?? (await articleRepository.findById(slug));
    if (!article || !canViewArticle(article, viewerId, can)) {
      throw new XentiumError({
        code: XEC.ARTICLE_NOT_FOUND,
        httpStatus: 404,
        message: "Article not found",
      });
    }
    const detail = shapeDetail(article);
    // The reader opens with the viewer's own heart, dislike and bookmark already set.
    if (viewerId) detail.viewer = (await articleEngagementService.viewerState([detail.id], viewerId)).get(detail.id);
    return detail;
  },

  async list(
    query: ListArticlesQuery,
    viewerId: string | undefined,
  ): Promise<PaginatedResponse<ArticleListItem>> {
    const { page, limit, categoryId, authorId, feed, q, tag, period, length, sort, exclude } = query;
    // One member's articles is their post history: shown only as their privacy
    // setting allows. The articles themselves stay readable everywhere else.
    if (authorId && authorId !== viewerId && !(await profileAccess(authorId, viewerId)).history) {
      return { data: [], meta: buildPaginationMeta({ page, limit, total: 0 }) };
    }
    const hiddenAuthorIds = await getHiddenAuthorIds(viewerId);
    const { data, total } = await articleRepository.listPublished({
      page,
      limit,
      categoryId,
      authorId,
      viewerId,
      feed,
      hiddenAuthorIds,
      q, tag, period, length, sort, exclude,
    });
    const items = data.map(shapeListItem);
    // The viewer's own state per card — liked, saved — so a heart starts filled when
    // the member already liked the article.
    if (viewerId) {
      const state = await articleEngagementService.viewerState(items.map((i) => i.id), viewerId);
      for (const item of items) item.viewer = state.get(item.id);
    }
    return {
      data: items,
      meta: buildPaginationMeta({ page, limit, total }),
    };
  },

  /** The article index's featured card: the newest pinned article the viewer may see. */
  async featured(viewerId: string | undefined): Promise<ArticleListItem | null> {
    const row = await articleRepository.featured(viewerId, await getHiddenAuthorIds(viewerId));
    return row ? shapeListItem(row) : null;
  },

  async trending(viewerId: string | undefined, days: number, max: number) {
    return articleRepository.trending(viewerId, await getHiddenAuthorIds(viewerId), days, max);
  },

  /** Pin to (or take off) the top of the article index. Staff who may edit any article. */
  async setPinned(id: string, pinned: boolean): Promise<void> {
    const res = await articleRepository.setPinned(id, pinned);
    if (res.count === 0) {
      throw new XentiumError({ code: XEC.ARTICLE_NOT_FOUND, httpStatus: 404, message: "Article not found" });
    }
  },

  /** Close (or reopen) the comments. Staff with `article.comments.close`; logged. */
  async setCommentsClosed(id: string, closed: boolean, actorId: string): Promise<void> {
    const res = await prisma.article.updateMany({
      where: { id, deletedAt: null },
      data: closed ? { commentsClosedAt: new Date(), commentsClosedById: actorId } : { commentsClosedAt: null, commentsClosedById: null },
    });
    if (res.count === 0) {
      throw new XentiumError({ code: XEC.ARTICLE_NOT_FOUND, httpStatus: 404, message: "Article not found" });
    }
    await prisma.moderationLog.create({
      data: { actorId, actorType: "user", action: closed ? "article.comments_closed" : "article.comments_reopened", targetType: "article", targetId: id },
    });
  },

  /** Hide (or show again). Staff with `article.hide`; logged. Nothing is deleted. */
  async setHidden(id: string, hidden: boolean, actorId: string): Promise<void> {
    const res = await prisma.article.updateMany({
      where: { id, deletedAt: null },
      data: hidden ? { hiddenAt: new Date(), hiddenById: actorId } : { hiddenAt: null, hiddenById: null },
    });
    if (res.count === 0) {
      throw new XentiumError({ code: XEC.ARTICLE_NOT_FOUND, httpStatus: 404, message: "Article not found" });
    }
    await prisma.moderationLog.create({
      data: { actorId, actorType: "user", action: hidden ? "article.hidden" : "article.unhidden", targetType: "article", targetId: id },
    });
  },

  async popularTags(limit: number) {
    return articleRepository.popularTags(limit);
  },

  async listMine(
    authorId: string,
    opts: { page: number; limit: number; status?: string },
  ): Promise<PaginatedResponse<ArticleListItem>> {
    const { page, limit, status } = opts;
    const { data, total } = await articleRepository.listForAuthor({
      authorId,
      page,
      limit,
      status,
    });
    return {
      data: data.map(shapeListItem),
      meta: buildPaginationMeta({ page, limit, total }),
    };
  },

  async listRevisions(articleId: string, viewerId: string, viewerCanEditAny: boolean) {
    const article = await articleRepository.findById(articleId);
    if (!article) {
      throw new XentiumError({
        code: XEC.ARTICLE_NOT_FOUND,
        httpStatus: 404,
        message: "Article not found",
      });
    }
    if (article.authorId !== viewerId && !viewerCanEditAny) {
      throw new XentiumError({
        code: XEC.PERM_DENIED,
        httpStatus: 403,
        message: "Cannot view revisions",
      });
    }
    return articleRepository.listRevisions(articleId);
  },

  async setFeaturedImage(
    articleId: string,
    relPath: string,
    viewerId: string,
    viewerCanEditAny: boolean,
  ): Promise<ArticleDetail> {
    const existing = await articleRepository.findById(articleId);
    if (!existing || existing.deletedAt) {
      throw new XentiumError({
        code: XEC.ARTICLE_NOT_FOUND,
        httpStatus: 404,
        message: "Article not found",
      });
    }
    if (existing.authorId !== viewerId && !viewerCanEditAny) {
      throw new XentiumError({
        code: XEC.PERM_DENIED,
        httpStatus: 403,
        message: "Cannot edit this article",
      });
    }
    const updated = await prisma.article.update({
      where: { id: articleId },
      data: { featuredImage: relPath },
      include: articleInclude,
    });
    // The replaced picture, now that nothing points at it. Only one under this
    // article's own directory — never a path some other row might share.
    const previous = existing.featuredImage;
    if (previous && previous !== relPath && previous.startsWith(`articles/${articleId}/`)) {
      await storage.delete(previous).catch(() => { /* already gone: nothing to free */ });
    }
    return shapeDetail(updated);
  },
};
