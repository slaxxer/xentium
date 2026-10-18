/**
 * ACP → Users: the list, one member's page, and group membership as a delta.
 *
 * ⚠ Two facts the user row does not hold are derived here, and both must be read the
 * same way everywhere:
 *
 * - LAST SEEN is the newest `lastUsedAt` over the member's sessions. A session is
 *   touched on every token refresh (~15 min), which is as fresh as anything on the
 *   server knows without a write per request. "Online" is the presence set in Redis
 *   (`online:users`), which IS per request — so a member can be online with a last
 *   seen of twelve minutes ago, and the page shows the dot, not the time, then.
 *
 * - FLAGS are signals core can actually measure, nothing inferred: repeated failed
 *   sign-ins in the last 24 hours, and an unverified address on an account that
 *   signed up through the form. ⚠ Not "no emailVerifiedAt" alone — the installer's
 *   own admin and imported accounts never verified by design, and flagging the site
 *   owner is noise. Only a `register` login event says verification was expected.
 *   Multi-account / ban-evasion detection is left to plugins, which add it to the page
 *   through the user-detail panel slot, not through here.
 */
import { prisma } from "../../infrastructure/db.js";
import { Prisma } from "../../generated/prisma/client.js";
import { redis, rkey } from "../../infrastructure/redis.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { resolveAvatar } from "../../shared/utils/resolveAvatar.js";
import { primaryGroupOrder } from "../../shared/utils/userRef.js";
import { permissionCache } from "../permissions/permission.cache.js";
import { ONLINE_TTL_MS } from "../../shared/middleware/requireAuth.js";
import { buildPaginationMeta } from "@xentium/contracts";

/** Failed sign-ins in 24 hours that make an account worth a look. */
export const FAILED_SIGNIN_FLAG = 5;

export type UserStatus = "active" | "banned" | "inactive";
export type UserFlag = "failed_signins" | "unverified_email";
export type UserListStatusFilter = "all" | "active" | "banned" | "inactive" | "flagged";
export type UserListSort = "recent" | "joined" | "posts" | "name";

/** Security-meaningful events only — see listUserLoginEvents for why these two are left out. */
const TELEMETRY_EVENTS = ["refresh", "page_visit"];

const groupInclude = {
  group: { include: { progression: { select: { badgeColor: true, badgeLabel: true } } } },
} as const;

type GroupRow = {
  group: {
    id: string; name: string; key: string; icon: string | null; isSystem: boolean;
    progression: { badgeColor: string | null; badgeLabel: string | null } | null;
  };
};

function toGroup(ug: GroupRow) {
  return {
    id:       ug.group.id,
    name:     ug.group.name,
    key:      ug.group.key,
    icon:     ug.group.icon ?? null,
    isSystem: ug.group.isSystem,
    progression: ug.group.progression
      ? { badgeColor: ug.group.progression.badgeColor, badgeLabel: ug.group.progression.badgeLabel }
      : null,
  };
}

function statusOf(u: { isActive: boolean; bannedUntil: Date | null }): UserStatus {
  if (u.bannedUntil && u.bannedUntil.getTime() > Date.now()) return "banned";
  return u.isActive ? "active" : "inactive";
}

function flagsOf(failed24: number, unverified: boolean): UserFlag[] {
  const out: UserFlag[] = [];
  if (failed24 >= FAILED_SIGNIN_FLAG) out.push("failed_signins");
  if (unverified) out.push("unverified_email");
  return out;
}

/** Who has been active within the presence window, from the set requireAuth writes. */
async function onlineIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const since = Date.now() - ONLINE_TTL_MS;
  const scores = await redis.zmscore(rkey("online:users"), ...ids).catch(() => ids.map(() => null));
  return new Set(ids.filter((_, i) => {
    const s = scores[i];
    return s != null && Number(s) >= since;
  }));
}

/**
 * The derived columns, per user, as one SQL fragment so the list and its counts
 * cannot disagree about what "flagged" means.
 */
