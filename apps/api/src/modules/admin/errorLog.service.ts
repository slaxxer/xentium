/**
 * ACP → System → Error log, grouped. A group is every row with the same
 * `group_key` (code + normalized message, see errorGroupKey); nothing about a
 * group is stored except an admin's "resolved" decision, which a newer
 * occurrence overrides on its own.
 */
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../infrastructure/db.js";
import { errorGroupKey } from "../../shared/errors/errorGroupKey.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { getSetting } from "../../shared/utils/settings.js";

export const ERROR_SEVERITIES = ["critical", "error", "warn", "info"] as const;
export type ErrorSeverity = (typeof ERROR_SEVERITIES)[number];
export type GroupStatus = "open" | "resolved" | "all";

export interface GroupFilter {
  severity?: ErrorSeverity;
  domain?: string;
  q?: string;
  /** One group — the drawer's own summary, wherever the list is paged. */
  key?: string;
  /** Only groups this member (a user id) ran into. */
  userId?: string;
}

interface GroupRow {
  key: string;
  count: number;
  userCount: number;
  routeCount: number;
  firstSeen: Date;
  lastSeen: Date;
  code: string;
  message: string;
  severity: string;
  resolvedAt: Date | null;
}

// ── Rows written before group keys existed ─────────────────────────────────

/**
 * Give every row a group key, and lift method/url out of `context` for rows
 * written before they were columns. The work happens on the first read after
 * a deploy; afterwards it is one indexed probe per read. Core writers set both
 * themselves, but a row from anywhere else still gets grouped.
 */
async function ensureGroupKeys(): Promise<void> {
  for (;;) {
    const rows = await prisma.errorLog.findMany({
      where: { groupKey: null },
      select: { id: true, code: true, message: true, context: true, method: true, url: true },
      take: 500,
    });
    if (rows.length === 0) break;
    await prisma.$transaction(rows.map((r) => {
      const ctx = (r.context && typeof r.context === "object" && !Array.isArray(r.context) ? r.context : {}) as Record<string, unknown>;
      const job = typeof ctx.queue === "string";
      const method = r.method ?? (job ? "JOB" : typeof ctx.method === "string" ? ctx.method.slice(0, 16) : null);
      const url = r.url ?? (job
        ? (typeof ctx.jobName === "string" && ctx.jobName !== ctx.queue ? `${ctx.queue} · ${ctx.jobName}` : String(ctx.queue))
        : typeof ctx.url === "string" ? ctx.url : null);
      return prisma.errorLog.update({
        where: { id: r.id },
        data: { groupKey: errorGroupKey(r.code, r.message), method, url },
      });
    }));
  }
}

// ── Queries ─────────────────────────────────────────────────────────────────

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function whereOf(f: GroupFilter): Prisma.Sql {
  const conds: Prisma.Sql[] = [Prisma.sql`e.group_key IS NOT NULL`];
  if (f.key) conds.push(Prisma.sql`e.group_key = ${f.key}`);
  if (f.severity) conds.push(Prisma.sql`e.severity = ${f.severity}`);
  if (f.domain) conds.push(Prisma.sql`e.code LIKE ${`XEC-${escapeLike(f.domain.toUpperCase())}-%`}`);
  if (f.userId) {
    conds.push(Prisma.sql`e.group_key IN (SELECT x.group_key FROM xcf_error_log x WHERE x.user_id = ${f.userId})`);
  }
  if (f.q?.trim()) {
    // Matched against every occurrence, but the group keeps all its rows: a
    // request id finds the group, it does not shrink it to one occurrence.
    const like = `%${escapeLike(f.q.trim())}%`;
    conds.push(Prisma.sql`e.group_key IN (
      SELECT x.group_key FROM xcf_error_log x
      WHERE x.code ILIKE ${like} OR x.message ILIKE ${like} OR x.url ILIKE ${like} OR x.request_id ILIKE ${like})`);
  }
  return Prisma.join(conds, " AND ");
}

