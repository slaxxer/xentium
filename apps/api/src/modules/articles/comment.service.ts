import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../infrastructure/db.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { XEC } from "@xentium/contracts";
import { buildPaginationMeta, type PaginatedResponse } from "@xentium/contracts";
import { notificationService } from "../notifications/notification.service.js";
import { resolveAvatar } from "../../shared/utils/resolveAvatar.js";
import { primaryGroupOrder } from "../../shared/utils/userRef.js";
import { getSetting } from "../../shared/utils/settings.js";
import { sanitizeRichText } from "../../shared/sanitize/richText.js";
import { getHiddenAuthorIds } from "../../shared/utils/blocks.js";
import { moderationService } from "../moderation/moderation.service.js";
import { hasPermission } from "../../shared/middleware/requirePermission.js";
import { removeArticleComment } from "./comment.remove.js";
import { CorePermissions } from "@xentium/contracts";
import { enforceCommentLength, enforceDailyCommentLimit } from "../../shared/middleware/contentLimits.js";

const commentInclude = {
  author: {
    select: {
      id: true, username: true, avatar: true,
      groups: {
        orderBy: primaryGroupOrder,
        include: {
          group: { select: { progression: { select: { badgeColor: true } } } },
        },
      },
    },
  },
  deletedBy: {
    select: { id: true, username: true },
  },
  _count: { select: { likes: true, dislikes: true } },
} satisfies Prisma.ArticleCommentInclude;

type CommentRow = Prisma.ArticleCommentGetPayload<{ include: typeof commentInclude }>;

interface CommentNode {
  id: string;
  articleId: string;
  parentId: string | null;
  body: string | null; // null when tombstoned
  author: { id: string; username: string; avatar: string | null; badgeColor: string | null };
  deletedAt: Date | null;
  deletedReason: string | null;
  deletedByUsername: string | null;
  editedAt: Date | null;
  createdAt: Date;
  likeCount: number;
  dislikeCount: number;
  /** How the signed-in viewer reacted (thumbs up / down). Absent for guests. */
  viewerReaction?: "like" | "dislike" | null;
  replies: CommentNode[];
}

function shapeRow(row: CommentRow): CommentNode {
  return {
    id: row.id,
    articleId: row.articleId,
    parentId: row.parentId,
    body: row.deletedAt ? null : row.body,
    author: {
      id:         row.author.id,
      username:   row.author.username,
      avatar:     resolveAvatar(row.author.avatar),
      badgeColor: row.author.groups[0]?.group.progression?.badgeColor ?? null,
    },
    deletedAt:         row.deletedAt,
    deletedReason:     row.deletedReason,
    deletedByUsername: row.deletedBy?.username ?? null,
    editedAt:          row.editedAt,
    createdAt:         row.createdAt,
    likeCount:         row._count.likes,
    dislikeCount:      row._count.dislikes,
    replies:           [],
  };
}

const DEFAULT_EDIT_WINDOW_MINUTES = 15;

async function getEditWindowMs(): Promise<number> {
  const setting = await prisma.setting.findUnique({
    where: { key: "article_comments.edit_window_minutes" },
  });
  const minutes =
    typeof setting?.value === "number"
      ? setting.value
      : DEFAULT_EDIT_WINDOW_MINUTES;
  return minutes * 60 * 1000;
}