const DERIVED = Prisma.sql`
  GREATEST(u.last_seen_at, (SELECT max(s."lastUsedAt") FROM xcf_sessions s WHERE s."userId" = u.id)) AS last_seen,
  (SELECT count(*)::int FROM xcf_login_events e
     WHERE e."userId" = u.id AND e.success = false
       AND e."createdAt" > now() - interval '24 hours') AS failed24,
  (u.email_verified_at IS NULL AND EXISTS (
     SELECT 1 FROM xcf_login_events r WHERE r."userId" = u.id AND r.event_type = 'register'
  )) AS unverified`;

const FLAGGED = Prisma.sql`(d.failed24 >= ${FAILED_SIGNIN_FLAG} OR d.unverified)`;

function statusWhere(status: UserListStatusFilter) {
  switch (status) {
    case "active":   return Prisma.sql`d."isActive" AND (d.banned_until IS NULL OR d.banned_until <= now())`;
    case "banned":   return Prisma.sql`d.banned_until > now()`;
    case "inactive": return Prisma.sql`NOT d."isActive" AND (d.banned_until IS NULL OR d.banned_until <= now())`;
    case "flagged":  return FLAGGED;
    default:         return Prisma.sql`TRUE`;
  }
}

function orderBy(sort: UserListSort) {
  switch (sort) {
    case "joined": return Prisma.sql`d."createdAt" DESC, d.id`;
    case "posts":  return Prisma.sql`d.post_count DESC, d."createdAt" DESC, d.id`;
    case "name":   return Prisma.sql`lower(d.username) ASC, d.id`;
    default:       return Prisma.sql`d.last_seen DESC NULLS LAST, d."createdAt" DESC, d.id`;
  }
}

