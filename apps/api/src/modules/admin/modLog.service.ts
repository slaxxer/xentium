/**
 * ACP → Moderation → Moderation Log: reading the log.
 *
 * The log is append-only and written from many places (moderation, ModCanvas, the
 * ACP, cases, plugins), each with its own action key. The page groups them into
 * five KINDS by the key's prefix, filters by kind, period, who did it and a search,
 * and names every target the way a moderator knows it: a member by name, an article
 * by its title, a comment by its author, a case by its type.
 */
import { prisma } from "../../infrastructure/db.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { badgeColorSelect, extractBadgeColor } from "../../shared/utils/userRef.js";
import { buildPaginationMeta } from "@xentium/contracts";

export const MOD_LOG_KINDS = ["account", "ban", "warning", "content", "case"] as const;
export type ModLogKind = (typeof MOD_LOG_KINDS)[number] | "other";

/** Action-key prefixes per kind. `case.ban_all` is a ban, not case housekeeping. */
const KIND_PREFIXES: Record<(typeof MOD_LOG_KINDS)[number], string[]> = {
  account: ["user.", "session."],
  ban:     ["ban.", "case.ban_all"],
  warning: ["warning.", "warn."],
  content: ["article.", "comment.", "profile_comment.", "plugin_content.", "thread.", "post.", "shout"],
  case:    ["case.", "report.", "security."],
};

export function kindOf(action: string): ModLogKind {
  if (action === "case.ban_all") return "ban";
  for (const k of MOD_LOG_KINDS) {
    if (KIND_PREFIXES[k].some((p) => action.startsWith(p))) return k;
  }
  return "other";
}

function kindWhere(kind: (typeof MOD_LOG_KINDS)[number]): Prisma.ModerationLogWhereInput {
  const or: Prisma.ModerationLogWhereInput[] = KIND_PREFIXES[kind].map((p) =>
    p.endsWith(".") || p === "shout" ? { action: { startsWith: p } } : { action: p });
  // case.* minus the ban that lives under Bans.
  return kind === "case" ? { AND: [{ OR: or }, { NOT: { action: "case.ban_all" } }] } : { OR: or };
}

export interface ModLogFilter {
  kind?: (typeof MOD_LOG_KINDS)[number];
  /** "staff", "system", or a member's id. */
  actor?: string;
  since?: Date;
  q?: string;
}

/** The where-clause for every filter except, optionally, the kind (for the chip counts). */
async function whereFor(f: ModLogFilter, withKind = true): Promise<Prisma.ModerationLogWhereInput> {
  const and: Prisma.ModerationLogWhereInput[] = [];
  if (withKind && f.kind) and.push(kindWhere(f.kind));
  if (f.actor === "system") and.push({ actorType: "system" });
  else if (f.actor === "staff") and.push({ actorType: { not: "system" } });
  else if (f.actor) and.push({ actorId: f.actor });
  if (f.since) and.push({ createdAt: { gte: f.since } });
  const q = f.q?.trim();
  if (q) {
    // A member, an article or the reason: names resolve to ids first, because the
    // log stores ids.
    const [users, articles] = await Promise.all([
      prisma.user.findMany({ where: { username: { contains: q, mode: "insensitive" } }, select: { id: true }, take: 50 }),
      prisma.article.findMany({ where: { title: { contains: q, mode: "insensitive" } }, select: { id: true }, take: 50 }),
    ]);
    const ids = [...users.map((u) => u.id), ...articles.map((a) => a.id)];
    and.push({
      OR: [
        { reason: { contains: q, mode: "insensitive" } },
        { action: { contains: q.toLowerCase().replace(/\s+/g, "_") } },
        ...(ids.length ? [{ actorId: { in: ids } }, { targetId: { in: ids } }] : []),
      ],
    });
  }
  return and.length ? { AND: and } : {};
}

type Row = Awaited<ReturnType<typeof prisma.moderationLog.findMany>>[number];

