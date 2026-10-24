import { Worker } from "bullmq";
import { prisma } from "../infrastructure/db.js";
import { bullConnection, bullPrefix } from "../infrastructure/queue.js";
import { notificationService } from "../modules/notifications/notification.service.js";
import { emit } from "../core/events/events.js";

const QUEUE_NAME = "ban-expiry";

export async function processBanExpiry(): Promise<void> {
  const now = new Date();

  const expiredBans = await prisma.moderationBan.findMany({
    where: { type: "temporary", status: "active", expiresAt: { lte: now } },
    select: { id: true, userId: true },
  });

  if (!expiredBans.length) return;

  await prisma.$transaction(async (tx) => {
    await tx.moderationBan.updateMany({
      where: { id: { in: expiredBans.map((b) => b.id) } },
      data:  { status: "expired" },
    });
    await tx.user.updateMany({
      where: { id: { in: expiredBans.map((b) => b.userId) } },
      data:  { bannedUntil: null },
    });
    await tx.moderationLog.createMany({
      data: expiredBans.map((b) => ({
        actorId:    null,
        actorType:  "system",
        action:     "ban.expired",
        targetType: "user",
        targetId:   b.userId,
        reason:     "Temporary ban duration elapsed",
      })),
    });
  });
  for (const b of expiredBans) emit("user.unbanned", { userId: b.userId });

  await Promise.all(
    expiredBans.map((b) =>
      notificationService.dispatch({
        userId:   b.userId,
        type:     "moderation.ban_lifted",
        title:    "Your suspension has ended",
        i18n:     { key: "common:notify.banEnded" },
        body:     "Your temporary suspension has expired. You may now log in again.",
        channels: ["in_app"],
      }),
    ),
  );

  console.log(`[ban-expiry] expired ${expiredBans.length} ban(s)`);
}

export function startBanExpiryWorker() {
  return new Worker(QUEUE_NAME, processBanExpiry, {
    connection: bullConnection,
    prefix:     bullPrefix,
  });
}
