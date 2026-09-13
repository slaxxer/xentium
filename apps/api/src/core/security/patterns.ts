import { prisma } from "../../infrastructure/db.js";
import { logger } from "../../infrastructure/logging/logger.js";
import { getSettings } from "../../shared/utils/settings.js";
import { createModerationCase } from "../../modules/moderation/moderationCase.service.js";
import { securityScanRegistry } from "./security-scan-registry.js";

/** §15 baseline detection — the four spec patterns, built into core (free).
 *
 *  Hard rules (spec): informational review cases only — NO auto-action, no
 *  single-signal bans. Thresholds are fixed spec values; each pattern has an
 *  on/off setting (`security.pattern.<type>`, default on). A pattern is also
 *  skipped while an enabled plugin claims it via ctx.claimSecurityPatterns —
 *  the plugin ships an enhanced replacement (corroboration, scoring, tunable
 *  thresholds); disabling the plugin restores the baseline automatically.
 *  The moderator exception whitelist (xcf_reviewed_security_signals) is
 *  respected for device-cookie and IP signals. */

const WINDOW_10M = 10 * 60 * 1000;
const WINDOW_24H = 24 * 60 * 60 * 1000;

const distinctUserIds = (rows: { userId: string | null }[]) =>
  [...new Set(rows.map((r) => r.userId).filter(Boolean))] as string[];

/** 3+ failed logins from the same IP within 10 minutes. */
async function rapidLoginAttempts(): Promise<void> {
  const since = new Date(Date.now() - WINDOW_10M);
  const bursts = await prisma.loginEvent.groupBy({
    by:     ["ip"],
    where:  { success: false, createdAt: { gte: since }, ip: { not: null } },
    _count: { _all: true },
    having: { ip: { _count: { gte: 3 } } },
  });
  for (const row of bursts) {
    if (!row.ip) continue;
    const userIds = distinctUserIds(await prisma.loginEvent.findMany({
      where: { ip: row.ip, success: false, createdAt: { gte: since } }, select: { userId: true }, distinct: ["userId"],
    }));
    await createModerationCase({
      type: "rapid_login_attempts", severity: "medium",
      signals: [`${row._count._all} failed logins from ${row.ip} in 10 min`], userIds,
    });
  }
}

/** 2+ accounts sharing the same first-party device cookie. Cookie-only signal
 *  in the baseline (corroboration is plugin territory). Only cookies active in
 *  the last 24h are considered, so the scan stays bounded as the events table
 *  grows — a cookie is re-examined while it keeps being used, and the 24h case
 *  dedup absorbs repeats. */
async function multiAccountSuspicion(): Promise<void> {
  const since = new Date(Date.now() - WINDOW_24H);
  const shared = (await prisma.$queryRaw`
    SELECT "deviceCookieId" AS cookie, COUNT(DISTINCT "userId")::int AS count
      FROM xcf_login_events
     WHERE "deviceCookieId" IN (
             SELECT DISTINCT "deviceCookieId" FROM xcf_login_events
              WHERE "createdAt" >= ${since} AND "deviceCookieId" IS NOT NULL AND success = true
           )
       AND "userId" IS NOT NULL AND success = true
     GROUP BY "deviceCookieId" HAVING COUNT(DISTINCT "userId") >= 2`) as { cookie: string; count: number }[];

  for (const row of shared) {
    const userIds = distinctUserIds(await prisma.loginEvent.findMany({
      where: { deviceCookieId: row.cookie, userId: { not: null }, success: true }, select: { userId: true }, distinct: ["userId"],
    }));

    const exception = await prisma.reviewedSecuritySignal.findUnique({
      where: { signalType_signalValue: { signalType: "device_cookie", signalValue: row.cookie } },
    });
    if (exception) {
      const newUsers = userIds.filter((uid) => !exception.clearedUserIds.includes(uid));
      if (newUsers.length === 0) continue;   // all within the granted exception
      const cleared = await prisma.user.findMany({
        where: { id: { in: exception.clearedUserIds } }, select: { username: true },
      });
      await createModerationCase({
        type: "multi_account_suspicion", severity: "high",
        signals: [`Device cookie shared by ${row.count} accounts — new account detected (exception only covers: ${cleared.map((u) => u.username).join(", ")})`],
        userIds,
      });
      continue;
    }
    await createModerationCase({
      type: "multi_account_suspicion", severity: "high",
      signals: [`Device cookie ${row.cookie} shared by ${row.count} accounts`], userIds,
    });
  }
}

