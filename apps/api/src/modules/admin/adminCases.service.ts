/**
 * ACP → Moderation → Review Cases: the list with its filters, everything the detail
 * pane shows about each linked account, and who is looking into a case.
 *
 * ⚠ IPs and shared identifiers are computed PER CASE. The list used to fetch the IPs
 * of every user on the page once and attach that one list to every case, so each
 * card showed other cases' addresses as if they were its own evidence.
 */
import { prisma } from "../../infrastructure/db.js";
import { Prisma } from "../../generated/prisma/client.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { resolveAvatar } from "../../shared/utils/resolveAvatar.js";
import { extractBadgeColor, primaryGroupOrder } from "../../shared/utils/userRef.js";
import { buildPaginationMeta, CorePermissions } from "@xentium/contracts";
import { staffGroupKeys } from "../../shared/utils/staff.js";
import { hasPermission } from "../../shared/middleware/requirePermission.js";


export type CaseStatusFilter = "open" | "reviewed" | "all";
export type CaseSort = "new" | "old";
export type AccountStatus = "active" | "banned" | "staff" | "inactive";

export interface CaseAccount {
  id: string;
  username: string;
  avatar: string | null;
  badgeColor: string | null;
  registeredAt: string;
  lastLoginAt: string | null;
  lastIp: string | null;
  status: AccountStatus;
  /** What "Ban all" would do to this account — the preview shows exactly this. */
  willBeBanned: boolean;
}

export interface SharedIdentifier { type: "ip" | "device"; value: string; accounts: number }

function whereFor(opts: { status: CaseStatusFilter; type?: string; severity?: string }): Prisma.ModerationCaseWhereInput {
  return {
    // "Exceptions" are the reviewed cases; "All" includes resolved and dismissed ones too.
    ...(opts.status === "open" ? { status: "open" } : opts.status === "reviewed" ? { status: "reviewed" } : {}),
    ...(opts.type ? { type: opts.type } : {}),
    ...(opts.severity ? { severity: opts.severity } : {}),
  };
}

