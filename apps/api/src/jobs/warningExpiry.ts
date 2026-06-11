import { Worker } from "bullmq";
import { prisma } from "../infrastructure/db.js";
import { bullConnection, bullPrefix } from "../infrastructure/queue.js";
import { moderationService } from "../modules/moderation/moderation.service.js";

const QUEUE_NAME = "warning-expiry";

export async function processWarningExpiry(): Promise<void> {
  const now = new Date();

  const expiredWarnings = await prisma.moderationWarning.findMany({
    where:  { status: "active", expiresAt: { lte: now } },
    select: { id: true, userId: true },
  });

  if (!expiredWarnings.length) return;

  await prisma.moderationWarning.updateMany({
    where: { id: { in: expiredWarnings.map((w) => w.id) } },
    data:  { status: "expired" },
  });

  // Re-check thresholds for affected users (expiry may allow them off a threshold)
  const userIds = [...new Set(expiredWarnings.map((w) => w.userId))];
  await Promise.all(
    userIds.map((userId) => moderationService.checkThresholds(userId, userId).catch(() => null)),
  );

  console.log(`[warning-expiry] expired ${expiredWarnings.length} warning(s)`);
}

export function startWarningExpiryWorker() {
  return new Worker(QUEUE_NAME, processWarningExpiry, {
    connection: bullConnection,
    prefix:     bullPrefix,
  });
}