async function allGroups(f: GroupFilter): Promise<GroupRow[]> {
  await ensureGroupKeys();
  return prisma.$queryRaw<GroupRow[]>`
    SELECT g.group_key AS "key", g.count, g.user_count AS "userCount", g.route_count AS "routeCount",
           g.first_seen AS "firstSeen", g.last_seen AS "lastSeen",
           l.code, l.message, l.severity, r.resolved_at AS "resolvedAt"
    FROM (
      SELECT e.group_key,
             count(*)::int AS count,
             count(DISTINCT e.user_id)::int AS user_count,
             count(DISTINCT CASE WHEN e.url IS NOT NULL THEN coalesce(e.method, '') || ' ' || e.url END)::int AS route_count,
             min(e.created_at) AS first_seen,
             max(e.created_at) AS last_seen
      FROM xcf_error_log e
      WHERE ${whereOf(f)}
      GROUP BY e.group_key
    ) g
    JOIN LATERAL (
      SELECT x.code, x.message, x.severity FROM xcf_error_log x
      WHERE x.group_key = g.group_key ORDER BY x.created_at DESC LIMIT 1
    ) l ON TRUE
    LEFT JOIN xcf_error_log_groups r ON r.key = g.group_key
    ORDER BY g.last_seen DESC`;
}

const isResolved = (g: Pick<GroupRow, "resolvedAt" | "lastSeen">) => !!g.resolvedAt && g.lastSeen <= g.resolvedAt;
const domainOf = (code: string) => code.split("-")[1] ?? "";

/** Now, as the UTC wall-clock `created_at` is stored in (timestamp without zone). */
const NOW_UTC = Prisma.sql`(now() AT TIME ZONE 'UTC')`;

/** A member as the error-reference page names them: by username, any case. */
async function findMember(username: string) {
  return prisma.user.findFirst({
    where: { username: { equals: username.trim(), mode: "insensitive" } },
    select: { id: true, username: true },
  });
}

