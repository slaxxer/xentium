// apps/api/src/modules/users/users.controller.ts

import type { RequestHandler } from "express";
import { userService } from "./users.service.js";
import { prisma } from "../../infrastructure/db.js";
import {
  getProfileParamsSchema,
  followParamsSchema,
  createCommentSchema,
  updateCommentSchema,
  deleteCommentParamsSchema,
  paginationSchema,
  searchQuerySchema,
} from "./users.validation.js";

const wrap =
  (fn: RequestHandler): RequestHandler =>
  async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      next(err);
    }
  };

export const usersController = {
  getPublicProfile: wrap(async (req, res) => {
    const { username } = getProfileParamsSchema.parse(req.params);
    const viewerId = (req as any).userId as string | undefined;
    const profile = await userService.getPublicProfile(username, viewerId);
    res.json(profile);
  }),

  follow: wrap(async (req, res) => {
    const { id: followingId } = followParamsSchema.parse(req.params);
    const followerId = (req as any).userId as string;
    await userService.followUser(followerId, followingId);
    res.status(204).send();
  }),

  unfollow: wrap(async (req, res) => {
    const { id: followingId } = followParamsSchema.parse(req.params);
    const followerId = (req as any).userId as string;
    await userService.unfollowUser(followerId, followingId);
    res.status(204).send();
  }),

  getProfileComments: wrap(async (req, res) => {
    const { id: profileUserId } = followParamsSchema.parse(req.params);
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const result = await userService.getProfileComments(profileUserId, page, limit);

    // Also return which comment IDs the authenticated viewer has liked
    const viewerId = (req as any).userId as string | undefined;
    let viewerLikedIds: string[] = [];
    if (viewerId && result.comments.length > 0) {
      const commentIds = result.comments.map((c: any) => c.id);
      const likes = await prisma.profileCommentLike.findMany({
        where: { commentId: { in: commentIds }, userId: viewerId },
        select: { commentId: true },
      });
      viewerLikedIds = likes.map((l) => l.commentId);
    }

    res.json({ ...result, viewerLikedIds });
  }),

  createProfileComment: wrap(async (req, res) => {
    const { id: profileUserId } = followParamsSchema.parse(req.params);
    const { body } = createCommentSchema.parse(req.body);
    const authorId = (req as any).userId as string;
    const comment = await userService.createProfileComment(profileUserId, authorId, body);
    res.status(201).json(comment);
  }),

  updateProfileComment: wrap(async (req, res) => {
    const { commentId } = updateCommentSchema.parse(req.params);
    const { body } = createCommentSchema.parse(req.body);
    const userId = (req as any).userId as string;
    const updated = await userService.updateProfileComment(commentId, body, userId);
    res.json(updated);
  }),

  deleteProfileComment: wrap(async (req, res) => {
    const { commentId } = deleteCommentParamsSchema.parse(req.params);
    const userId = (req as any).userId as string;
    const isModerator = !!(req as any).isModerator;
    await userService.deleteProfileComment(commentId, userId, isModerator);
    res.status(204).send();
  }),

  getFollowers: wrap(async (req, res) => {
    const { id } = followParamsSchema.parse(req.params);
    const { page, limit } = paginationSchema.parse(req.query);
    const viewerId = (req as any).userId as string | undefined;
    const result = await userService.getFollowers(id, page, limit, viewerId);
    res.json(result);
  }),

  getFollowing: wrap(async (req, res) => {
    const { id } = followParamsSchema.parse(req.params);
    const { page, limit } = paginationSchema.parse(req.query);
    const viewerId = (req as any).userId as string | undefined;
    const result = await userService.getFollowing(id, page, limit, viewerId);
    res.json(result);
  }),

  block: wrap(async (req, res) => {
    const { id: blockedId } = followParamsSchema.parse(req.params);
    const blockerId = (req as any).userId as string;
    await userService.blockUser(blockerId, blockedId);
    res.status(204).send();
  }),

  unblock: wrap(async (req, res) => {
    const { id: blockedId } = followParamsSchema.parse(req.params);
    const blockerId = (req as any).userId as string;
    await userService.unblockUser(blockerId, blockedId);
    res.status(204).send();
  }),

  getMyBlocks: wrap(async (req, res) => {
    const userId = (req as any).userId as string;
    const { page, limit } = paginationSchema.parse(req.query);
    const result = await userService.getMyBlocks(userId, page, limit);
    res.json(result);
  }),

  searchUsers: wrap(async (req, res) => {
    const { q, limit } = searchQuerySchema.parse(req.query);
    const excludeId = (req as any).userId as string | undefined;
    const results = await userService.searchUsers(q, limit, excludeId);
    res.json(results);
  }),

  getSuggested: wrap(async (req, res) => {
    const userId = (req as any).userId as string;
    res.json(await userService.getSuggested(userId, 5));
  }),

  likeProfileComment: wrap(async (req, res) => {
    const { commentId } = deleteCommentParamsSchema.parse(req.params);
    const userId = (req as any).userId as string;
    await userService.likeProfileComment(commentId, userId);
    res.status(204).send();
  }),

  unlikeProfileComment: wrap(async (req, res) => {
    const { commentId } = deleteCommentParamsSchema.parse(req.params);
    const userId = (req as any).userId as string;
    await userService.unlikeProfileComment(commentId, userId);
    res.status(204).send();
  }),

  getProfileFieldDefinitions: wrap(async (_req, res) => {
    const fields = await userService.getProfileFieldDefinitions();
    res.json(fields);
  }),

  getUserProfileFields: wrap(async (req, res) => {
    const { id } = followParamsSchema.parse(req.params);
    const isAuthenticated = !!(req as any).userId;
    const fields = await userService.getUserPublicProfileFields(id, isAuthenticated);
    res.json(fields);
  }),
} satisfies Record<string, RequestHandler>;
