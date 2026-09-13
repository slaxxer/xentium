import { Router } from "express";
import { requireAuth } from "../../shared/middleware/requireAuth.js";
import { requirePermission } from "../../shared/middleware/requirePermission.js";
import { optionalAuth } from "../../shared/middleware/optionalAuth.js";
import { uploadSingle } from "../../shared/middleware/upload.js";
import { CorePermissions } from "@xentium/contracts";
import { articlesController } from "./article.controller.js";
import { commentsController } from "./comment.controller.js";

export const articlesRouter: Router = Router();
export const articleCommentsRouter: Router = Router();

// Public read endpoints — optionalAuth so visibility filtering can see members
articlesRouter.get("/", optionalAuth, articlesController.list);

// Authenticated-only listing of own articles. Placed BEFORE /:slug so it isn't shadowed.
articlesRouter.get("/me", requireAuth, articlesController.listMine);

// Popular tags — static segment, placed before /:slug.
articlesRouter.get("/tags/popular", articlesController.popularTags);

articlesRouter.get("/:slug", optionalAuth, articlesController.getBySlug);

// Write endpoints
articlesRouter.post(
  "/",
  requirePermission(CorePermissions.ARTICLE_CREATE),
  articlesController.create,
);

articlesRouter.patch("/:id", requireAuth, articlesController.update);

articlesRouter.post(
  "/:id/publish",
  requirePermission(CorePermissions.ARTICLE_PUBLISH),
  articlesController.publish,
);

articlesRouter.post("/:id/unpublish", requireAuth, articlesController.unpublish);

articlesRouter.delete("/:id", requireAuth, articlesController.remove);

articlesRouter.get("/:id/revisions", requireAuth, articlesController.listRevisions);

// View tracking — public endpoint, deduped per IP server-side
articlesRouter.post("/:id/view", articlesController.registerView);

articlesRouter.post(
  "/:id/featured-image",
  requireAuth,
  ...uploadSingle("FEATURED_IMAGE", "file"),
  articlesController.uploadFeaturedImage,
);

// Comments nested under articles — optionalAuth so blocked authors can be hidden per viewer
articlesRouter.get("/:id/comments", optionalAuth, commentsController.list);
articlesRouter.post(
  "/:id/comments",
  requirePermission(CorePermissions.ARTICLE_COMMENT_CREATE),
  commentsController.create,
);

// Article likes and dislikes
articlesRouter.post("/:id/like", requireAuth, commentsController.like);
articlesRouter.delete("/:id/like", requireAuth, commentsController.unlike);
articlesRouter.post("/:id/dislike", requireAuth, commentsController.dislike);
articlesRouter.delete("/:id/dislike", requireAuth, commentsController.undislike);

// Comment edit/delete/like — mounted under /api/article-comments
articleCommentsRouter.patch(
  "/:commentId",
  requireAuth,
  commentsController.update,
);
articleCommentsRouter.delete(
  "/:commentId",
  requireAuth,
  commentsController.remove,
);
articleCommentsRouter.post(
  "/:commentId/like",
  requireAuth,
  commentsController.likeComment,
);
articleCommentsRouter.delete(
  "/:commentId/like",
  requireAuth,
  commentsController.unlikeComment,
);
