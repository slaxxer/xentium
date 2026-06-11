/**
 * Security analysis job — Phase 10 (§15)
 *
 * Runs every 30 minutes. Scans LoginEvent for suspicious patterns and creates
 * ModerationCase rows for moderator review. No auto-action taken.
 */
import { Worker } from "bullmq";
import { prisma } from "../infrastructure/db.js";
import { bullConnection, bullPrefix } from "../infrastructure/queue.js";
import { notificationService } from "../modules/notifications/notification.service.js";
import type { CaseType } from "../modules/moderation/moderation.types.js";

const QUEUE_NAME = "security-analysis";
const WINDOW_10M  = 10 * 60 * 1000;
const WINDOW_24H  = 24 * 60 * 60 * 1000;

async function notifyCaseModerators(_caseId: string) {
  const perm = await prisma.permission.findUnique({ where: { key: "moderation.cases.manage" }, select: { id: true } });
  if (!perm) return;
  const holders = await prisma.userGroup.findMany({
    where:  { group: { permissions: { some: { permissionId: perm.id } } } },
    select: { userId: true },
    distinct: ["userId"],
  });
  await Promise.all(
    holders.map((h) =>
      notificationService.dispatch({
        userId:   h.userId,
        type:     "mod.new_case",
        title:    "New review case",
        body:     "A suspicious pattern was detected and requires moderator review.",
        link:     "/admin/moderation/cases",
        channels: ["in_app"],
      }),
    ),
  );
}

async function createCase(type: CaseType, severity: "low" | "medium" | "high", signals: string[], userIds: string[]) {
  const existing = await prisma.moderationCase.findFirst({
    where: {
      type,
      status: "open",
      linkedUserIds: { hasEvery: userIds },
      createdAt: { gte: new Date(Date.now() - WINDOW_24H) },
    },
  });
  if (existing) return;

  const newCase = await prisma.moderationCase.create({
    data: { type, severity, status: "open", signals, linkedUserIds: userIds },
  });
  await notifyCaseModerators(newCase.id);
}

