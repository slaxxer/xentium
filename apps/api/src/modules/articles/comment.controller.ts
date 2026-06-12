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

interface AuthedReq {
  userId?: string;
}
const reqUserId = (req: unknown) => (req as AuthedReq).userId;

async function hasPermission(userId: string, key: string): Promise<boolean> {
  const count = await prisma.groupPermission.count({
    where: {
      permission: { key },
      group: { users: { some: { userId } } },
    },
  });
  return count > 0;
}

const wrap =
  (fn: RequestHandler): RequestHandler =>
  async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      next(err);
    }
  };

export const commentsController = {
  list: wrap(async (req, res) => {
    const { id: articleId } = articleIdParamSchema.parse(req.params);
    const { page, limit } = listCommentsQuerySchema.parse(req.query);
    const viewerId = reqUserId(req);
    const result = await commentService.list(articleId, page, limit, viewerId);
    res.json(result);
  }),

  create: wrap(async (req, res) => {
    const { id: articleId } = articleIdParamSchema.parse(req.params);
    const { body, parentId } = createCommentSchema.parse(req.body);
    const userId = reqUserId(req)!;
    const created = await commentService.create(articleId, userId, body, parentId ?? null);
    res.status(201).json(created);
  }),

  update: wrap(async (req, res) => {
    const { commentId } = commentIdParamSchema.parse(req.params);
    const { body } = updateCommentSchema.parse(req.body);
    const userId = reqUserId(req)!;
    const updated = await commentService.update(commentId, userId, body);
    res.json(updated);
  }),

  remove: wrap(async (req, res) => {
    const { commentId } = commentIdParamSchema.parse(req.params);
    const { reason } = deleteCommentSchema.parse(req.body ?? {});
    const userId = reqUserId(req)!;
    const canModerate = await hasPermission(userId, CorePermissions.ARTICLE_COMMENT_DELETE_ANY);
    await commentService.softDelete(commentId, userId, canModerate, reason);
    res.status(204).send();
  }),

  like: wrap(async (req, res) => {
    const { id: articleId } = articleIdParamSchema.parse(req.params);
    const userId = reqUserId(req)!;
    const result = await articleLikeService.like(articleId, userId);
    res.json(result);
  }),

  unlike: wrap(async (req, res) => {
    const { id: articleId } = articleIdParamSchema.parse(req.params);
    const userId = reqUserId(req)!;
    const result = await articleLikeService.unlike(articleId, userId);
    res.json(result);
  }),

  dislike: wrap(async (req, res) => {
    const { id: articleId } = articleIdParamSchema.parse(req.params);
    const userId = reqUserId(req)!;
    const result = await articleDislikeService.dislike(articleId, userId);
    res.json(result);
  }),

  undislike: wrap(async (req, res) => {
    const { id: articleId } = articleIdParamSchema.parse(req.params);
    const userId = reqUserId(req)!;
    const result = await articleDislikeService.undislike(articleId, userId);
    res.json(result);
  }),

  likeComment: wrap(async (req, res) => {
    const { commentId } = commentIdParamSchema.parse(req.params);
    const userId = reqUserId(req)!;
    const result = await commentLikeService.like(commentId, userId);
    res.json(result);
  }),

  unlikeComment: wrap(async (req, res) => {
    const { commentId } = commentIdParamSchema.parse(req.params);
    const userId = reqUserId(req)!;
    const result = await commentLikeService.unlike(commentId, userId);
    res.json(result);
  }),
} satisfies Record<string, RequestHandler>;