/** 5+ account registrations from the same IP within 24 hours. */
async function registrationBurst(): Promise<void> {
  const since = new Date(Date.now() - WINDOW_24H);
  const bursts = await prisma.loginEvent.groupBy({
    by:     ["ip"],
    where:  { eventType: "register", createdAt: { gte: since }, ip: { not: null } },
    _count: { _all: true },
    having: { ip: { _count: { gte: 5 } } },
  });
  for (const row of bursts) {
    if (!row.ip) continue;
    const userIds = distinctUserIds(await prisma.loginEvent.findMany({
      where: { ip: row.ip, eventType: "register", createdAt: { gte: since } }, select: { userId: true }, distinct: ["userId"],
    }));
    const exception = await prisma.reviewedSecuritySignal.findUnique({
      where: { signalType_signalValue: { signalType: "ip", signalValue: row.ip } },
    });
    if (exception) {
      const newUsers = userIds.filter((uid) => !exception.clearedUserIds.includes(uid));
      if (newUsers.length === 0) {
        await prisma.moderationLog.create({ data: { actorId: null, actorType: "system", action: "security.exception_active", targetType: "ip", targetId: row.ip, reason: `Registration burst from ${row.ip} matched active exception (case ${exception.caseId})` } });
        continue;
      }
    }
    await createModerationCase({
      type: "registration_burst", severity: "medium",
      signals: [`${row._count._all} registrations from ${row.ip} in 24h${exception ? " — new accounts since exception" : ""}`], userIds,
    });
  }
}

/** New account registered within 10 minutes of a ban, from an IP the banned
 *  user had used. */
async function banEvasionSuspicion(): Promise<void> {
  const since = new Date(Date.now() - WINDOW_24H);
  const recentBans = await prisma.moderationBan.findMany({
    where: { createdAt: { gte: since } },
    select: { userId: true, createdAt: true, user: { select: { username: true } } },
  });
  for (const ban of recentBans) {
    const banWindowEnd = new Date(ban.createdAt.getTime() + WINDOW_10M);
    const evasion = (await prisma.$queryRaw`
      SELECT DISTINCT ip, "userId" AS user_id FROM xcf_login_events
       WHERE event_type = 'register' AND "createdAt" BETWEEN ${ban.createdAt} AND ${banWindowEnd} AND "userId" != ${ban.userId}
         AND ip IN (SELECT DISTINCT ip FROM xcf_login_events WHERE "userId" = ${ban.userId} AND ip IS NOT NULL)`) as { ip: string; user_id: string }[];
    if (evasion.length > 0) {
      const newUserIds = [...new Set(evasion.map((r) => r.user_id))];
      await createModerationCase({
        type: "ban_evasion_suspicion", severity: "high",
        signals: [`New account registered within 10 min of ban on ${ban.user.username}`],
        userIds: [ban.userId, ...newUserIds],
      });
    }
  }
}

const PATTERNS: { type: string; run: () => Promise<void> }[] = [
  { type: "rapid_login_attempts",    run: rapidLoginAttempts    },
  { type: "multi_account_suspicion", run: multiAccountSuspicion },
  { type: "registration_burst",      run: registrationBurst     },
  { type: "ban_evasion_suspicion",   run: banEvasionSuspicion   },
];

export async function runCorePatterns(): Promise<void> {
  const toggles = await getSettings({
    "security.pattern.rapid_login_attempts":    true,
    "security.pattern.multi_account_suspicion": true,
    "security.pattern.registration_burst":      true,
    "security.pattern.ban_evasion_suspicion":   true,
  });
  for (const pattern of PATTERNS) {
    if (toggles[`security.pattern.${pattern.type}` as keyof typeof toggles] === false) continue;
    if (securityScanRegistry.isClaimed(pattern.type)) continue;
    try {
      await pattern.run();
    } catch (err) {
      logger.warn({ pattern: pattern.type, err }, "Core security pattern failed");
    }
  }
}
