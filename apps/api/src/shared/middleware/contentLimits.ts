/**
 * Content limit helpers — Phase 7 (§38)
 *
 * Reads the author's effective limits from group_progression and throws
 * XEC-PERM-1040 / XEC-PERM-1041 when a limit is exceeded.
 *
 * These cover CORE content only — articles and article comments. Plugin content
 * (forum posts, shoutbox messages, …) is limited by the plugin that owns it,
 * against its own per-group config; see `registerProgressionCriteria`.
 */

import { prisma } from "../../infrastructure/db.js";
import { XentiumError } from "../errors/XentiumError.js";
import { XEC } from "@xentium/contracts";

/** Resolve the effective progression limits for a user. */
async function getEffectiveLimits(userId: string) {
  const groups = await prisma.userGroup.findMany({
    where: { userId },
    include: {
      group: { include: { progression: true } },
    },
  });

  // Use the highest ladder-position group that has limits set
  const withProgression = groups
    .filter(ug => ug.group.progression?.isProgressionGroup)
    .sort(
      (a, b) =>
        (b.group.progression?.ladderPosition ?? 0) -
        (a.group.progression?.ladderPosition ?? 0),
    );

  return withProgression[0]?.group.progression ?? null;
}

/** The group whose progression config governs a user, or null when off-ladder.
 *  Exposed to plugins so they can look up their OWN per-group limits against
 *  the same rung core promotes to. */
export async function getEffectiveProgressionGroupId(
  userId: string,
): Promise<string | null> {
  const prog = await getEffectiveLimits(userId);
  return prog?.groupId ?? null;
}

function throwTooLong(max: number, actual: number): never {
  throw new XentiumError({
    code: XEC.PERM_CONTENT_TOO_LONG,
    httpStatus: 422,
    message: `Content too long for your current level. Maximum is ${max.toLocaleString()} characters (yours: ${actual.toLocaleString()}).`,
  });
}

/**
 * Throw XEC-PERM-1040 when `bodyPlain` exceeds the user's `max_article_length`.
 * Call before persisting the body on create or update.
 */
export async function enforceArticleLength(
  userId: string,
  bodyPlain: string | null,
): Promise<void> {
  if (!bodyPlain) return;
  const prog = await getEffectiveLimits(userId);
  if (!prog?.maxArticleLength) return; // null = unlimited

  if (bodyPlain.length > prog.maxArticleLength) throwTooLong(prog.maxArticleLength, bodyPlain.length);
}

/**
 * Throw XEC-PERM-1040 when `body` exceeds the user's `max_comment_length`.
 * Call before persisting an article comment on create or update.
 */
export async function enforceCommentLength(
  userId: string,
  body: string | null,
): Promise<void> {
  if (!body) return;
  const prog = await getEffectiveLimits(userId);
  if (!prog?.maxCommentLength) return; // null = unlimited

  if (body.length > prog.maxCommentLength) throwTooLong(prog.maxCommentLength, body.length);
}

/**
 * Throw XEC-PERM-1041 when the user has already hit `max_daily_articles` today.
 * Call before creating a new article.
 */
export async function enforceDailyArticleLimit(userId: string): Promise<void> {
  const prog = await getEffectiveLimits(userId);
  if (!prog?.maxDailyArticles) return; // null = unlimited

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const todayCount = await prisma.article.count({
    where: {
      authorId:  userId,
      deletedAt: null,
      createdAt: { gte: startOfDay },
    },
  });

  if (todayCount >= prog.maxDailyArticles) {
    throw new XentiumError({
      code: XEC.PERM_DAILY_LIMIT,
      httpStatus: 422,
      message: `Daily article limit reached. Your current level allows ${prog.maxDailyArticles} article${prog.maxDailyArticles !== 1 ? "s" : ""} per day.`,
    });
  }
}

/**
 * Throw XEC-PERM-1041 when the user has already hit `max_daily_comments` today.
 * Call before creating a new article comment.
 */
export async function enforceDailyCommentLimit(userId: string): Promise<void> {
  const prog = await getEffectiveLimits(userId);
  if (!prog?.maxDailyComments) return; // null = unlimited

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const todayCount = await prisma.articleComment.count({
    where: {
      authorId:  userId,
      deletedAt: null,
      createdAt: { gte: startOfDay },
    },
  });

  if (todayCount >= prog.maxDailyComments) {
    throw new XentiumError({
      code: XEC.PERM_DAILY_LIMIT,
      httpStatus: 422,
      message: `Daily comment limit reached. Your current level allows ${prog.maxDailyComments} comment${prog.maxDailyComments !== 1 ? "s" : ""} per day.`,
    });
  }
}
