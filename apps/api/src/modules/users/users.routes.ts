// apps/api/src/modules/users/users.routes.ts

import { Router } from "express";
import { usersController } from "./users.controller.js";
import { requireAuth } from "../../shared/middleware/requireAuth.js";
import { optionalAuth } from "../../shared/middleware/optionalAuth.js";
import { makeRateLimiter, byUserId } from "../../shared/middleware/rateLimit.js";
import { progressionController } from "../progression/progression.controller.js";

export const usersRouter: Router = Router();

// Per-user abuse limits (§26). Keyed by user id — placed after requireAuth.
const isDev = process.env.NODE_ENV !== "production";
const followLimiter  = makeRateLimiter("user-follow",          60_000, isDev ? 100000 : 30, byUserId);
const blockLimiter   = makeRateLimiter("user-block",      60 * 60_000, isDev ? 100000 : 50, byUserId);
const pCommentLimiter = makeRateLimiter("profile-comment", 5 * 60_000, isDev ? 100000 : 10, byUserId);

usersRouter.get("/ping", (_req, res) => res.json({ pong: true }));

// Must be before /:id/* routes to prevent shadowing
usersRouter.get("/me/limits", requireAuth, progressionController.getMyLimits);
usersRouter.get("/me/progression", requireAuth, progressionController.getMyProgression);
usersRouter.get("/me/level-up", requireAuth, progressionController.getMyLevelUp);
usersRouter.post("/me/level-up/seen", requireAuth, progressionController.markMyLevelUpSeen);
usersRouter.get("/me/blocks", requireAuth, usersController.getMyBlocks);
usersRouter.get("/suggested", requireAuth, usersController.getSuggested);

// Profile field definitions (public — used by registration form + account settings)
usersRouter.get("/profile-fields", usersController.getProfileFieldDefinitions);

// Username search for @mention autocomplete — must be before /:username
usersRouter.get("/search", requireAuth, usersController.searchUsers);

// Public profile (lookup by username) — optional auth so viewerId resolves isOwn correctly
usersRouter.get("/:username", optionalAuth, usersController.getPublicProfile);

/**
 * A member's standing on the ladder, for their profile's rank rail.
 *
 * PUBLIC and unauthenticated: it says where a member stands, what the site's ladder
 * is, and what the next rung grants — all of which the badge beside their name and
 * the ACP's own ladder already state. It publishes no count the profile does not.
 *
 * ⚠ Lives here rather than under `/progression` because it is addressed BY USER, and
 * `/progression` is the admin's ladder surface. `/me/limits` is the only other
 * non-admin progression route and it answers about the caller, not about a profile.
 */
usersRouter.get("/:id/progression", usersController.getProgression);
// Warnings, bans and IPs: the member and staff only; everyone else gets 403.
usersRouter.get("/:id/standing", requireAuth, usersController.getStanding);

/**
 * Who has looked at this profile lately.
 *
 * PUBLIC, matching the card's place in the profile rail every visitor sees. It names
 * members only — a guest leaves no name to show — and carries nothing the profile
 * page does not already publish.
 */
usersRouter.get("/:id/visitors", usersController.getVisitors);

// Followers / Following (by id) — optionalAuth so the owner can always see
// their own lists even when set to private (§37).
usersRouter.get("/:id/followers", optionalAuth, usersController.getFollowers);
usersRouter.get("/:id/following", optionalAuth, usersController.getFollowing);

// Profile comments (optionalAuth on GET so viewerLikedIds are resolved when authed)
usersRouter.get("/:id/profile-comments", optionalAuth, usersController.getProfileComments);
usersRouter.post("/:id/profile-comments", requireAuth, pCommentLimiter, usersController.createProfileComment);
usersRouter.put("/profile-comments/:commentId", requireAuth, usersController.updateProfileComment);
usersRouter.delete("/profile-comments/:commentId", requireAuth, usersController.deleteProfileComment);
usersRouter.post("/profile-comments/:commentId/like", requireAuth, usersController.likeProfileComment);
usersRouter.delete("/profile-comments/:commentId/like", requireAuth, usersController.unlikeProfileComment);
usersRouter.post("/profile-comments/:commentId/dislike", requireAuth, usersController.dislikeProfileComment);
usersRouter.delete("/profile-comments/:commentId/dislike", requireAuth, usersController.undislikeProfileComment);

// Profile field values for a public profile (auth-aware for privacy filtering)
usersRouter.get("/:id/profile-fields", optionalAuth, usersController.getUserProfileFields);

// Follow / Unfollow
usersRouter.post("/:id/follow", requireAuth, followLimiter, usersController.follow);
usersRouter.delete("/:id/follow", requireAuth, usersController.unfollow);

// Block / Unblock
usersRouter.post("/:id/block", requireAuth, blockLimiter, usersController.block);
usersRouter.delete("/:id/block", requireAuth, usersController.unblock);
