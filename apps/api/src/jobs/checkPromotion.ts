/**
 * checkPromotion — Phase 7 (§38)
 *
 * Enqueued whenever a user's activity counters change (article publish today;
 * post/thread/like increments wired in Phase 16). Checks whether the user
 * qualifies for the next rung of the progression ladder and promotes if so.
 */

import { Worker, type Job } from "bullmq";
import { prisma } from "../infrastructure/db.js";
import { bullConnection, bullPrefix, queues } from "../infrastructure/queue.js";
import { notificationService } from "../modules/notifications/notification.service.js";
import { permissionCache } from "../modules/permissions/permission.cache.js";
import { progressionCriteriaRegistry } from "../core/progression-registry/progression-criteria-registry.js";

export interface CheckPromotionPayload {
  userId: string;
}

export async function processCheckPromotion(
  job: Job<CheckPromotionPayload>,
): Promise<void> {
  const { userId } = job.data;

  // Respect the global kill-switch
  const enabledSetting = await prisma.setting.findUnique({
    where: { key: "progression.enabled" },
  });
  if (enabledSetting && enabledSetting.value === false) return;

  // Load user with all counters and current group memberships
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      articleCount: true,
      commentCount: true,
      likeCountReceived: true,
      createdAt: true,
      groups: {
        include: {
          group: { include: { progression: true } },
        },
      },
    },
  });
  if (!user) return;

  // Find the user's highest current progression position
  const onLadder = user.groups
    .filter(ug => ug.group.progression?.isProgressionGroup)
    .sort(
      (a, b) =>
        (b.group.progression?.ladderPosition ?? 0) -
        (a.group.progression?.ladderPosition ?? 0),
    );

  const currentProg = onLadder[0] ?? null;
  const currentPos  = currentProg?.group.progression?.ladderPosition ?? 0;

  // Find the immediate next rung above the current position
  const nextRung = await prisma.groupProgression.findFirst({
    where: {
      isProgressionGroup: true,
      ladderPosition:     { gt: currentPos },
    },
    orderBy: { ladderPosition: "asc" },
    include: { group: true },
  });
  if (!nextRung) return; // Already at the top

  // ── Threshold evaluation ─────────────────────────────────────────────────

  const logicSetting = await prisma.setting.findUnique({
    where: { key: "progression.threshold_logic" },
  });
  const useOr = (logicSetting?.value as string) === "or";

  const daysMember = Math.floor(
    (Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24),
  );

  const checks: boolean[] = [];
  if (nextRung.minArticles      != null) checks.push(user.articleCount      >= nextRung.minArticles);
  if (nextRung.minComments      != null) checks.push(user.commentCount      >= nextRung.minComments);
  if (nextRung.minDaysMember    != null) checks.push(daysMember             >= nextRung.minDaysMember);
  if (nextRung.minLikesReceived != null) checks.push(user.likeCountReceived >= nextRung.minLikesReceived);

  // Plugin-contributed criteria (e.g. forum posts/threads) for this target rung.
  // A disabled/uninstalled plugin contributes nothing, so its metrics stop
  // counting toward promotion (intended §38 behavior).
  checks.push(...await progressionCriteriaRegistry.evaluate(userId, nextRung.groupId));

  // No thresholds defined = not yet configured, skip
  if (checks.length === 0) return;

  const qualifies = useOr ? checks.some(Boolean) : checks.every(Boolean);
  if (!qualifies) return;

  // ── Promote ──────────────────────────────────────────────────────────────

  const notifySetting = await prisma.setting.findUnique({
    where: { key: "progression.notify_on_promote" },
  });
  const shouldNotify = notifySetting?.value !== false; // default true

  await prisma.$transaction(async tx => {
    // Remove from the current progression group (if any)
    if (currentProg) {
      await tx.userGroup.deleteMany({
        where: { userId, groupId: currentProg.groupId },
      });
    }

    // Add to the next progression group
    await tx.userGroup.upsert({
      where:  { userId_groupId: { userId, groupId: nextRung.groupId } },
      update: {},
      create: { userId, groupId: nextRung.groupId },
    });

    // The member sees this once, as the "Level up" dialog, next time they are on the site.
    // Only while notices are on: switching them back on later must not replay old climbs.
    if (shouldNotify) {
      await tx.levelUp.create({
        data: { userId, fromGroupId: currentProg?.groupId ?? null, toGroupId: nextRung.groupId },
      });
    }
  });

  // Flush the permission cache — user now has different group memberships
  await permissionCache.invalidate(userId);

  // ── Notify ───────────────────────────────────────────────────────────────

  if (shouldNotify) {
    const badgeName = nextRung.badgeLabel ?? nextRung.group.name;
    await notificationService.dispatch({
      userId,
      type:  "progression.promoted",
      title: `You've been promoted to ${badgeName}!`,
      i18n:  { key: "common:notify.promoted", params: { rank: badgeName } },
      body:  `You've reached a new level. Keep participating to unlock even more.`,
      link:  "/account",
      channels: ["in_app"],
    });
  }

  // Chain-check: re-enqueue in case this promotion itself unlocks the next rung
  await queues.checkPromotion.add(
    "check-promotion",
    { userId },
    { delay: 500 },
  );
}

export function startCheckPromotionWorker(): Worker<CheckPromotionPayload> {
  return new Worker<CheckPromotionPayload>(
    "check-promotion",
    processCheckPromotion,
    { connection: bullConnection, prefix: bullPrefix },
  );
}
