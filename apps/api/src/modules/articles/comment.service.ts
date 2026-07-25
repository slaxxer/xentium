import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../infrastructure/db.js";
import { NodevoError } from "../../shared/errors/NodevoError.js";
import { NEC } from "@nodevo/contracts";
import { buildPaginationMeta, type PaginatedResponse } from "@nodevo/contracts";
import { notificationService } from "../notifications/notification.service.js";
import { resolveAvatar } from "../../shared/utils/resolveAvatar.js";
import { primaryGroupOrder } from "../../shared/utils/userRef.js";
import { getSetting } from "../../shared/utils/settings.js";
import { sanitizeRichText } from "../../shared/sanitize/richText.js";
import { getHiddenAuthorIds } from "../../shared/utils/blocks.js";
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
  _count: { select: { likes: true } },
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
    // comments ARE returned: shapeRow() hides their body and the reader renders
    // a tombstone in their place (§33), mirroring profile-wall behaviour.
    // Blocked users' comments are hidden entirely from the viewer (block always hides).
    const hiddenAuthorIds = await getHiddenAuthorIds(viewerId);
    const authorFilter = hiddenAuthorIds.length ? { authorId: { notIn: hiddenAuthorIds } } : {};
    const where: Prisma.ArticleCommentWhereInput = {
      articleId,
      parentId: null,
      status: "published",
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
            where: { parentId: { in: parentIds }, status: "published", ...authorFilter },
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
      throw new NodevoError({
        code: NEC.API_FORBIDDEN,
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
      select: { id: true, deletedAt: true, status: true },
    });
    if (!article || article.deletedAt) {
      throw new NodevoError({
        code: NEC.ARTICLE_NOT_FOUND,
        httpStatus: 404,
        message: "Article not found",
      });
    }
    if (article.status !== "published") {
      throw new NodevoError({
        code: NEC.ARTICLE_NOT_PUBLISHED,
        httpStatus: 400,
        message: "Article is not published",
      });
    }

    if (parentId) {
      const parent = await prisma.articleComment.findUnique({
        where: { id: parentId },
        select: { articleId: true, parentId: true, deletedAt: true },
      });
      if (!parent || parent.articleId !== articleId || parent.deletedAt) {
        throw new NodevoError({
          code: NEC.API_NOT_FOUND,
          httpStatus: 404,
          message: "Parent comment not found",
        });
      }
      if (parent.parentId !== null) {
        // §33 — threaded one level only
        throw new NodevoError({
          code: NEC.API_VALIDATION,
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
      throw new NodevoError({
        code: NEC.API_NOT_FOUND,
        httpStatus: 404,
        message: "Comment not found",
      });
    }
    if (existing.authorId !== viewerId) {
      throw new NodevoError({
        code: NEC.PERM_DENIED,
        httpStatus: 403,
        message: "Cannot edit this comment",
      });
    }

    const editWindow = await getEditWindowMs();
    if (Date.now() - existing.createdAt.getTime() > editWindow) {
      throw new NodevoError({
        code: NEC.PERM_DENIED,
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

  async softDelete(
    commentId: string,
    viewerId: string,
    canModerate: boolean,
    reason: string | undefined,
  ): Promise<void> {
    const existing = await prisma.articleComment.findUnique({
      where: { id: commentId },
      select: { id: true, articleId: true, authorId: true, deletedAt: true, status: true },
    });
    if (!existing || existing.deletedAt) {
      throw new NodevoError({
        code: NEC.API_NOT_FOUND,
        httpStatus: 404,
        message: "Comment not found",
      });
    }

    const isOwn = existing.authorId === viewerId;
    if (!isOwn && !canModerate) {
      throw new NodevoError({
        code: NEC.PERM_DENIED,
        httpStatus: 403,
        message: "Cannot delete this comment",
      });
    }
    if (!isOwn && !reason) {
      throw new NodevoError({
        code: NEC.API_VALIDATION,
        httpStatus: 400,
        message: "Reason required for moderator deletion",
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.articleComment.update({
        where: { id: commentId },
        data: {
          deletedAt: new Date(),
          deletedById: viewerId,
          deletedReason: isOwn ? null : reason,
        },
      });
      // Mirror create: only a published comment was ever counted.
      if (existing.status === "published") {
        await tx.article.update({
          where: { id: existing.articleId },
          data: { commentCount: { decrement: 1 } },
        });
        await tx.user.update({
          where: { id: existing.authorId },
          data: { commentCount: { decrement: 1 } },
        });
      }
    });
  },
};

export const articleLikeService = {
  async like(articleId: string, userId: string): Promise<{ likeCount: number; dislikeCount: number }> {
    const article = await prisma.article.findUnique({
      where: { id: articleId },
      select: { id: true, deletedAt: true, status: true, authorId: true },
    });
    if (!article || article.deletedAt || article.status !== "published") {
      throw new NodevoError({ code: NEC.ARTICLE_NOT_FOUND, httpStatus: 404, message: "Article not found" });
    }
    if (article.authorId === userId) {
      throw new NodevoError({ code: NEC.API_VALIDATION, httpStatus: 400, message: "Cannot like your own article" });
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
      throw new NodevoError({ code: NEC.ARTICLE_NOT_FOUND, httpStatus: 404, message: "Article not found" });
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

export const commentLikeService = {
  async like(commentId: string, userId: string): Promise<{ likeCount: number }> {
    const comment = await prisma.articleComment.findUnique({
      where: { id: commentId },
      select: { authorId: true, deletedAt: true, articleId: true },
    });
    if (!comment || comment.deletedAt) {
      throw new NodevoError({
        code: NEC.API_NOT_FOUND,
        httpStatus: 404,
        message: "Comment not found",
      });
    }

    let isNew = false;
    await prisma.$transaction(async (tx) => {
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
      if (liker) {
        await notificationService.dispatch({
          userId:       comment.authorId,
          type:         "article.comment_liked",
          title:        "Someone liked your comment",
          body:         `${liker.username} liked your comment.`,
          link:         `/articles/${comment.articleId}`,
          meta:         { commentId, likerId: userId },
          senderUserId: userId,
          channels:     ["in_app"],
        });
      }
    }

    const likeCount = await prisma.articleCommentLike.count({ where: { commentId } });
    return { likeCount };
  },

  async unlike(commentId: string, userId: string): Promise<{ likeCount: number }> {
    const comment = await prisma.articleComment.findUnique({
      where: { id: commentId },
      select: { authorId: true },
    });
    if (!comment) return { likeCount: 0 };

    await prisma.$transaction(async (tx) => {
      const deleted = await tx.articleCommentLike.deleteMany({ where: { commentId, userId } });
      if (deleted.count === 0) return;
      await tx.user.update({
        where: { id: comment.authorId },
        data: { likeCountReceived: { decrement: 1 } },
      });
    });

    const likeCount = await prisma.articleCommentLike.count({ where: { commentId } });
    return { likeCount };
  },
};

export const articleDislikeService = {
  async dislike(articleId: string, userId: string): Promise<{ likeCount: number; dislikeCount: number }> {
    const article = await prisma.article.findUnique({
      where: { id: articleId },
      select: { id: true, deletedAt: true, status: true, authorId: true },
    });
    if (!article || article.deletedAt || article.status !== "published") {
      throw new NodevoError({ code: NEC.ARTICLE_NOT_FOUND, httpStatus: 404, message: "Article not found" });
    }
    if (article.authorId === userId) {
      throw new NodevoError({ code: NEC.API_VALIDATION, httpStatus: 400, message: "Cannot dislike your own article" });
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
      throw new NodevoError({ code: NEC.ARTICLE_NOT_FOUND, httpStatus: 404, message: "Article not found" });
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