export const errorLogService = {
  findMember,

  /**
   * ACP → System → Error reference: what the server logged for one code in the last
   * `days` — every occurrence, or one member's. Counts come back for both scopes so
   * the page can offer the switch; `items` are the chosen scope's, newest first.
   * A member who does not exist is reported as such (`member: null`), not as an error.
   */
  async codeOccurrences(opts: { code: string; member?: string; days: number; scope: "member" | "all"; limit: number }) {
    const since = new Date(Date.now() - opts.days * 86400e3);
    const member = opts.member?.trim() ? await findMember(opts.member) : null;
    const base: Prisma.ErrorLogWhereInput = { code: opts.code, createdAt: { gte: since } };
    const mineWhere: Prisma.ErrorLogWhereInput = { ...base, userId: member?.id ?? "-" };
    const showMine = !!opts.member?.trim() && opts.scope === "member";
    const [all, mine, people, rows] = await Promise.all([
      prisma.errorLog.count({ where: base }),
      member ? prisma.errorLog.count({ where: mineWhere }) : Promise.resolve(0),
      // Guests count as one "person": the page says "at 4 members", not "at 3 + guests".
      prisma.errorLog.groupBy({ by: ["userId"], where: base }),
      prisma.errorLog.findMany({
        where: showMine ? mineWhere : base,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: opts.limit,
        select: { id: true, method: true, url: true, requestId: true, userId: true, context: true, createdAt: true },
      }),
    ]);
    const ids = [...new Set(rows.map((r) => r.userId).filter((id): id is string => !!id))];
    const users = ids.length
      ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, username: true, avatar: true } })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    return {
      member,
      counts: { all, mine, people: people.length },
      items: rows.map((r) => {
        const u = r.userId ? byId.get(r.userId) : undefined;
        return { ...r, user: u ? { username: u.username, avatar: u.avatar } : null };
      }),
    };
  },

  /** The last few DISTINCT codes the server logged — what a member most likely just sent you. */
  async recentCodes(limit: number) {
    const rows = await prisma.$queryRaw<Array<{ code: string; lastAt: Date; userId: string | null; day: number }>>`
      SELECT DISTINCT ON (e.code) e.code, e.created_at AS "lastAt", e.user_id AS "userId",
             (SELECT count(*)::int FROM xcf_error_log d
               WHERE d.code = e.code AND d.created_at >= ${NOW_UTC} - interval '24 hours') AS "day"
      FROM xcf_error_log e
      ORDER BY e.code, e.created_at DESC`;
    const top = rows.sort((a, b) => +b.lastAt - +a.lastAt).slice(0, limit);
    const ids = [...new Set(top.map((r) => r.userId).filter((id): id is string => !!id))];
    const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, username: true } }) : [];
    return top.map((r) => ({
      code: r.code, lastAt: r.lastAt, count24h: r.day,
      username: users.find((u) => u.id === r.userId)?.username ?? null,
    }));
  },

  async listGroups(f: GroupFilter & { status: GroupStatus; page: number; pageSize: number }) {
    const groups = await allGroups(f);
    const counts = {
      open: groups.filter((g) => !isResolved(g)).length,
      resolved: groups.filter(isResolved).length,
      all: groups.length,
    };
    const matching = f.status === "all" ? groups : groups.filter((g) => isResolved(g) === (f.status === "resolved"));
    const total = matching.length;
    const pages = Math.max(1, Math.ceil(total / f.pageSize));
    const page = Math.min(Math.max(1, f.page), pages);
    const slice = matching.slice((page - 1) * f.pageSize, page * f.pageSize);
    const keys = slice.map((g) => g.key);

    const [routes, spark] = keys.length === 0 ? [[], []] : await Promise.all([
      // The route a group happens on most, for the Context column.
      prisma.$queryRaw<Array<{ key: string; method: string | null; url: string }>>`
        SELECT DISTINCT ON (group_key) group_key AS "key", method, url
        FROM xcf_error_log
        WHERE group_key IN (${Prisma.join(keys)}) AND url IS NOT NULL
        GROUP BY group_key, method, url
        ORDER BY group_key, count(*) DESC, max(created_at) DESC`,
      // Occurrences per day over the last seven, oldest first.
      prisma.$queryRaw<Array<{ key: string; ago: number; n: number }>>`
        SELECT group_key AS "key",
               floor(extract(epoch FROM (${NOW_UTC} - created_at)) / 86400)::int AS ago,
               count(*)::int AS n
        FROM xcf_error_log
        WHERE group_key IN (${Prisma.join(keys)}) AND created_at > ${NOW_UTC} - interval '7 days'
        GROUP BY 1, 2`,
    ]);

    const items = slice.map((g) => {
      const route = routes.find((r) => r.key === g.key);
      const spark7d = [0, 0, 0, 0, 0, 0, 0];
      for (const s of spark) if (s.key === g.key && s.ago >= 0 && s.ago < 7) spark7d[6 - s.ago]! += s.n;
      return {
        key: g.key,
        code: g.code,
        message: g.message,
        severity: g.severity,
        domain: domainOf(g.code),
        count: g.count,
        userCount: g.userCount,
        routeCount: g.routeCount,
        firstSeen: g.firstSeen,
        lastSeen: g.lastSeen,
        resolved: isResolved(g),
        resolvedAt: g.resolvedAt,
        topRoute: route ? { method: route.method, url: route.url } : null,
        spark7d,
      };
    });
    return { items, counts, meta: { page, limit: f.pageSize, total, totalPages: pages } };
  },

  /**
   * The overview: events per severity per hour (24h) or day (7d), aligned to
   * the admin's clock via `tzOffset` (minutes, as `Date#getTimezoneOffset`),
   * plus open groups per severity and the totals for the header line.
   */
  async stats(range: "24h" | "7d", tzOffset: number) {
    await ensureGroupKeys();
    const unit = range === "7d" ? "day" : "hour";
    const n = range === "7d" ? 7 : 24;
    const shift = Prisma.sql`make_interval(mins => ${-tzOffset}::int)`;
    // Bucket start in the admin's local wall-clock time.
    const bucket = Prisma.sql`date_trunc(${unit}, created_at + ${shift})`;
    const nowLocal = Prisma.sql`date_trunc(${unit}, ${NOW_UTC} + ${shift})`;
    const step = range === "7d" ? Prisma.sql`interval '1 day'` : Prisma.sql`interval '1 hour'`;

    const [rows, totals, domains, open, retentionDays] = await Promise.all([
      prisma.$queryRaw<Array<{ idx: number; severity: string; n: number }>>`
        SELECT (${n - 1}::int - floor(extract(epoch FROM (${nowLocal} - ${bucket})) / extract(epoch FROM ${step})))::int AS idx,
               severity, count(*)::int AS n
        FROM xcf_error_log
        WHERE ${bucket} > ${nowLocal} - ${step} * ${n}::int
        GROUP BY 1, 2`,
      prisma.$queryRaw<Array<{ entries: number; groups: number }>>`
        SELECT count(*)::int AS entries, count(DISTINCT group_key)::int AS groups FROM xcf_error_log`,
      prisma.$queryRaw<Array<{ domain: string }>>`
        SELECT DISTINCT split_part(code, '-', 2) AS domain FROM xcf_error_log WHERE code LIKE 'XEC-%' ORDER BY 1`,
      allGroups({}),
      getSetting<number>("retention.error_log_days", 90),
    ]);

    // Bucket i starts (n-1-i) steps before the current local bucket; the client
    // formats `t` (an ISO instant) in its own zone, which is the same zone.
    const stepMs = (range === "7d" ? 86_400 : 3_600) * 1000;
    const localNow = Date.now() - tzOffset * 60_000;
    const currentStart = Math.floor(localNow / stepMs) * stepMs + tzOffset * 60_000;
    const buckets = Array.from({ length: n }, (_, i) => ({
      t: new Date(currentStart - (n - 1 - i) * stepMs).toISOString(),
      critical: 0, error: 0, warn: 0, info: 0,
    }));
    for (const r of rows) {
      const b = buckets[r.idx];
      if (b && (ERROR_SEVERITIES as readonly string[]).includes(r.severity)) b[r.severity as ErrorSeverity] += r.n;
    }

    const openGroups = { critical: 0, error: 0, warn: 0, info: 0 };
    for (const g of open) if (!isResolved(g) && g.severity in openGroups) openGroups[g.severity as ErrorSeverity]++;

    return {
      range,
      buckets,
      openGroups,
      totalEntries: totals[0]?.entries ?? 0,
      totalGroups: totals[0]?.groups ?? 0,
      domains: domains.map((d) => d.domain).filter(Boolean),
      retentionDays: Number(retentionDays) || 0,
    };
  },

  /** A group's rows, newest first, `limit` at a time. */
  async occurrences(key: string, cursor: string | undefined, limit: number) {
    await ensureGroupKeys();
    const [rows, total] = await Promise.all([
      prisma.errorLog.findMany({
        where: { groupKey: key },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      prisma.errorLog.count({ where: { groupKey: key } }),
    ]);
    const page = rows.slice(0, limit);
    const userIds = [...new Set(page.map((r) => r.userId).filter((id): id is string => !!id))];
    const users = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true } })
      : [];
    return {
      items: page.map((r) => ({
        id: r.id,
        method: r.method,
        url: r.url,
        requestId: r.requestId,
        userId: r.userId,
        username: users.find((u) => u.id === r.userId)?.username ?? null,
        severity: r.severity,
        message: r.message,
        context: r.context,
        createdAt: r.createdAt,
      })),
      nextCursor: rows.length > limit ? page[page.length - 1]!.id : null,
      total,
    };
  },

  async setResolved(key: string, resolved: boolean, userId: string | undefined) {
    const exists = await prisma.errorLog.findFirst({ where: { groupKey: key }, select: { id: true } });
    if (!exists) throw XentiumError.notFound("Error group not found");
    if (resolved) {
      const now = new Date();
      await prisma.errorLogGroup.upsert({
        where: { key },
        update: { resolvedAt: now, resolvedById: userId ?? null },
        create: { key, resolvedAt: now, resolvedById: userId ?? null },
      });
    } else {
      await prisma.errorLogGroup.deleteMany({ where: { key } });
    }
  },

  async deleteGroup(key: string) {
    const { count } = await prisma.errorLog.deleteMany({ where: { groupKey: key } });
    await prisma.errorLogGroup.deleteMany({ where: { key } });
    return { deleted: count };
  },

  async deleteEntry(id: string) {
    const { count } = await prisma.errorLog.deleteMany({ where: { id } });
    if (!count) throw XentiumError.notFound("Error log entry not found");
  },

  /** Resolve decisions whose group has no rows left (cleared, pruned). */
  async pruneOrphanGroups() {
    return prisma.$executeRaw`
      DELETE FROM xcf_error_log_groups g
      WHERE NOT EXISTS (SELECT 1 FROM xcf_error_log e WHERE e.group_key = g.key)`;
  },
};
