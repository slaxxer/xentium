import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../infrastructure/db.js";
import { buildPaginationMeta } from "@xentium/contracts";

export interface ActivityEntry {
  category: "page_visit" | "acp_action";
  userId?: string | null;
  username?: string | null;
  method?: string | null;
  path: string;
  status?: number | null;
  ip?: string | null;
  userAgent?: string | null;
  meta?: Prisma.InputJsonValue;
}

export interface ActivityRow {
  id: string;
  category: string;
  userId: string | null;
  username: string | null;
  method: string | null;
  path: string;
  status: number | null;
  ip: string | null;
  userAgent: string | null;
  /** A failed ACP action's error: `{ code, message }`. */
  error: { code?: string; message?: string } | null;
  createdAt: Date;
}

/** Who an actor is, for the avatar and the "Mod" tag: their highest-precedence group. */
export interface ActivityActor {
  username: string;
  avatar: string | null;
  group: { key: string; name: string } | null;
}

export interface ActivityFilters {
  category?: "page_visit" | "acp_action";
  /** Free text over the path and the username. */
  q?: string;
  userId?: string;
  ip?: string;
  since?: Date;
  methods?: string[];
  /** `ok` = an action that succeeded (status < 400); `err` = one that failed. */
  result?: "ok" | "err";
}

/** The filters as a WHERE — everything but the category, which the tabs count across. */
function whereOf(f: ActivityFilters, withCategory: boolean): Prisma.ActivityLogWhereInput {
  const and: Prisma.ActivityLogWhereInput[] = [];
  if (withCategory && f.category) and.push({ category: f.category });
  if (f.userId) and.push({ userId: f.userId });
  if (f.ip) and.push({ ip: f.ip });
  if (f.since) and.push({ createdAt: { gte: f.since } });
  if (f.methods?.length) and.push({ method: { in: f.methods } });
  if (f.result === "ok") and.push({ status: { lt: 400 } });
  if (f.result === "err") and.push({ status: { gte: 400 } });
  if (f.q) {
    and.push({ OR: [
      { path: { contains: f.q, mode: "insensitive" } },
      { username: { contains: f.q, mode: "insensitive" } },
    ] });
  }
  return and.length ? { AND: and } : {};
}

const USER_PATH = /^\/api\/admin\/users\/([^/]+)/;
const GROUP_PATH = /^\/api\/admin\/groups\/([^/]+)/;

/**
 * Names for the user and group ids in action paths on this page, ready to print:
 * `@spamlord` for a user, `Moderator` for a group.
 */
async function targetsOf(rows: Array<{ path: string; category: string }>): Promise<Record<string, string>> {
  const actions = rows.filter((r) => r.category === "acp_action");
  const idsOf = (re: RegExp) => [...new Set(actions.map((r) => re.exec(r.path)?.[1]).filter((x): x is string => !!x))];
  const [userIds, groupIds] = [idsOf(USER_PATH), idsOf(GROUP_PATH).filter((id) => id !== "reorder")];
  const [users, groups] = await Promise.all([
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true } }) : [],
    groupIds.length ? prisma.group.findMany({ where: { id: { in: groupIds } }, select: { id: true, name: true } }) : [],
  ]);
  return {
    ...Object.fromEntries(users.map((u) => [u.id, `@${u.username}`])),
    ...Object.fromEntries(groups.map((g) => [g.id, g.name])),
  };
}

/** Highest-precedence group per user — what the log shows next to a name. */
async function actorsOf(userIds: string[]): Promise<Record<string, ActivityActor>> {
  if (!userIds.length) return {};
  const users = await prisma.user.findMany({
    where:  { id: { in: userIds } },
    select: {
      id: true, username: true, avatar: true,
      groups: { select: { group: { select: { key: true, name: true, displayOrder: true } } } },
    },
  });
  return Object.fromEntries(users.map((u) => {
    const top = u.groups.map((g) => g.group).sort((a, b) => a.displayOrder - b.displayOrder)[0];
    return [u.id, { username: u.username, avatar: u.avatar, group: top ? { key: top.key, name: top.name } : null }];
  }));
}