export const adminUsersService = {
  async listUsers(opts: {
    page: number; limit: number; search?: string; groupId?: string;
    status?: UserListStatusFilter; sort?: UserListSort;
  }) {
    const { page, limit } = opts;
    const status = opts.status ?? "all";
    const sort = opts.sort ?? "recent";

    // Search covers what an admin actually pastes in: a name, an address, an id,
    // or an IP out of a log. IPs are matched against sign-in history and sessions.
    const q = opts.search?.trim();
    const like = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const searchWhere = like
      ? Prisma.sql`AND (u.username ILIKE ${like} OR u.email ILIKE ${like} OR u.id = ${q}
          OR EXISTS (SELECT 1 FROM xcf_login_events le WHERE le."userId" = u.id AND le.ip ILIKE ${like})
          OR EXISTS (SELECT 1 FROM xcf_sessions ss WHERE ss."userId" = u.id AND ss.ip ILIKE ${like}))`
      : Prisma.empty;
    const groupWhere = opts.groupId
      ? Prisma.sql`AND EXISTS (SELECT 1 FROM xcf_user_groups ug WHERE ug."userId" = u.id AND ug."groupId" = ${opts.groupId})`
      : Prisma.empty;

    const rows = await prisma.$queryRaw<{ id: string; last_seen: Date | null; failed24: number; unverified: boolean; total: number }[]>`
      WITH d AS (
        SELECT u.id, u.username, u."createdAt", u.post_count, u."isActive", u.banned_until, ${DERIVED}
        FROM xcf_users u
        WHERE TRUE ${searchWhere} ${groupWhere}
      )
      SELECT d.id, d.last_seen, d.failed24, d.unverified, count(*) OVER ()::int AS total
      FROM d
      WHERE ${statusWhere(status)}
      ORDER BY ${orderBy(sort)}
      LIMIT ${limit} OFFSET ${(page - 1) * limit}`;

    const ids = rows.map((r) => r.id);
    const [users, online, counts] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: ids } },
        select: {
          id: true, username: true, email: true, avatar: true, isActive: true, bannedUntil: true,
          createdAt: true, postCount: true, articleCount: true, commentCount: true,
          groups: { include: groupInclude, orderBy: primaryGroupOrder },
        },
      }),
      onlineIds(ids),
      this.counts(),
    ]);
    const byId = new Map(users.map((u) => [u.id, u]));
    // A page past the end has no row to carry the window count; ask separately then.
    const total = rows[0]?.total ?? (page > 1 ? await this.countFiltered(searchWhere, groupWhere, status) : 0);

    return {
      data: rows.flatMap((r) => {
        const u = byId.get(r.id);
        if (!u) return [];
        return [{
          id:           u.id,
          username:     u.username,
          email:        u.email,
          avatar:       resolveAvatar(u.avatar),
          createdAt:    u.createdAt,
          postCount:    u.postCount,
          articleCount: u.articleCount,
          commentCount: u.commentCount,
          status:       statusOf(u),
          bannedUntil:  u.bannedUntil,
          lastSeenAt:   r.last_seen,
          online:       online.has(u.id),
          flags:        flagsOf(r.failed24, r.unverified),
          failedSignins24h: r.failed24,
          groups:       u.groups.map(toGroup),
        }];
      }),
      meta:   buildPaginationMeta({ page, limit, total }),
      counts,
    };
  },

  async countFiltered(searchWhere: Prisma.Sql, groupWhere: Prisma.Sql, status: UserListStatusFilter) {
    const [r] = await prisma.$queryRaw<{ n: number }[]>`
      WITH d AS (
        SELECT u.id, u."isActive", u.banned_until, ${DERIVED}
        FROM xcf_users u WHERE TRUE ${searchWhere} ${groupWhere}
      )
      SELECT count(*)::int AS n FROM d WHERE ${statusWhere(status)}`;
    return r?.n ?? 0;
  },

  /** The whole membership at a glance, independent of the current filter. */
  async counts() {
    const [r] = await prisma.$queryRaw<{ total: number; active: number; banned: number; inactive: number; flagged: number }[]>`
      WITH d AS (
        SELECT u.id, u."isActive", u.banned_until, ${DERIVED} FROM xcf_users u
      )
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE ${statusWhere("active")})::int   AS active,
        count(*) FILTER (WHERE ${statusWhere("banned")})::int   AS banned,
        count(*) FILTER (WHERE ${statusWhere("inactive")})::int AS inactive,
        count(*) FILTER (WHERE ${FLAGGED})::int                 AS flagged
      FROM d`;
    return r ?? { total: 0, active: 0, banned: 0, inactive: 0, flagged: 0 };
  },

  /**
   * One member's page.
   *
   * ⚠ An explicit select. This used to spread the whole Prisma row, which sent
   * `passwordHash` and `loginPinHash` to the admin's browser on every open. Admin-only
   * is not a reason for a hash to leave the server.
   */
  async getUserDetail(id: string) {
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true, username: true, displayName: true, email: true, avatar: true,
        isActive: true, bannedUntil: true, createdAt: true, emailVerifiedAt: true,
        postCount: true, articleCount: true, commentCount: true,
        groups: { include: groupInclude, orderBy: primaryGroupOrder },
        _count: { select: { articles: true, articleComments: true } },
      },
    });
    if (!user) throw XentiumError.notFound("User not found");

    const securityWhere = { userId: id, eventType: { notIn: TELEMETRY_EVENTS } };
    const [fields, values, derived, ipRows, cookieRows, eventTotal, activeSessions, activeBan, online] = await Promise.all([
      prisma.userProfileField.findMany({ orderBy: { position: "asc" } }),
      prisma.userProfileFieldValue.findMany({ where: { userId: id } }),
      prisma.$queryRaw<{ last_seen: Date | null; failed24: number; unverified: boolean }[]>`
        SELECT ${DERIVED} FROM xcf_users u WHERE u.id = ${id}`,
      // Every address and device ever seen, not only the last page of events: this is
      // what a reviewer compares against another account.
      // With when each was last seen, and a device's latest user agent, so the page can
      // say "1d ago" and "Windows · Chrome" rather than a bare address or UUID.
      prisma.$queryRaw<{ ip: string; last_seen: Date }[]>`
        SELECT ip, max(at) AS last_seen FROM (
          SELECT ip, "createdAt" AS at FROM xcf_login_events WHERE "userId" = ${id} AND ip IS NOT NULL
          UNION ALL
          SELECT ip, "lastUsedAt" AS at FROM xcf_sessions WHERE "userId" = ${id} AND ip IS NOT NULL
        ) x GROUP BY ip ORDER BY max(at) DESC LIMIT 20`,
      prisma.$queryRaw<{ cookie: string; last_seen: Date; ua: string | null }[]>`
        SELECT "deviceCookieId" AS cookie, max(at) AS last_seen,
               (array_agg(ua ORDER BY at DESC) FILTER (WHERE ua IS NOT NULL))[1] AS ua
        FROM (
          SELECT "deviceCookieId", "createdAt" AS at, "userAgent" AS ua FROM xcf_login_events WHERE "userId" = ${id} AND "deviceCookieId" IS NOT NULL
          UNION ALL
          SELECT "deviceCookieId", "lastUsedAt" AS at, "userAgent" AS ua FROM xcf_sessions WHERE "userId" = ${id} AND "deviceCookieId" IS NOT NULL
        ) x GROUP BY "deviceCookieId" ORDER BY max(at) DESC LIMIT 20`,
      prisma.loginEvent.count({ where: securityWhere }),
      prisma.session.count({ where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } } }),
      prisma.moderationBan.findFirst({
        where:   { userId: id, status: "active" },
        orderBy: { createdAt: "desc" },
        select:  { type: true, reason: true, expiresAt: true, createdAt: true },
      }),
      onlineIds([id]),
    ]);
    const d = derived[0] ?? { last_seen: null, failed24: 0, unverified: false };
    const valueMap = Object.fromEntries(values.map((v) => [v.fieldId, v.value]));

    return {
      id:              user.id,
      username:        user.username,
      displayName:     user.displayName,
      email:           user.email,
      avatar:          resolveAvatar(user.avatar),
      isActive:        user.isActive,
      bannedUntil:     user.bannedUntil,
      createdAt:       user.createdAt,
      emailVerifiedAt: user.emailVerifiedAt,
      postCount:       user.postCount,
      articleCount:    user.articleCount,
      commentCount:    user.commentCount,
      _count:          { articles: user._count.articles, articleComments: user._count.articleComments },
      status:          statusOf(user),
      activeBan,
      lastSeenAt:      d.last_seen,
      online:          online.has(user.id),
      flags:           flagsOf(d.failed24, d.unverified),
      failedSignins24h: d.failed24,
      activeSessions,
      knownIps:        ipRows.map((r) => r.ip),
      deviceCookies:   cookieRows.map((r) => r.cookie),
      ipSeen:          ipRows.map((r) => ({ ip: r.ip, lastSeenAt: r.last_seen })),
      devices:         cookieRows.map((r) => ({ id: r.cookie, lastSeenAt: r.last_seen, userAgent: r.ua })),
      securityEventTotal: eventTotal,
      groups:          user.groups.map(toGroup),
      profileFields:   fields.map((f) => ({ field: f, value: valueMap[f.id] ?? "" })),
    };
  },

  /**
   * Add and remove groups — never replace the set.
   *
   * ⚠ The page edits a draft taken when it opened. Saving that draft as a
   * REPLACEMENT would revert anything changed meanwhile: a progression promotion,
   * another admin, a plugin. The groups page lost a real permission grant exactly
   * that way. Only what the admin toggled is sent, so only that changes.
   */
  async patchUserGroups(userId: string, add: string[], remove: string[], actorId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, groups: { select: { group: { select: { id: true, key: true } } } } },
    });
    if (!user) throw XentiumError.notFound("User not found");

    const removeSet = new Set(remove);
    const addIds = [...new Set(add)].filter((g) => !removeSet.has(g));
    // Taking your own administrator group away locks you out of this very page.
    if (userId === actorId && user.groups.some((ug) => ug.group.key === "admin" && removeSet.has(ug.group.id))) {
      throw XentiumError.forbidden("You cannot remove yourself from the Administrator group");
    }
    if (addIds.length) {
      const known = await prisma.group.count({ where: { id: { in: addIds } } });
      if (known !== addIds.length) throw XentiumError.notFound("Group not found");
    }

    await prisma.$transaction(async (tx) => {
      if (removeSet.size) await tx.userGroup.deleteMany({ where: { userId, groupId: { in: [...removeSet] } } });
      if (addIds.length) {
        await tx.userGroup.createMany({ data: addIds.map((groupId) => ({ userId, groupId })), skipDuplicates: true });
      }
    });
    await permissionCache.invalidate(userId);

    const after = await prisma.userGroup.findMany({ where: { userId }, include: groupInclude, orderBy: primaryGroupOrder });
    return { groups: after.map(toGroup) };
  },
};
