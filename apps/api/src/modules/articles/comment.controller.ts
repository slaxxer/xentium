import type { RequestHandler } from "express";
import { prisma } from "../../infrastructure/db.js";
import { CorePermissions } from "@nodevo/contracts";
import {
  articleLikeService,
  articleDislikeService,
  commentLikeService,
  commentService,
} from "./comment.service.js";
import {
  commentIdParamSchema,
  createCommentSchema,
  deleteCommentSchema,
  listCommentsQuerySchema,
  updateCommentSchema,
} from "./comment.validation.js";
import { articleIdParamSchema } from "./article.validation.js";

async function hasPermission(userId: string, key: string): Promise<boolean> {
  const count = await prisma.groupPermission.count({
    where: {
      permission: { key },
      group: { users: { some: { userId } } },
    },
  });
  return count > 0;
}

export const commentsController = {
  list: (async (req, res) => {
    const { id: articleId } = articleIdParamSchema.parse(req.params);
    const { page, limit } = listCommentsQuerySchema.parse(req.query);
    const viewerId = req.userId;
    const result = await commentService.list(articleId, page, limit, viewerId);
    res.json(result);
  }),

  create: (async (req, res) => {
    const { id: articleId } = articleIdParamSchema.parse(req.params);
    const { body, parentId } = createCommentSchema.parse(req.body);
    const userId = req.userId!;
    const created = await commentService.create(articleId, userId, body, parentId ?? null);
    res.status(201).json(created);
  }),

  update: (async (req, res) => {
    const { commentId } = commentIdParamSchema.parse(req.params);
    const { body } = updateCommentSchema.parse(req.body);
    const userId = req.userId!;
    const updated = await commentService.update(commentId, userId, body);
    res.json(updated);
  }),

  remove: (async (req, res) => {
    const { commentId } = commentIdParamSchema.parse(req.params);
    const { reason } = deleteCommentSchema.parse(req.body ?? {});
    const userId = req.userId!;
    const canModerate = await hasPermission(userId, CorePermissions.ARTICLE_COMMENT_DELETE_ANY);
    await commentService.softDelete(commentId, userId, canModerate, reason);
    res.status(204).send();
  }),

  like: (async (req, res) => {
    const { id: articleId } = articleIdParamSchema.parse(req.params);
    const userId = req.userId!;
    const result = await articleLikeService.like(articleId, userId);
    res.json(result);
  }),

  unlike: (async (req, res) => {
    const { id: articleId } = articleIdParamSchema.parse(req.params);
    const userId = req.userId!;
    const result = await articleLikeService.unlike(articleId, userId);
    res.json(result);
  }),

  dislike: (async (req, res) => {
    const { id: articleId } = articleIdParamSchema.parse(req.params);
    const userId = req.userId!;
    const result = await articleDislikeService.dislike(articleId, userId);
    res.json(result);
  }),

  undislike: (async (req, res) => {
    const { id: articleId } = articleIdParamSchema.parse(req.params);
    const userId = req.userId!;
    const result = await articleDislikeService.undislike(articleId, userId);
    res.json(result);
  }),

  likeComment: (async (req, res) => {
    const { commentId } = commentIdParamSchema.parse(req.params);
    const userId = req.userId!;
    const result = await commentLikeService.like(commentId, userId);
    res.json(result);
  }),

  unlikeComment: (async (req, res) => {
    const { commentId } = commentIdParamSchema.parse(req.params);
    const userId = req.userId!;
    const result = await commentLikeService.unlike(commentId, userId);
    res.json(result);
  }),
} satisfies Record<string, RequestHandler>;
