/**
 * The one-time "Level up" dialog.
 *
 * A promotion records the climb; the member's next visit shows it once; dismissing
 * it marks it seen. Switching promotion notices off in the ACP silences the dialog
 * too, because the dialog IS that notice.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import { prisma } from "../../infrastructure/db.js";
import { queues } from "../../infrastructure/queue.js";
import { bustSettingsCache } from "../../shared/utils/settings.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { processCheckPromotion, type CheckPromotionPayload } from "../../jobs/checkPromotion.js";
import { progressionService } from "./progression.service.js";

const P = "lvlprobe";
let userId: string;
let lowId: string;
let highId: string;

const job = (id: string) => ({ data: { userId: id } }) as Job<CheckPromotionPayload>;

async function cleanup() {
  const users = await prisma.user.findMany({ where: { username: { startsWith: `${P}_` } }, select: { id: true } });
  const uids = users.map((u) => u.id);
  await prisma.notification.deleteMany({ where: { userId: { in: uids } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: uids } } });
  await prisma.group.deleteMany({ where: { key: { startsWith: `${P}_` } } });
  await prisma.setting.deleteMany({ where: { key: "progression.notify_on_promote" } });
  bustSettingsCache("progression.notify_on_promote");
}

beforeEach(async () => {
  assertDisposableDatabase();
  await cleanup();
  // The job re-checks after a promotion; nothing should reach Redis from a test.
  vi.spyOn(queues.checkPromotion, "add").mockResolvedValue({} as never);
  // Rungs far above anything else in the table, so "the next rung" is ours.
  lowId = (await prisma.group.create({
    data: { key: `${P}_low`, name: "Rookie", progression: { create: { isProgressionGroup: true, ladderPosition: 9001, badgeLabel: "Rookie" } } },
  })).id;
  highId = (await prisma.group.create({
    data: {
      key: `${P}_high`, name: "Regular",
      progression: { create: { isProgressionGroup: true, ladderPosition: 9002, badgeLabel: "Regular", badgeColor: "#e22b2b", minArticles: 0, maxDailyComments: 50 } },
    },
  })).id;
  userId = (await prisma.user.create({
    data: { username: `${P}_u`, email: `${P}_u@example.test`, passwordHash: "x", groups: { create: { groupId: lowId } } },
  })).id;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanup();
});

describe("the level-up dialog", () => {
  it("is recorded by a promotion, shown once, and gone after it is seen", async () => {
    expect(await progressionService.getPendingLevelUp(userId)).toBeNull();

    await processCheckPromotion(job(userId));
    const pending = await progressionService.getPendingLevelUp(userId);
    expect(pending?.rank).toEqual({ label: "Regular", color: "#e22b2b" });
    expect(pending?.from?.label).toBe("Rookie");
    // What reaching THIS rung gave them.
    expect(pending?.unlocks).toEqual([{ key: "dailyComments", value: 50 }]);

    expect((await progressionService.markLevelUpsSeen(userId)).seen).toBe(1);
    expect(await progressionService.getPendingLevelUp(userId)).toBeNull();
  });

  it("stays silent when promotion notices are off", async () => {
    await prisma.setting.create({ data: { key: "progression.notify_on_promote", value: false } });
    bustSettingsCache("progression.notify_on_promote");
    await processCheckPromotion(job(userId));
    expect(await prisma.userGroup.count({ where: { userId, groupId: highId } })).toBe(1);
    expect(await progressionService.getPendingLevelUp(userId)).toBeNull();
    // Nothing is kept to replay when notices are switched back on.
    expect(await prisma.levelUp.count({ where: { userId } })).toBe(0);
  });

  it("is spent quietly when the rung it names was deleted", async () => {
    await processCheckPromotion(job(userId));
    await prisma.group.delete({ where: { id: highId } });
    expect(await progressionService.getPendingLevelUp(userId)).toBeNull();
    expect(await prisma.levelUp.count({ where: { userId, seenAt: null } })).toBe(0);
  });
});