/** Every row's actor and target, named. */
async function describe(rows: Row[]) {
  const userIds = new Set<string>();
  const ids = (type: string) => rows.filter((r) => r.targetType === type && r.targetId).map((r) => r.targetId!);
  for (const r of rows) {
    if (r.actorId) userIds.add(r.actorId);
    if (r.targetId && r.targetType === "user") userIds.add(r.targetId);
  }
  const [cases, articles, articleComments, profileComments] = await Promise.all([
    ids("moderation_case").length
      ? prisma.moderationCase.findMany({ where: { id: { in: ids("moderation_case") } }, select: { id: true, type: true, linkedUserIds: true } })
      : [],
    ids("article").length
      ? prisma.article.findMany({ where: { id: { in: ids("article") } }, select: { id: true, title: true, slug: true } })
      : [],
    ids("article_comment").length
      ? prisma.articleComment.findMany({ where: { id: { in: ids("article_comment") } }, select: { id: true, authorId: true, article: { select: { title: true, slug: true } } } })
      : [],
    ids("profile_comment").length
      ? prisma.profileComment.findMany({ where: { id: { in: ids("profile_comment") } }, select: { id: true, authorId: true, profileUserId: true } })
      : [],
  ]);
  cases.forEach((c) => c.linkedUserIds.forEach((u) => userIds.add(u)));
  articleComments.forEach((c) => userIds.add(c.authorId));
  profileComments.forEach((c) => { userIds.add(c.authorId); userIds.add(c.profileUserId); });

  const users = userIds.size
    ? await prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, username: true, ...badgeColorSelect } })
    : [];
  const name = new Map(users.map((u) => [u.id, u.username]));
  const color = new Map(users.map((u) => [u.id, extractBadgeColor(u.groups)]));
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const articleById = new Map(articles.map((a) => [a.id, a]));
  const acById = new Map(articleComments.map((c) => [c.id, c]));
  const pcById = new Map(profileComments.map((c) => [c.id, c]));

  return rows.map((r) => {
    let target: { kind: string; label: string | null; userId?: string; badgeColor?: string | null; href?: string | null; detail?: string | null } =
      { kind: r.targetType ?? "none", label: null };
    const id = r.targetId;
    if (id && r.targetType === "user") {
      const n = name.get(id);
      target = { kind: "user", label: n ?? null, userId: id, badgeColor: color.get(id) ?? null, href: n ? `/admin/users/${id}` : null };
    } else if (id && r.targetType === "moderation_case") {
      const c = caseById.get(id);
      const linked = (c?.linkedUserIds ?? []).map((u) => name.get(u)).filter((n): n is string => !!n);
      target = { kind: "case", label: c?.type ?? null, detail: linked.join(", ") || null, href: `/admin/cases?case=${id}` };
    } else if (id && r.targetType === "article") {
      const a = articleById.get(id);
      target = { kind: "article", label: a?.title ?? null, href: a ? `/articles/${a.slug}` : null };
    } else if (id && r.targetType === "article_comment") {
      const c = acById.get(id);
      target = { kind: "article_comment", label: c ? name.get(c.authorId) ?? null : null, detail: c?.article.title ?? null, href: c ? `/articles/${c.article.slug}` : null };
    } else if (id && r.targetType === "profile_comment") {
      const c = pcById.get(id);
      target = { kind: "profile_comment", label: c ? name.get(c.authorId) ?? null : null, detail: c ? name.get(c.profileUserId) ?? null : null };
    } else if (id && r.targetType === "ip") {
      target = { kind: "ip", label: id };
    } else if (id) {
      target = { kind: r.targetType ?? "other", label: null };
    }
    return {
      id: r.id,
      action: r.action,
      kind: kindOf(r.action),
      createdAt: r.createdAt,
      reason: r.reason,
      meta: r.meta,
      actor: r.actorId
        ? { type: "user" as const, id: r.actorId, username: name.get(r.actorId) ?? null, badgeColor: color.get(r.actorId) ?? null }
        : { type: "system" as const, id: null, username: null, badgeColor: null },
      target: { ...target, id: id ?? null },
    };
  });
}

/** One CSV cell: always quoted, and a leading = + - @ (a spreadsheet formula) defused. */
export function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export const modLogService = {
  async list(f: ModLogFilter & { page: number; limit: number }) {
    const where = await whereFor(f);
    const [rows, total] = await Promise.all([
      prisma.moderationLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (f.page - 1) * f.limit, take: f.limit }),
      prisma.moderationLog.count({ where }),
    ]);
    return { data: await describe(rows), meta: buildPaginationMeta({ page: f.page, limit: f.limit, total }) };
  },

  /** Counts per kind under every other filter, for the chips. */
  async kindCounts(f: ModLogFilter) {
    const base = await whereFor(f, false);
    const entries = await Promise.all(MOD_LOG_KINDS.map(async (k) =>
      [k, await prisma.moderationLog.count({ where: { AND: [base, kindWhere(k)] } })] as const));
    const all = await prisma.moderationLog.count({ where: base });
    return { all, ...Object.fromEntries(entries) } as Record<"all" | (typeof MOD_LOG_KINDS)[number], number>;
  },

  /** The last seven days at a glance. */
  async summary(now = new Date()) {
    const since = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
    const inWindow = { createdAt: { gte: since } };
    const count = (where: Prisma.ModerationLogWhereInput) => prisma.moderationLog.count({ where: { AND: [inWindow, where] } });
    const [total, bans, lifted, warnings, pardoned, automatic] = await Promise.all([
      count({}),
      count({ OR: [{ action: { in: ["ban.issued", "ban.auto_issued", "case.ban_all"] } }] }),
      count({ action: "ban.lifted" }),
      count({ action: { in: ["warning.issued", "warn.issued"] } }),
      count({ action: { in: ["warning.pardoned", "warn.pardoned"] } }),
      count({ actorType: "system" }),
    ]);
    return { total, bans, lifted, warnings, pardoned, automatic };
  },

  /** Everyone who appears as an actor, for "Done by". */
  async actors() {
    const rows = await prisma.moderationLog.groupBy({ by: ["actorId"], where: { actorId: { not: null } }, _count: { _all: true } });
    const users = await prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.actorId!).filter(Boolean) } },
      select: { id: true, username: true },
      orderBy: { username: "asc" },
    });
    return users;
  },

  /** The filtered log as CSV, newest first, at most 10,000 rows. */
  async csv(f: ModLogFilter): Promise<string> {
    const where = await whereFor(f);
    const rows = await describe(await prisma.moderationLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 10_000 }));
    const cell = csvCell;
    const head = ["time", "kind", "action", "actor", "target", "target detail", "reason"];
    const lines = rows.map((r) => [
      r.createdAt.toISOString(), r.kind, r.action,
      r.actor.type === "system" ? "system" : r.actor.username ?? r.actor.id,
      r.target.label ?? r.target.id ?? "", r.target.detail ?? "", r.reason ?? "",
    ].map(cell).join(","));
    return [head.map(cell).join(","), ...lines].join("\r\n") + "\r\n";
  },
};