export async function processSecurityAnalysis(): Promise<void> {
  const since10m = new Date(Date.now() - WINDOW_10M);
  const since24h = new Date(Date.now() - WINDOW_24H);

  // 1. Rapid login attempts: 3+ failures from same IP in 10 min
  const failedByIp = await prisma.$queryRaw<{ ip: string; count: bigint }[]>`
    SELECT ip, COUNT(*) as count
    FROM "LoginEvent"
    WHERE success = false
      AND "createdAt" >= ${since10m}
      AND ip IS NOT NULL
    GROUP BY ip
    HAVING COUNT(*) >= 3
  `;

  for (const row of failedByIp) {
    const userIds = await prisma.loginEvent.findMany({
      where: { ip: row.ip, success: false, createdAt: { gte: since10m } },
      select: { userId: true },
      distinct: ["userId"],
    }).then((rows) => rows.map((r) => r.userId).filter(Boolean) as string[]);

    await createCase(
      "rapid_login_attempts",
      "medium",
      [`${row.count} failed logins from ${row.ip} in 10 min`],
      userIds,
    );
  }

  // 2. Multi-account suspicion: same device cookie linked to 2+ users
  const sharedCookies = await prisma.$queryRaw<{ deviceCookieId: string; count: bigint }[]>`
    SELECT "deviceCookieId", COUNT(DISTINCT "userId") as count
    FROM "LoginEvent"
    WHERE "deviceCookieId" IS NOT NULL
      AND "userId" IS NOT NULL
      AND success = true
    GROUP BY "deviceCookieId"
    HAVING COUNT(DISTINCT "userId") >= 2
  `;

  for (const row of sharedCookies) {
    const userIds = await prisma.loginEvent.findMany({
      where: { deviceCookieId: row.deviceCookieId, userId: { not: null }, success: true },
      select: { userId: true },
      distinct: ["userId"],
    }).then((rows) => rows.map((r) => r.userId).filter(Boolean) as string[]);

    // Check exception whitelist for this device cookie.
    const exception = await prisma.reviewedSecuritySignal.findUnique({
      where: { signalType_signalValue: { signalType: "device_cookie", signalValue: row.deviceCookieId } },
    });

    if (exception) {
      const newUsers = userIds.filter((uid) => !exception.clearedUserIds.includes(uid));

      if (newUsers.length === 0) {
        // All accounts are within the granted exception — skip silently.
        // Only new accounts on this signal should produce any output.
        continue;
      }

      // New account(s) appeared on a whitelisted signal — exception doesn't cover them.
      const clearedUsers = await prisma.user.findMany({
        where:  { id: { in: exception.clearedUserIds } },
        select: { username: true },
      });
      const clearedNames = clearedUsers.map((u) => u.username).join(", ");
      await createCase(
        "multi_account_suspicion",
        "high",
        [`Device cookie shared by ${row.count} accounts — new account detected (exception only covers: ${clearedNames})`],
        userIds,
      );
      continue;
    }

    await createCase(
      "multi_account_suspicion",
      "high",
      [`Device cookie ${row.deviceCookieId} shared by ${row.count} accounts`],
      userIds,
    );
  }

  // 3. Registration burst: 5+ accounts from same IP in 24h
  const regBurst = await prisma.$queryRaw<{ ip: string; count: bigint }[]>`
    SELECT ip, COUNT(*) as count
    FROM "LoginEvent"
    WHERE "event_type" = 'register'
      AND "createdAt" >= ${since24h}
      AND ip IS NOT NULL
    GROUP BY ip
    HAVING COUNT(*) >= 5
  `;

  for (const row of regBurst) {
    const userIds = await prisma.loginEvent.findMany({
      where: { ip: row.ip, eventType: "register", createdAt: { gte: since24h } },
      select: { userId: true },
      distinct: ["userId"],
    }).then((rows) => rows.map((r) => r.userId).filter(Boolean) as string[]);

    const ipException = await prisma.reviewedSecuritySignal.findUnique({
      where: { signalType_signalValue: { signalType: "ip", signalValue: row.ip } },
    });
    if (ipException) {
      const newUsers = userIds.filter((uid) => !ipException.clearedUserIds.includes(uid));
      if (newUsers.length === 0) {
        await prisma.moderationLog.create({
          data: { actorId: null, actorType: "system", action: "security.exception_active", targetType: "ip", targetId: row.ip, reason: `Registration burst from ${row.ip} matched active exception (case ${ipException.caseId})` },
        });
        continue;
      }
    }

    await createCase(
      "registration_burst",
      "medium",
      [`${row.count} registrations from ${row.ip} in 24h${ipException ? " — new accounts since exception" : ""}`],
      userIds,
    );
  }

  // 4. Ban evasion suspicion: new account registered within 10 min of a ban from same IP
  const recentBans = await prisma.moderationBan.findMany({
    where:   { createdAt: { gte: since24h } },
    include: { user: { select: { id: true } } },
  });

  for (const ban of recentBans) {
    const banTime    = ban.createdAt.getTime();
    const banTimeEnd = new Date(banTime + WINDOW_10M);

    const evasionIps = await prisma.$queryRaw<{ ip: string; userId: string }[]>`
      SELECT DISTINCT ip, "userId"
      FROM "LoginEvent"
      WHERE "event_type" = 'register'
        AND "createdAt" BETWEEN ${ban.createdAt} AND ${banTimeEnd}
        AND "userId" != ${ban.userId}
        AND ip IN (
          SELECT DISTINCT ip FROM "LoginEvent"
          WHERE "userId" = ${ban.userId} AND ip IS NOT NULL
        )
    `;

    if (evasionIps.length > 0) {
      const newUserIds = [...new Set(evasionIps.map((r) => r.userId))];
      await createCase(
        "ban_evasion_suspicion",
        "high",
        [`New account registered within 10 min of ban on user ${ban.userId}`],
        [ban.userId, ...newUserIds],
      );
    }
  }
}

export function startSecurityAnalysisWorker() {
  return new Worker(QUEUE_NAME, processSecurityAnalysis, {
    connection: bullConnection,
    prefix:     bullPrefix,
  });
}