export const commentService = {
  async list(
    articleId: string,
    page: number,
    limit: number,
    viewerId?: string,
  ): Promise<PaginatedResponse<CommentNode>> {
    // Show published comments publicly — pending ones await moderation. Deleted
    // comments are left out entirely: no tombstone. (Deleting a top-level comment
    // takes its replies with it, see `removeArticleComment`.)
    // Blocked users' comments are hidden entirely from the viewer (block always hides).
    const hiddenAuthorIds = await getHiddenAuthorIds(viewerId);
    const authorFilter = hiddenAuthorIds.length ? { authorId: { notIn: hiddenAuthorIds } } : {};
    const where: Prisma.ArticleCommentWhereInput = {
      articleId,
      parentId: null,
      status: "published",
      deletedAt: null,
      ...authorFilter,
    };

    const [topLevel, total] = await Promise.all([
      prisma.articleComment.findMany({
        where,
        include: commentInclude,
        orderBy: { createdAt: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.articleComment.count({ where }),
    ]);

    const parentIds = topLevel.map((c) => c.id);
    const replies =
      parentIds.length === 0
        ? []
        : await prisma.articleComment.findMany({
            where: { parentId: { in: parentIds }, status: "published", deletedAt: null, ...authorFilter },
            include: commentInclude,
            orderBy: { createdAt: "asc" },
          });

    const byParent = new Map<string, CommentNode[]>();
    for (const r of replies) {
      const list = byParent.get(r.parentId!) ?? [];
      list.push(shapeRow(r));
      byParent.set(r.parentId!, list);
    }

    const data = topLevel.map((row) => {
      const shaped = shapeRow(row);
      shaped.replies = byParent.get(row.id) ?? [];
      return shaped;
    });

    // The viewer's own thumbs, so a reload shows what they already gave.
    if (viewerId) {
      const all = [...data, ...data.flatMap((c) => c.replies)];
      const ids = all.map((c) => c.id);
      const [likes, dislikes] = await Promise.all([
        prisma.articleCommentLike.findMany({ where: { userId: viewerId, commentId: { in: ids } }, select: { commentId: true } }),
        prisma.articleCommentDislike.findMany({ where: { userId: viewerId, commentId: { in: ids } }, select: { commentId: true } }),
      ]);
      const liked = new Set(likes.map((l) => l.commentId));
      const disliked = new Set(dislikes.map((d) => d.commentId));
      for (const c of all) c.viewerReaction = liked.has(c.id) ? "like" : disliked.has(c.id) ? "dislike" : null;
    }

    return { data, meta: buildPaginationMeta({ page, limit, total }) };
  },

  async create(
    articleId: string,
    authorId: string,
    body: string,
    parentId: string | null,
  ): Promise<CommentNode & { pending?: true }> {
    // Check admin settings before allowing comment creation
    const [allowComments, requireApproval] = await Promise.all([
      getSetting("articles.allow_comments", true),
      getSetting("articles.require_comment_approval", false),
    ]);

    if (!allowComments) {
      throw new XentiumError({
        code: XEC.API_FORBIDDEN,
        httpStatus: 403,
        message: "Comments are currently disabled",
      });
    }

    // Enforce progression content limits (§38, Phase 7)
    await enforceDailyCommentLimit(authorId);
    await enforceCommentLength(authorId, body);

    const commentStatus = requireApproval ? "pending" : "published";

    const article = await prisma.article.findUnique({
      where: { id: articleId },
      select: { id: true, deletedAt: true, status: true, authorId: true, hiddenAt: true, commentsClosedAt: true },
    });
    // A hidden article is not there for anyone but its author and `article.hide`.
    const hiddenFromAuthor = !!article?.hiddenAt && article.authorId !== authorId
      && !(await hasPermission(authorId, CorePermissions.ARTICLE_HIDE));
    if (!article || article.deletedAt || hiddenFromAuthor) {
      throw new XentiumError({
        code: XEC.ARTICLE_NOT_FOUND,
        httpStatus: 404,
        message: "Article not found",
      });
    }
    if (article.status !== "published") {
      throw new XentiumError({
        code: XEC.ARTICLE_NOT_PUBLISHED,
        httpStatus: 400,
        message: "Article is not published",
      });
    }
    // Closed by staff: only `article.comment.closed` may still post (replies too).
    if (article.commentsClosedAt && !(await hasPermission(authorId, CorePermissions.ARTICLE_COMMENT_CLOSED))) {
      throw new XentiumError({
        code: XEC.ARTICLE_COMMENTS_CLOSED,
        httpStatus: 403,
        message: "Comments on this article are closed",
      });
    }

    if (parentId) {
      const parent = await prisma.articleComment.findUnique({
        where: { id: parentId },
        select: { articleId: true, parentId: true, deletedAt: true },
      });
      if (!parent || parent.articleId !== articleId || parent.deletedAt) {
        throw new XentiumError({
          code: XEC.API_NOT_FOUND,
          httpStatus: 404,
          message: "Parent comment not found",
        });
      }
      if (parent.parentId !== null) {
        // §33 — threaded one level only
        throw new XentiumError({
          code: XEC.API_VALIDATION,
          httpStatus: 400,
          message: "Replies are limited to one level",
        });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const created = await tx.articleComment.create({
        data: { articleId, authorId, body: sanitizeRichText(body), parentId: parentId ?? null, status: commentStatus },
        include: commentInclude,
      });
      // Only count published comments — on the article, and on the author for
      // the progression `min_comments` threshold (§38).
      if (commentStatus === "published") {
        await tx.article.update({
          where: { id: articleId },
          data: { commentCount: { increment: 1 } },
        });
        await tx.user.update({
          where: { id: authorId },
          data: { commentCount: { increment: 1 } },
        });
      }
      return created;
    });

    const shaped = shapeRow(result);
    if (commentStatus === "pending") {
      return { ...shaped, pending: true };
    }
    return shaped;
  },

  async update(
    commentId: string,
    viewerId: string,
    body: string,
  ): Promise<CommentNode> {
    const existing = await prisma.articleComment.findUnique({
      where: { id: commentId },
      include: commentInclude,
    });
    if (!existing || existing.deletedAt) {
      throw new XentiumError({
        code: XEC.API_NOT_FOUND,
        httpStatus: 404,
        message: "Comment not found",
      });
    }
    if (existing.authorId !== viewerId) {
      throw new XentiumError({
        code: XEC.PERM_DENIED,
        httpStatus: 403,
        message: "Cannot edit this comment",
      });
    }

    const editWindow = await getEditWindowMs();
    if (Date.now() - existing.createdAt.getTime() > editWindow) {
      throw new XentiumError({
        code: XEC.PERM_DENIED,
        httpStatus: 403,
        message: "Edit window has closed",
      });
    }

    await enforceCommentLength(viewerId, body);

    const updated = await prisma.articleComment.update({
      where: { id: commentId },
      data: { body: sanitizeRichText(body), editedAt: new Date() },
      include: commentInclude,
    });
    return shapeRow(updated);
  },

  /**
   * Delete a comment. Your own needs `article.comment.delete.own` (or `.any`); anyone
   * else's needs `article.comment.delete.any` and a reason, and goes through the same
   * moderator path ModCanvas uses, so it lands in the moderation log either way.
   */
  async softDelete(
    commentId: string,
    viewerId: string,
    can: { own: boolean; any: boolean },
    reason: string | undefined,
  ): Promise<void> {
    const existing = await prisma.articleComment.findUnique({
      where: { id: commentId },
      select: { id: true, articleId: true, authorId: true, deletedAt: true, status: true },
    });
    if (!existing || existing.deletedAt) {
      throw new XentiumError({
        code: XEC.API_NOT_FOUND,
        httpStatus: 404,
        message: "Comment not found",
      });
    }

    const isOwn = existing.authorId === viewerId;
    if (isOwn ? !(can.own || can.any) : !can.any) {
      throw new XentiumError({
        code: XEC.PERM_DENIED,
        httpStatus: 403,
        message: "Cannot delete this comment",
      });
    }
    if (!isOwn && !reason) {
      throw new XentiumError({
        code: XEC.API_VALIDATION,
        httpStatus: 400,
        message: "Reason required for moderator deletion",
      });
    }
    if (!isOwn) return moderationService.moderatorDeleteArticleComment(commentId, viewerId, reason!);

    await prisma.$transaction((tx) => removeArticleComment(tx, commentId, viewerId, null));
  },
};

export const articleLikeService = {
  async like(articleId: string, userId: string): Promise<{ likeCount: number; dislikeCount: number }> {
    const article = await prisma.article.findUnique({
      where: { id: articleId },
      select: { id: true, deletedAt: true, status: true, authorId: true },
    });
    if (!article || article.deletedAt || article.status !== "published") {
      throw new XentiumError({ code: XEC.ARTICLE_NOT_FOUND, httpStatus: 404, message: "Article not found" });
    }
    if (article.authorId === userId) {
      throw new XentiumError({ code: XEC.API_VALIDATION, httpStatus: 400, message: "Cannot like your own article" });
    }

    const counts = await prisma.$transaction(async (tx) => {
      // Idempotent: already liked
      const existing = await tx.articleLike.findUnique({ where: { articleId_userId: { articleId, userId } } });
      if (existing) {
        return tx.article.findUniqueOrThrow({ where: { id: articleId }, select: { likeCount: true, dislikeCount: true } });
      }

      await tx.articleLike.create({ data: { articleId, userId } });

      // Remove any existing dislike — mutual exclusion
      const removedDislike = await tx.articleDislike.deleteMany({ where: { articleId, userId } });

      const updated = await tx.article.update({
        where: { id: articleId },
        data: {
          likeCount:    { increment: 1 },
          dislikeCount: removedDislike.count > 0 ? { decrement: 1 } : undefined,
        },
        select: { likeCount: true, dislikeCount: true },
      });
      await tx.user.update({ where: { id: article.authorId }, data: { likeCountReceived: { increment: 1 } } });
      return updated;
    });

    return counts;
  },

  async unlike(articleId: string, userId: string): Promise<{ likeCount: number; dislikeCount: number }> {
    const article = await prisma.article.findUnique({ where: { id: articleId }, select: { id: true, authorId: true } });
    if (!article) {
      throw new XentiumError({ code: XEC.ARTICLE_NOT_FOUND, httpStatus: 404, message: "Article not found" });
    }

    const counts = await prisma.$transaction(async (tx) => {
      const deleted = await tx.articleLike.deleteMany({ where: { articleId, userId } });
      if (deleted.count === 0) {
        return tx.article.findUniqueOrThrow({ where: { id: articleId }, select: { likeCount: true, dislikeCount: true } });
      }
      const updated = await tx.article.update({
        where: { id: articleId },
        data: { likeCount: { decrement: 1 } },
        select: { likeCount: true, dislikeCount: true },
      });
      await tx.user.update({ where: { id: article.authorId }, data: { likeCountReceived: { decrement: 1 } } });
      return updated;
    });

    return counts;
  },
};

/** A comment's thumbs, after a change. */
async function commentReactionCounts(commentId: string): Promise<{ likeCount: number; dislikeCount: number }> {
  const [likeCount, dislikeCount] = await Promise.all([
    prisma.articleCommentLike.count({ where: { commentId } }),
    prisma.articleCommentDislike.count({ where: { commentId } }),
  ]);
  return { likeCount, dislikeCount };
}

export const commentLikeService = {
  async like(commentId: string, userId: string): Promise<{ likeCount: number; dislikeCount: number }> {
    const comment = await prisma.articleComment.findUnique({
      where: { id: commentId },
      select: { authorId: true, deletedAt: true, articleId: true },
    });
    if (!comment || comment.deletedAt) {
      throw new XentiumError({
        code: XEC.API_NOT_FOUND,
        httpStatus: 404,
        message: "Comment not found",
      });
    }

    let isNew = false;
    await prisma.$transaction(async (tx) => {
      // A thumbs-up replaces a thumbs-down: one or the other, never both.
      await tx.articleCommentDislike.deleteMany({ where: { commentId, userId } });
      try {
        await tx.articleCommentLike.create({ data: { commentId, userId } });
        isNew = true;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          return;
        }
        throw err;
      }
      await tx.user.update({
        where: { id: comment.authorId },
        data: { likeCountReceived: { increment: 1 } },
      });
    });

    if (isNew && comment.authorId !== userId) {
      const liker = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
      // ⚠ The reader is addressed by SLUG; a link by id opened "not found".
      const article = await prisma.article.findUnique({ where: { id: comment.articleId }, select: { slug: true } });
      if (liker && article) {
        await notificationService.dispatch({
          userId:       comment.authorId,
          type:         "article.comment_liked",
          title:        "Someone liked your comment",
          i18n:         { key: "common:notify.articleCommentLiked", params: { name: liker.username } },
          body:         `${liker.username} liked your comment.`,
          link:         `/articles/${encodeURIComponent(article.slug)}?comment=${commentId}`,
          meta:         { commentId, likerId: userId },
          senderUserId: userId,
          channels:     ["in_app"],
        });
      }
    }

    return commentReactionCounts(commentId);
  },

  async unlike(commentId: string, userId: string): Promise<{ likeCount: number; dislikeCount: number }> {
    const comment = await prisma.articleComment.findUnique({
      where: { id: commentId },
      select: { authorId: true },
    });
    if (!comment) return { likeCount: 0, dislikeCount: 0 };

    await prisma.$transaction(async (tx) => {
      const deleted = await tx.articleCommentLike.deleteMany({ where: { commentId, userId } });
      if (deleted.count === 0) return;
      await tx.user.update({
        where: { id: comment.authorId },
        data: { likeCountReceived: { decrement: 1 } },
      });
    });

    return commentReactionCounts(commentId);
  },
};

/**
 * Thumbs-down on a comment. No notification (nobody is told they were disliked) and
 * no effect on the author's received likes beyond the like it replaces.
 */
export const commentDislikeService = {
  async dislike(commentId: string, userId: string): Promise<{ likeCount: number; dislikeCount: number }> {
    const comment = await prisma.articleComment.findUnique({
      where: { id: commentId },
      select: { authorId: true, deletedAt: true },
    });
    if (!comment || comment.deletedAt) {
      throw new XentiumError({ code: XEC.API_NOT_FOUND, httpStatus: 404, message: "Comment not found" });
    }
    if (comment.authorId === userId) {
      throw new XentiumError({ code: XEC.API_VALIDATION, httpStatus: 400, message: "Cannot dislike your own comment" });
    }
    await prisma.$transaction(async (tx) => {
      // A thumbs-down replaces a thumbs-up, and takes back the like it counted.
      const removed = await tx.articleCommentLike.deleteMany({ where: { commentId, userId } });
      if (removed.count > 0) {
        await tx.user.update({ where: { id: comment.authorId }, data: { likeCountReceived: { decrement: 1 } } });
      }
      await tx.articleCommentDislike.upsert({
        where: { commentId_userId: { commentId, userId } }, update: {}, create: { commentId, userId },
      });
    });
    return commentReactionCounts(commentId);
  },

  async undislike(commentId: string, userId: string): Promise<{ likeCount: number; dislikeCount: number }> {
    await prisma.articleCommentDislike.deleteMany({ where: { commentId, userId } });
    return commentReactionCounts(commentId);
  },
};

export const articleDislikeService = {
  async dislike(articleId: string, userId: string): Promise<{ likeCount: number; dislikeCount: number }> {
    const article = await prisma.article.findUnique({
      where: { id: articleId },
      select: { id: true, deletedAt: true, status: true, authorId: true },
    });
    if (!article || article.deletedAt || article.status !== "published") {
      throw new XentiumError({ code: XEC.ARTICLE_NOT_FOUND, httpStatus: 404, message: "Article not found" });
    }
    if (article.authorId === userId) {
      throw new XentiumError({ code: XEC.API_VALIDATION, httpStatus: 400, message: "Cannot dislike your own article" });
    }

    const counts = await prisma.$transaction(async (tx) => {
      // Idempotent: already disliked
      const existing = await tx.articleDislike.findUnique({ where: { articleId_userId: { articleId, userId } } });
      if (existing) {
        return tx.article.findUniqueOrThrow({ where: { id: articleId }, select: { likeCount: true, dislikeCount: true } });
      }

      await tx.articleDislike.create({ data: { articleId, userId } });

      // Remove any existing like — mutual exclusion
      const removedLike = await tx.articleLike.deleteMany({ where: { articleId, userId } });
      if (removedLike.count > 0) {
        await tx.user.update({ where: { id: article.authorId }, data: { likeCountReceived: { decrement: 1 } } });
      }

      return tx.article.update({
        where: { id: articleId },
        data: {
          dislikeCount: { increment: 1 },
          likeCount:    removedLike.count > 0 ? { decrement: 1 } : undefined,
        },
        select: { likeCount: true, dislikeCount: true },
      });
    });

    return counts;
  },

  async undislike(articleId: string, userId: string): Promise<{ likeCount: number; dislikeCount: number }> {
    const article = await prisma.article.findUnique({ where: { id: articleId }, select: { id: true } });
    if (!article) {
      throw new XentiumError({ code: XEC.ARTICLE_NOT_FOUND, httpStatus: 404, message: "Article not found" });
    }

    const counts = await prisma.$transaction(async (tx) => {
      const deleted = await tx.articleDislike.deleteMany({ where: { articleId, userId } });
      if (deleted.count === 0) {
        return tx.article.findUniqueOrThrow({ where: { id: articleId }, select: { likeCount: true, dislikeCount: true } });
      }
      return tx.article.update({
        where: { id: articleId },
        data: { dislikeCount: { decrement: 1 } },
        select: { likeCount: true, dislikeCount: true },
      });
    });

    return counts;
  },
};
