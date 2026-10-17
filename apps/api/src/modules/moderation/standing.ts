/**
 * A member's standing — the profile's "Warnings" tab.
 *
 * Who may read it is the whole point: the member themselves, and staff (admin,
 * supermod, moderator). Nobody else learns that it exists. What each sees:
 *   - the member: their warnings (active, expired, pardoned) with who issued them, the
 *     escalation ladder, and — when the NEXT warning would trigger a sanction — the
 *     alert that says so;
 *   - staff: all of that, plus the member's bans and the IP addresses they used, with
 *     the country each belongs to (looked up locally, see infrastructure/geoip.ts).
 */
import { prisma } from "../../infrastructure/db.js";
import { countryOf, geoipAvailable } from "../../infrastructure/geoip.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { badgeColorSelect, toUserRef } from "../../shared/utils/userRef.js";
import { CorePermissions } from "@xentium/contracts";
import { hasPermission } from "../../shared/middleware/requirePermission.js";
import { moderationService } from "./moderation.service.js";
import { getModPolicy } from "./moderationPolicy.js";
import type { ThresholdRule } from "./moderation.types.js";

export type EffectiveWarningStatus = "active" | "expired" | "pardoned";

/**
 * What a warning IS right now. A warning past its date is expired even before the
 * nightly job flips the row — the ladder already stopped counting it.
 */
export function effectiveStatus(w: { status: string; expiresAt: Date | null }, now = new Date()): EffectiveWarningStatus {
  if (w.status === "pardoned") return "pardoned";
  if (w.status === "expired" || (w.expiresAt && w.expiresAt <= now)) return "expired";
  return "active";
}

/**
 * Where the member stands on the ladder: the next step that SANCTIONS (a ban), how
 * many warnings until it, and whether the very next warning is the one. `notify`
 * steps only tell the moderators, so they are not what a member is warned about.
 */
export function ladderPosition(ladder: ThresholdRule[], counted: number) {
  const sorted = [...ladder].sort((a, b) => a.warningCount - b.warningCount);
  const next = sorted.find((r) => r.warningCount > counted && r.action !== "notify") ?? null;
  return {
    ladder: sorted.map((r) => ({ warningCount: r.warningCount, action: r.action, banDays: r.banDays ?? null })),
    next: next ? { warningCount: next.warningCount, action: next.action, banDays: next.banDays ?? null, remaining: next.warningCount - counted } : null,
  };
}

export async function getStanding(userId: string, viewerId: string) {
  const isOwn = userId === viewerId;
  // Another member's record: whoever may warn (ACP → Permissions). Their bans and
  // addresses additionally need ban rights — the same split as the moderation API.
  const isStaff = await hasPermission(viewerId, CorePermissions.MODERATION_WARN_MANAGE);
  const seesBans = await hasPermission(viewerId, CorePermissions.MODERATION_BAN_MANAGE);
  if (!isOwn && !isStaff) throw XentiumError.forbidden("Only the member and the moderation team can see this");

  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!target) throw XentiumError.notFound("User not found");

  const policy = await getModPolicy();
  const now = new Date();
  const [rows, counted] = await Promise.all([
    prisma.moderationWarning.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { issuedBy: { select: { id: true, username: true, avatar: true, ...badgeColorSelect } } },
    }),
    moderationService.countedWarnings(userId, policy.resetAfterBan, now),
  ]);
  const pardoners = [...new Set(rows.map((w) => w.pardonedBy).filter((x): x is string => !!x))];
  const pardonUsers = pardoners.length
    ? await prisma.user.findMany({ where: { id: { in: pardoners } }, select: { id: true, username: true } })
    : [];

  const warnings = rows.map((w) => ({
    id: w.id,
    reason: w.reason,
    status: effectiveStatus(w, now),
    createdAt: w.createdAt,
    expiresAt: w.expiresAt,
    pardonedAt: w.pardonedAt,
    pardonedBy: pardonUsers.find((u) => u.id === w.pardonedBy)?.username ?? null,
    issuedBy: { ...toUserRef(w.issuedBy), avatar: w.issuedBy.avatar },
  }));

  const base = {
    isOwn,
    isStaff,
    counted,
    resetAfterBan: policy.resetAfterBan,
    ...ladderPosition(policy.ladder, counted),
    warnings,
  };
  if (!isStaff || !seesBans) return base;

  return { ...base, bans: await moderationService.getUserBans(userId), ips: await ipsOf(userId), geoip: { available: geoipAvailable() } };
}

/**
 * The addresses a member signed in from or used a session on, newest first, each
 * with its country and how many OTHER accounts were seen on it — the first thing a
 * moderator checks for a second account.
 */
async function ipsOf(userId: string) {
  const rows = await prisma.$queryRaw<Array<{ ip: string; first: Date; last: Date; uses: number }>>`
    SELECT ip, min(at) AS first, max(at) AS last, count(*)::int AS uses FROM (
      SELECT ip, "createdAt" AS at FROM xcf_login_events WHERE "userId" = ${userId} AND ip IS NOT NULL
      UNION ALL
      SELECT ip, "lastUsedAt" AS at FROM xcf_sessions WHERE "userId" = ${userId} AND ip IS NOT NULL
    ) x GROUP BY ip ORDER BY max(at) DESC LIMIT 20`;
  if (!rows.length) return [];
  const shared = await prisma.$queryRaw<Array<{ ip: string; others: number }>>`
    SELECT ip, count(DISTINCT "userId")::int AS others FROM (
      SELECT ip, "userId" FROM xcf_login_events WHERE ip = ANY(${rows.map((r) => r.ip)}) AND "userId" IS NOT NULL AND "userId" <> ${userId}
      UNION
      SELECT ip, "userId" FROM xcf_sessions WHERE ip = ANY(${rows.map((r) => r.ip)}) AND "userId" <> ${userId}
    ) y GROUP BY ip`;
  return rows.map((r) => ({
    ip: r.ip,
    country: countryOf(r.ip),
    firstSeen: r.first,
    lastSeen: r.last,
    uses: r.uses,
    otherAccounts: shared.find((s) => s.ip === r.ip)?.others ?? 0,
  }));
}