export const adminCasesService = {
  async listCases(opts: {
    page: number; limit: number; status: CaseStatusFilter; type?: string; severity?: string; sort: CaseSort;
  }) {
    const { page, limit } = opts;
    const where = whereFor(opts);
    const narrowing = { type: opts.type, severity: opts.severity };

    const [rows, total, open, reviewed, all, everything] = await Promise.all([
      prisma.moderationCase.findMany({
        where, skip: (page - 1) * limit, take: limit,
        orderBy: { createdAt: opts.sort === "old" ? "asc" : "desc" },
      }),
      prisma.moderationCase.count({ where }),
      // Segment counts follow the pattern/severity filters, so each says what
      // switching to it would show.
      prisma.moderationCase.count({ where: whereFor({ ...narrowing, status: "open" }) }),
      prisma.moderationCase.count({ where: whereFor({ ...narrowing, status: "reviewed" }) }),
      prisma.moderationCase.count({ where: whereFor({ ...narrowing, status: "all" }) }),
      // Every case at all — the filtered-empty state says how many exist.
      prisma.moderationCase.count(),
    ]);

    const userIds = [...new Set(rows.flatMap((r) => r.linkedUserIds))];
    const assigneeIds = [...new Set(rows.map((r) => r.assignedTo).filter((x): x is string => !!x))];
    const [accounts, assignees, identifiers] = await Promise.all([
      this.accounts(userIds),
      prisma.user.findMany({ where: { id: { in: assigneeIds } }, select: { id: true, username: true, avatar: true } }),
      this.identifiers(userIds),
    ]);
    const assigneeMap = new Map(assignees.map((u) => [u.id, { id: u.id, username: u.username, avatar: resolveAvatar(u.avatar) }]));

    const data = rows.map((r) => {
      const linked = r.linkedUserIds.map((id) => accounts.get(id)).filter((a): a is CaseAccount => !!a);
      // Accounts that still exist: a deleted one cannot be "sharing" anything now.
      const mine = new Set(linked.map((a) => a.id));
      // Identifiers two or more of THIS case's accounts were seen on.
      const shared: SharedIdentifier[] = [];
      for (const [key, users] of identifiers) {
        const n = [...users].filter((u) => mine.has(u)).length;
        if (n >= 2) {
          const [type, value] = key.split("\u0000") as ["ip" | "device", string];
          shared.push({ type, value, accounts: n });
        }
      }
      shared.sort((a, b) => (a.type === b.type ? 0 : a.type === "device" ? -1 : 1));
      const ipAddresses = [...new Set(linked.map((a) => a.lastIp).filter((ip): ip is string => !!ip))];

      return {
        id: r.id,
        type: r.type,
        severity: r.severity,
        status: r.status,
        signals: Array.isArray(r.signals) ? (r.signals as unknown[]).filter((s): s is string => typeof s === "string") : [],
        notes: r.notes,
        createdAt: r.createdAt,
        reviewedAt: r.reviewedAt,
        linkedUserIds: r.linkedUserIds,
        linkedUsers: linked,
        ipAddresses,
        sharedIdentifiers: shared,
        assignedTo: r.assignedTo ? (assigneeMap.get(r.assignedTo) ?? null) : null,
      };
    });

    return {
      data,
      meta: buildPaginationMeta({ page, limit, total }),
      counts: { open, reviewed, all, total: everything },
    };
  },

  /** Each account: when it joined, its last sign-in and address, and what a ban would do. */
  async accounts(ids: string[]): Promise<Map<string, CaseAccount>> {
    if (ids.length === 0) return new Map();
    const [users, lastLogins, activeBans] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: ids } },
        select: {
          id: true, username: true, avatar: true, isActive: true, createdAt: true,
          // One select for both needs: the strongest group's colour, and whether any is staff.
          groups: {
            orderBy: primaryGroupOrder,
            select: { group: { select: { key: true, progression: { select: { badgeColor: true } } } } },
          },
        },
      }),
      prisma.$queryRaw<{ user_id: string; at: Date; ip: string | null }[]>`
        SELECT DISTINCT ON ("userId") "userId" AS user_id, "createdAt" AS at, ip
        FROM xcf_login_events
        WHERE "userId" = ANY(${ids}) AND success = true AND event_type = 'login'
        ORDER BY "userId", "createdAt" DESC`,
      // The same test banCaseUsers uses to skip, so the preview cannot disagree with it.
      prisma.moderationBan.findMany({ where: { userId: { in: ids }, status: "active" }, select: { userId: true } }),
    ]);
    const last = new Map(lastLogins.map((r) => [r.user_id, r]));
    const banned = new Set(activeBans.map((b) => b.userId));
    // Staff are never banned from a case — the same set banCaseUsers skips.
    const staffKeys = await staffGroupKeys();

    return new Map(users.map((u) => {
      const staff = u.groups.some((g) => staffKeys.has(g.group.key));
      const status: AccountStatus = staff ? "staff" : banned.has(u.id) ? "banned" : u.isActive ? "active" : "inactive";
      const l = last.get(u.id);
      return [u.id, {
        id: u.id,
        username: u.username,
        avatar: resolveAvatar(u.avatar),
        badgeColor: extractBadgeColor(u.groups),
        registeredAt: u.createdAt.toISOString(),
        lastLoginAt: l?.at ? new Date(l.at).toISOString() : null,
        lastIp: l?.ip ?? null,
        status,
        willBeBanned: !staff && !banned.has(u.id),
      }];
    }));
  },

  /** Every IP and device cookie the given accounts were seen on: key → the users. */
  async identifiers(ids: string[]): Promise<Map<string, Set<string>>> {
    const out = new Map<string, Set<string>>();
    if (ids.length === 0) return out;
    const rows = await prisma.$queryRaw<{ user_id: string; kind: string; value: string }[]>`
      SELECT DISTINCT "userId" AS user_id, 'ip' AS kind, ip AS value
        FROM xcf_login_events WHERE "userId" = ANY(${ids}) AND ip IS NOT NULL
      UNION
      SELECT DISTINCT "userId", 'device', "deviceCookieId"
        FROM xcf_login_events WHERE "userId" = ANY(${ids}) AND "deviceCookieId" IS NOT NULL
      UNION
      SELECT DISTINCT "userId", 'ip', ip FROM xcf_sessions WHERE "userId" = ANY(${ids}) AND ip IS NOT NULL
      UNION
      SELECT DISTINCT "userId", 'device', "deviceCookieId"
        FROM xcf_sessions WHERE "userId" = ANY(${ids}) AND "deviceCookieId" IS NOT NULL`;
    for (const r of rows) {
      const key = `${r.kind}\u0000${r.value}`;
      if (!out.has(key)) out.set(key, new Set());
      out.get(key)!.add(r.user_id);
    }
    return out;
  },

  /**
   * Who is looking into a case. Only staff can be assigned; null clears it.
   * Logged, so "who picked this up" survives in the mod log.
   */
  async assignCase(caseId: string, actorId: string, userId: string | null) {
    const existing = await prisma.moderationCase.findUnique({ where: { id: caseId }, select: { id: true, assignedTo: true } });
    if (!existing) throw XentiumError.notFound("Case not found");

    let assignee: { id: string; username: string; avatar: string | null } | null = null;
    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true, avatar: true, groups: { select: { group: { select: { key: true } } } } },
      });
      if (!user) throw XentiumError.notFound("User not found");
      // Whoever may work cases may be assigned one — ACP → Permissions decides.
      if (!(await hasPermission(user.id, CorePermissions.MODERATION_CASES_MANAGE))) {
        throw XentiumError.forbidden("Only staff can be assigned a case");
      }
      assignee = { id: user.id, username: user.username, avatar: resolveAvatar(user.avatar) };
    }
    if ((existing.assignedTo ?? null) === (userId ?? null)) return { assignedTo: assignee };

    await prisma.moderationCase.update({ where: { id: caseId }, data: { assignedTo: userId } });
    await prisma.moderationLog.create({
      data: {
        actorId, actorType: "user",
        action: userId ? "case.assigned" : "case.unassigned",
        targetType: "moderation_case", targetId: caseId,
        reason: assignee ? `Assigned to ${assignee.username}` : "Unassigned",
      },
    });
    return { assignedTo: assignee };
  },
};