export const activityService = {
  /** Fire-and-forget — logging must never break a request. */
  log(entry: ActivityEntry): void {
    prisma.activityLog
      .create({
        data: {
          category: entry.category,
          userId: entry.userId ?? null,
          username: entry.username ?? null,
          method: entry.method ?? null,
          path: entry.path.slice(0, 500),
          status: entry.status ?? null,
          ip: entry.ip ?? null,
          userAgent: entry.userAgent?.slice(0, 400) ?? null,
          ...(entry.meta !== undefined ? { meta: entry.meta } : {}),
        },
      })
      .catch(() => { /* swallow — telemetry is best-effort */ });
  },

  /** Record "user X was on page P" durably (one row per user+path, upserted).
   *  Fire-and-forget like log() — a failed mark never breaks navigation. */
  markVisit(userId: string, path: string): void {
    const p = path.slice(0, 500);
    prisma.acpVisit
      .upsert({
        where:  { userId_path: { userId, path: p } },
        update: { lastVisitAt: new Date() },
        create: { userId, path: p, lastVisitAt: new Date() },
      })
      .catch(() => { /* best-effort */ });
  },

  /** True if this user has visited `path` at or after `since`. Backs the ACP
   *  dialogs' "has the admin actually been to the page?" check — a visit is a
   *  real, per-user, device-independent acknowledgement (unlike a dismissed
   *  dialog). Reads xcf_acp_visits (durable, bounded), NOT the prunable
   *  activity log — log retention must never un-acknowledge a dialog. */
  async hasVisitedSince(userId: string, path: string, since: Date): Promise<boolean> {
    const row = await prisma.acpVisit.findUnique({
      where:  { userId_path: { userId, path } },
      select: { lastVisitAt: true },
    });
    return !!row && row.lastVisitAt >= since;
  },

  /**
   * One page of the log under the given filters, newest first — with the tab counts
   * (every category, same filters) and who each actor on the page is.
   */
  async list(opts: { page: number; limit: number } & ActivityFilters) {
    const where = whereOf(opts, true);
    const across = whereOf(opts, false);
    const [rows, total, byCategory] = await Promise.all([
      prisma.activityLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (opts.page - 1) * opts.limit,
        take: opts.limit,
        select: {
          id: true, category: true, userId: true, username: true, method: true, path: true,
          status: true, ip: true, userAgent: true, meta: true, createdAt: true,
        },
      }),
      prisma.activityLog.count({ where }),
      prisma.activityLog.groupBy({ by: ["category"], where: across, _count: { _all: true } }),
    ]);
    const data: ActivityRow[] = rows.map(({ meta, ...r }) => {
      const e = (meta as { error?: { code?: string; message?: string } } | null)?.error;
      return { ...r, error: e ? { code: e.code, message: e.message } : null };
    });
    const counts = { page_visit: 0, acp_action: 0 };
    for (const c of byCategory) if (c.category in counts) counts[c.category as keyof typeof counts] = c._count._all;
    return {
      data,
      meta: buildPaginationMeta({ page: opts.page, limit: opts.limit, total }),
      counts: { all: counts.page_visit + counts.acp_action, ...counts },
      actors: await actorsOf([...new Set(data.map((r) => r.userId).filter((id): id is string => !!id))]),
      // Actions ON a user or group name them: "Banned @spamlord", not "Banned c81d2e07".
      targets: await targetsOf(data),
    };
  },

  /** What the filter menus offer: who and which IPs appear in the log, and how often. */
  async facets() {
    const [users, ips, methods] = await Promise.all([
      prisma.activityLog.groupBy({ by: ["userId"], where: { userId: { not: null } }, _count: { _all: true }, orderBy: { _count: { userId: "desc" } }, take: 50 }),
      prisma.activityLog.groupBy({ by: ["ip"], where: { ip: { not: null } }, _count: { _all: true }, orderBy: { _count: { ip: "desc" } }, take: 50 }),
      prisma.activityLog.groupBy({ by: ["method"], where: { method: { not: null } }, _count: { _all: true } }),
    ]);
    const actors = await actorsOf(users.map((u) => u.userId!).filter(Boolean));
    // Who used each IP — "127.0.0.1 · @qabot" says more than the address alone.
    const ipUsers = await prisma.activityLog.findMany({
      where: { ip: { in: ips.map((i) => i.ip!) } }, distinct: ["ip", "username"], select: { ip: true, username: true }, take: 500,
    });
    return {
      users: users.map((u) => ({ userId: u.userId!, count: u._count._all, ...actors[u.userId!]! })).filter((u) => u.username),
      ips: ips.map((i) => ({
        ip: i.ip!, count: i._count._all,
        usernames: [...new Set(ipUsers.filter((x) => x.ip === i.ip && x.username).map((x) => x.username!))].slice(0, 3),
      })),
      methods: Object.fromEntries(methods.map((m) => [m.method!, m._count._all])),
    };
  },
};
