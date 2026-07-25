// apps/api/src/modules/users/users.controller.ts

import type { RequestHandler } from "express";
import { CorePermissions } from "@nodevo/contracts";
import { userService } from "./users.service.js";
import { permissionsService } from "../permissions/permissions.service.js";
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

export const usersController = {
  getPublicProfile: (async (req, res) => {
    const { username } = getProfileParamsSchema.parse(req.params);
    const viewerId = req.userId;
    const profile = await userService.getPublicProfile(username, viewerId);
    res.json(profile);
  }),

  follow: (async (req, res) => {
    const { id: followingId } = followParamsSchema.parse(req.params);
    const followerId = req.userId!;
    await userService.followUser(followerId, followingId);
    res.status(204).send();
  }),

  unfollow: (async (req, res) => {
    const { id: followingId } = followParamsSchema.parse(req.params);
    const followerId = req.userId!;
    await userService.unfollowUser(followerId, followingId);
    res.status(204).send();
  }),

  getProfileComments: (async (req, res) => {
    const { id: profileUserId } = followParamsSchema.parse(req.params);
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const viewerId = req.userId;
    const result = await userService.getProfileComments(profileUserId, page, limit, viewerId);

    // Also return which comment IDs the authenticated viewer has liked
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

  createProfileComment: (async (req, res) => {
    const { id: profileUserId } = followParamsSchema.parse(req.params);
    const { body } = createCommentSchema.parse(req.body);
    const authorId = req.userId!;
    const comment = await userService.createProfileComment(profileUserId, authorId, body);
    res.status(201).json(comment);
  }),

  updateProfileComment: (async (req, res) => {
    const { commentId } = updateCommentSchema.parse(req.params);
    const { body } = createCommentSchema.parse(req.body);
    const userId = req.userId!;
    const updated = await userService.updateProfileComment(commentId, body, userId);
    res.json(updated);
  }),

  deleteProfileComment: (async (req, res) => {
    const { commentId } = deleteCommentParamsSchema.parse(req.params);
    const userId = req.userId!;
    // Moderator override: previously read a phantom `req.isModerator` that nothing
    // ever set (always false → override was dead code, BUGS.md #6). Resolve it from
    // the actual permission instead.
    const isModerator = await permissionsService.userHasPermission(userId, CorePermissions.PROFILE_COMMENT_DELETE_ANY);
    await userService.deleteProfileComment(commentId, userId, isModerator);
    res.status(204).send();
  }),

  getFollowers: (async (req, res) => {
    const { id } = followParamsSchema.parse(req.params);
    const { page, limit } = paginationSchema.parse(req.query);
    const viewerId = req.userId;
    const result = await userService.getFollowers(id, page, limit, viewerId);
    res.json(result);
  }),

  getFollowing: (async (req, res) => {
    const { id } = followParamsSchema.parse(req.params);
    const { page, limit } = paginationSchema.parse(req.query);
    const viewerId = req.userId;
    const result = await userService.getFollowing(id, page, limit, viewerId);
    res.json(result);
  }),

  block: (async (req, res) => {
    const { id: blockedId } = followParamsSchema.parse(req.params);
    const blockerId = req.userId!;
    await userService.blockUser(blockerId, blockedId);
    res.status(204).send();
  }),

  unblock: (async (req, res) => {
    const { id: blockedId } = followParamsSchema.parse(req.params);
    const blockerId = req.userId!;
    await userService.unblockUser(blockerId, blockedId);
    res.status(204).send();
  }),

  getMyBlocks: (async (req, res) => {
    const userId = req.userId!;
    const { page, limit } = paginationSchema.parse(req.query);
    const result = await userService.getMyBlocks(userId, page, limit);
    res.json(result);
  }),

  searchUsers: (async (req, res) => {
    const { q, limit } = searchQuerySchema.parse(req.query);
    const excludeId = req.userId;
    const results = await userService.searchUsers(q, limit, excludeId);
    res.json(results);
  }),

  getSuggested: (async (req, res) => {
    const userId = req.userId!;
    res.json(await userService.getSuggested(userId, 5));
  }),

  likeProfileComment: (async (req, res) => {
    const { commentId } = deleteCommentParamsSchema.parse(req.params);
    const userId = req.userId!;
    await userService.likeProfileComment(commentId, userId);
    res.status(204).send();
  }),

  unlikeProfileComment: (async (req, res) => {
    const { commentId } = deleteCommentParamsSchema.parse(req.params);
    const userId = req.userId!;
    await userService.unlikeProfileComment(commentId, userId);
    res.status(204).send();
  }),

  getProfileFieldDefinitions: (async (_req, res) => {
    const fields = await userService.getProfileFieldDefinitions();
    res.json(fields);
  }),

  getUserProfileFields: (async (req, res) => {
    const { id } = followParamsSchema.parse(req.params);
    const isAuthenticated = !!req.userId;
    const fields = await userService.getUserPublicProfileFields(id, isAuthenticated);
    res.json(fields);
  }),
} satisfies Record<string, RequestHandler>;
