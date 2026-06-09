/**
 * Content limit helpers — Phase 7 (§38)
 *
 * Reads the author's effective limits from group_progression and throws
 * NEC-PERM-1040 / NEC-PERM-1041 when a limit is exceeded.
 */

import { prisma } from "../../infrastructure/db.js";
import { NodevoError } from "../errors/NodevoError.js";
import { NEC } from "@nodevo/contracts";

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

/**
 * Throw NEC-PERM-1040 when `bodyPlain` exceeds the user's `max_post_length`.
 * Call before persisting the body on create or update.
 */
export async function enforcePostLength(
  userId: string,
  bodyPlain: string | null,
): Promise<void> {
  if (!bodyPlain) return;
  const prog = await getEffectiveLimits(userId);
  if (!prog?.maxPostLength) return; // null = unlimited

  if (bodyPlain.length > prog.maxPostLength) {
    throw new NodevoError({
      code: NEC.PERM_CONTENT_TOO_LONG,
      httpStatus: 422,
      message: `Content too long for your current level. Maximum is ${prog.maxPostLength.toLocaleString()} characters (yours: ${bodyPlain.length.toLocaleString()}).`,
    });
  }
}

/**
 * Throw NEC-PERM-1041 when the user has already hit `max_daily_posts` today.
 * Call before creating a new article.
 */
export async function enforceDailyPostLimit(userId: string): Promise<void> {
  const prog = await getEffectiveLimits(userId);
  if (!prog?.maxDailyPosts) return; // null = unlimited

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const todayCount = await prisma.article.count({
    where: {
      authorId:  userId,
      deletedAt: null,
      createdAt: { gte: startOfDay },
    },
  });

  if (todayCount >= prog.maxDailyPosts) {
    throw new NodevoError({
      code: NEC.PERM_DAILY_LIMIT,
      httpStatus: 422,
      message: `Daily post limit reached. Your current level allows ${prog.maxDailyPosts} article${prog.maxDailyPosts !== 1 ? "s" : ""} per day.`,
    });
  }
}
