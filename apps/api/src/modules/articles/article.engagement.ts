/**
 * A member's own relationship with articles, beyond likes (comment.service):
 *  - SAVED articles (bookmarks) — home → Saved;
 *  - FOLLOWED categories and tags — their articles make up the Following feed;
 *  - per-item viewer state on a list (liked? saved?), so a card starts in the state
 *    the member left it in instead of every heart starting empty.
 */
import { z } from "zod";
import type { RequestHandler } from "express";
import { prisma } from "../../infrastructure/db.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { XEC } from "../../shared/errors/xec.js";
import { articleIdParamSchema } from "./article.validation.js";

const idParam = z.object({ id: z.string().min(1).max(64) });

const notFound = (what: string) =>
  new XentiumError({ code: XEC.ARTICLE_NOT_FOUND, httpStatus: 404, message: `${what} not found` });

export const articleEngagementService = {
  /** Which of `articleIds` the viewer liked and saved. */
  async viewerState(articleIds: string[], userId: string): Promise<Map<string, { liked: boolean; saved: boolean }>> {
    const out = new Map(articleIds.map((id) => [id, { liked: false, saved: false }]));
    if (articleIds.length === 0) return out;
    const [likes, saves] = await Promise.all([
      prisma.articleLike.findMany({ where: { userId, articleId: { in: articleIds } }, select: { articleId: true } }),
      prisma.articleBookmark.findMany({ where: { userId, articleId: { in: articleIds } }, select: { articleId: true } }),
    ]);
    for (const l of likes) out.get(l.articleId)!.liked = true;
    for (const s of saves) out.get(s.articleId)!.saved = true;
    return out;
  },

  async save(articleId: string, userId: string): Promise<{ saved: true }> {
    const article = await prisma.article.findUnique({ where: { id: articleId }, select: { deletedAt: true, status: true } });
    if (!article || article.deletedAt || article.status !== "published") throw notFound("Article");
    // Idempotent: saving twice is still saved.
    await prisma.articleBookmark.upsert({
      where: { articleId_userId: { articleId, userId } },
      update: {},
      create: { articleId, userId },
    });
    return { saved: true };
  },

  async unsave(articleId: string, userId: string): Promise<{ saved: false }> {
    await prisma.articleBookmark.deleteMany({ where: { articleId, userId } });
    return { saved: false };
  },

  /** The categories and tags the member follows, for the menu and the follow buttons. */
  async followedTopics(userId: string) {
    const [categories, tags] = await Promise.all([
      prisma.articleCategoryFollow.findMany({
        where: { userId }, orderBy: { createdAt: "asc" },
        select: { category: { select: { id: true, name: true, slug: true } } },
      }),
      prisma.tagFollow.findMany({
        where: { userId }, orderBy: { createdAt: "asc" },
        select: { tag: { select: { id: true, name: true, slug: true } } },
      }),
    ]);
    return { categories: categories.map((c) => c.category), tags: tags.map((t) => t.tag) };
  },

  async followCategory(categoryId: string, userId: string) {
    if (!(await prisma.articleCategory.findUnique({ where: { id: categoryId }, select: { id: true } }))) throw notFound("Category");
    await prisma.articleCategoryFollow.upsert({
      where: { categoryId_userId: { categoryId, userId } }, update: {}, create: { categoryId, userId },
    });
    return this.followedTopics(userId);
  },

  async unfollowCategory(categoryId: string, userId: string) {
    await prisma.articleCategoryFollow.deleteMany({ where: { categoryId, userId } });
    return this.followedTopics(userId);
  },

  async followTag(tagId: string, userId: string) {
    if (!(await prisma.tag.findUnique({ where: { id: tagId }, select: { id: true } }))) throw notFound("Tag");
    await prisma.tagFollow.upsert({
      where: { tagId_userId: { tagId, userId } }, update: {}, create: { tagId, userId },
    });
    return this.followedTopics(userId);
  },

  async unfollowTag(tagId: string, userId: string) {
    await prisma.tagFollow.deleteMany({ where: { tagId, userId } });
    return this.followedTopics(userId);
  },
};

export const articleEngagementController = {
  save: (async (req, res) => {
    const { id } = articleIdParamSchema.parse(req.params);
    res.json(await articleEngagementService.save(id, req.userId!));
  }),
  unsave: (async (req, res) => {
    const { id } = articleIdParamSchema.parse(req.params);
    res.json(await articleEngagementService.unsave(id, req.userId!));
  }),
  followedTopics: (async (req, res) => {
    res.json(await articleEngagementService.followedTopics(req.userId!));
  }),
  followCategory: (async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await articleEngagementService.followCategory(id, req.userId!));
  }),
  unfollowCategory: (async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await articleEngagementService.unfollowCategory(id, req.userId!));
  }),
  followTag: (async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await articleEngagementService.followTag(id, req.userId!));
  }),
  unfollowTag: (async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await articleEngagementService.unfollowTag(id, req.userId!));
  }),
} satisfies Record<string, RequestHandler>;
