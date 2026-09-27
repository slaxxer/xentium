import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "../../infrastructure/db.js";
import { Prisma } from "../../generated/prisma/client.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { bustSettingsCache } from "../../shared/utils/settings.js";
import { paginate } from "../../shared/utils/paginate.js";
import { badgeColorSelect, extractBadgeColor, toUserRef } from "../../shared/utils/userRef.js";
import { redis, bullConnection } from "../../infrastructure/redis.js";
import { env } from "../../config/env.js";
import { permissionCache } from "../permissions/permission.cache.js";
import { revokeUserAccessTokens } from "../auth/session-revocation.js";
import { moderationService } from "../moderation/moderation.service.js";
import { isEmailConfigured } from "../../infrastructure/email/email.service.js";
import { encryptSecret } from "../../shared/utils/secretBox.js";
import { seedDefaultNavItems } from "../../bootstrap/seedDefaultNavItems.js";
import { humanizeCaseType, describeCaseSignal } from "../moderation/moderation.types.js";
import { appearanceService } from "../appearance/appearance.service.js";
import { buildPaginationMeta } from "@xentium/contracts";
import { adminUsersService } from "./adminUsers.service.js";

/**
 * Settings whose value is write-only: stored encrypted, returned to the client
 * only as SECRET_MASK so an admin can see that one is configured without the
 * plaintext ever reaching a browser. Per the ACP convention these get explicit
 * Set / Remove actions rather than autosave.
 */
const SECRET_SETTING_KEYS = new Set(["smtp.pass"]);
const SECRET_MASK = "••••••••";

/** Guard for sensitive account actions in the ACP. Blocks acting on your own
 *  account, and on any Administrator-group account — admins cannot be touched
 *  via the admin panel (no force-logout, no password reset). Returns the user. */
async function assertActionableUser(userId: string, actorId: string) {
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { id: true, email: true, groups: { select: { group: { select: { key: true } } } } },
  });
  if (!user) throw XentiumError.notFound("User not found");
  if (actorId === userId) {
    throw XentiumError.forbidden("You cannot perform this action on your own account");
  }
  if (user.groups.some((ug) => ug.group.key === "admin")) {
    throw XentiumError.forbidden("Administrator accounts cannot be managed via the admin panel");
  }
  return user;
}

export const adminService = {
  // ── Dashboard ─────────────────────────────────────────────────────────────

  async getDashboardStats() {
    const [userCount, articleCount, commentCount, groupCount, pendingReportCount] = await Promise.all([
      prisma.user.count(),
      prisma.article.count({ where: { deletedAt: null } }),
      prisma.articleComment.count({ where: { deletedAt: null } }),
      prisma.group.count(),
      prisma.moderationReport.count({ where: { status: "pending" } }),
    ]);
    const recentUsers = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, username: true, avatar: true, createdAt: true, ...badgeColorSelect },
    });
    const recentArticles = await prisma.article.findMany({
      where: { deletedAt: null, status: "published" },
      orderBy: { publishedAt: "desc" },
      take: 5,
      select: { id: true, title: true, slug: true, publishedAt: true,
        author: { select: { username: true, ...badgeColorSelect } } },
    });
    const recentBans = await prisma.moderationBan.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true, type: true, reason: true, createdAt: true,
        user:     { select: { username: true, ...badgeColorSelect } },
        issuedBy: { select: { username: true, ...badgeColorSelect } },
      },
    });
    const recentLiftedBans = await prisma.moderationBan.findMany({
      where:   { status: "lifted", liftedAt: { not: null } },
      orderBy: { liftedAt: "desc" },
      take:    3,
      include: { user: { select: { username: true, ...badgeColorSelect } } },
    });
    return {
      userCount, articleCount, commentCount, groupCount, pendingReportCount,
      recentUsers: recentUsers.map((u) => ({
        id: u.id, username: u.username, createdAt: u.createdAt,
        badgeColor: extractBadgeColor(u.groups),
      })),
      recentArticles: recentArticles.map((a) => ({
        id: a.id, title: a.title, slug: a.slug, publishedAt: a.publishedAt,
        author: { username: a.author.username, badgeColor: extractBadgeColor(a.author.groups) },
      })),
      recentBans: recentBans.map((b) => ({
        id: b.id, type: b.type, reason: b.reason, createdAt: b.createdAt,
        user:     { username: b.user.username,     badgeColor: extractBadgeColor(b.user.groups) },
        issuedBy: { username: b.issuedBy.username, badgeColor: extractBadgeColor(b.issuedBy.groups) },
      })),
      recentLiftedBans: recentLiftedBans.map((b) => ({
        id: b.id, liftedAt: b.liftedAt!.toISOString(),
        user: { username: b.user.username, badgeColor: extractBadgeColor(b.user.groups) },
      })),
    };
  },

  /** Time-series analytics for the dashboard charts. All series are derived from
   *  real rows (no synthetic data). `range` is the visible window in days; we
   *  fetch a doubled window so each series carries a previous-period comparison
   *  and so deltas are current-window vs the window before it. Page-views /
   *  unique-visitors are not tracked in core, so the "traffic" series uses real
   *  successful-login events as the engagement proxy. */
  async getDashboardAnalytics(range: number) {
    const r = [7, 30, 90].includes(range) ? range : 30;
    const span = r * 2;

    // Local-midnight day buckets; the last bucket is today.
    const windowStart = new Date();
    windowStart.setHours(0, 0, 0, 0);
    windowStart.setDate(windowStart.getDate() - (span - 1));

    // One GROUP-BY-day query per series — constant-size results regardless of
    // traffic (previously every row in the window was loaded and bucketed in
    // JS; loginEvent alone reaches tens of thousands on a modest site).
    // Columns are naive-UTC timestamps (Prisma default); shift into the
    // server's local zone so SQL buckets match the local-midnight window.
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const dayCountsQuery = (table: string, col: string, extra?: Prisma.Sql) => Prisma.sql`
      SELECT to_char((${Prisma.raw(`"${col}"`)} AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day,
             count(*)::int AS n
      FROM ${Prisma.raw(`"${table}"`)}
      WHERE ${Prisma.raw(`"${col}"`)} >= ${windowStart} ${extra ?? Prisma.empty}
      GROUP BY 1`;
    const dayCounts = async (sql: Prisma.Sql) => {
      const rows = await prisma.$queryRaw<Array<{ day: string; n: number }>>(sql);
      return new Map(rows.map((row) => [row.day, Number(row.n)]));
    };

    // Local YYYY-MM-DD key for each bucket index (matches the to_char above).
    const dayKeys: string[] = [];
    for (let i = 0; i < span; i++) {
      const d = new Date(windowStart);
      d.setDate(windowStart.getDate() + i);
      dayKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    }
    const empty = () => new Array<number>(span).fill(0);
    const fromMap = (m: Map<string, number>) => dayKeys.map((k) => m.get(k) ?? 0);

    const [
      regMap, comMap, artMap, logMap, repMap,
      pendingReports, totalUsers, publishedTotal, baseMembers, topRows,
    ] = await Promise.all([
      dayCounts(dayCountsQuery("xcf_users", "createdAt")),
      dayCounts(dayCountsQuery("xcf_article_comments", "created_at")),
      dayCounts(dayCountsQuery("xcf_articles", "published_at", Prisma.sql`AND "status" = 'published'`)),
      dayCounts(dayCountsQuery("xcf_login_events", "createdAt", Prisma.sql`AND "event_type" = 'login' AND "success" = true`)),
      dayCounts(dayCountsQuery("xcf_moderation_reports", "created_at")),
      prisma.moderationReport.count({ where: { status: "pending" } }),
      prisma.user.count(),
      prisma.article.count({ where: { status: "published", deletedAt: null } }),
      prisma.user.count({ where: { createdAt: { lt: windowStart } } }),
      prisma.article.findMany({
        where:   { status: "published", deletedAt: null },
        orderBy: { viewCount: "desc" },
        take:    5,
        select:  { id: true, title: true, slug: true, viewCount: true, category: { select: { name: true } } },
      }),
    ]);

    const regB = fromMap(regMap);
    const comB = fromMap(comMap);
    const artB = fromMap(artMap);
    const logB = fromMap(logMap);
    const repB = fromMap(repMap);

    // Cumulative member count across the whole span.
    const memB = empty();
    let running = baseMembers;
    for (let i = 0; i < span; i++) { running += regB[i]!; memB[i] = running; }

    const cur  = (a: number[]) => a.slice(span - r);
    const prev = (a: number[]) => a.slice(0, r);
    const sum  = (a: number[]) => a.reduce((x, y) => x + y, 0);
    const round1 = (n: number) => Math.round(n * 10) / 10;
    const pct  = (c: number, p: number) => (p ? round1(((c - p) / p) * 100) : (c > 0 ? 100 : 0));
    const totalsFor = (a: number[]) => { const c = sum(cur(a)), p = sum(prev(a)); return { cur: c, prev: p, pct: pct(c, p) }; };
    const spark = (a: number[]) => a.slice(Math.max(0, span - 21));

    const labels: string[] = [];
    for (let i = span - r; i < span; i++) {
      const d = new Date(windowStart);
      d.setDate(windowStart.getDate() + i);
      labels.push(d.toLocaleDateString("en-US", { month: "short", day: "numeric" }));
    }

    const regTot = totalsFor(regB), comTot = totalsFor(comB), artTot = totalsFor(artB), repTot = totalsFor(repB);
    const memNow = memB[span - 1] ?? totalUsers;
    const memPrev = memB[span - r - 1] ?? baseMembers;

    return {
      range: r,
      labels,
      series: {
        logins:        { values: cur(logB), compare: prev(logB) },
        registrations: { values: cur(regB), compare: prev(regB) },
        comments:      { values: cur(comB), compare: prev(comB) },
        articles:      { values: cur(artB), compare: prev(artB) },
      },
      totals: {
        logins:        totalsFor(logB),
        registrations: regTot,
        comments:      comTot,
        articles:      artTot,
        members:       { cur: memNow, prev: memPrev, pct: pct(memNow, memPrev) },
      },
      kpis: [
        { id: "members",  value: totalUsers,     delta: regTot.pct, deltaCount: regTot.cur, spark: spark(memB) },
        { id: "articles", value: publishedTotal, delta: artTot.pct, deltaCount: artTot.cur, spark: spark(artB) },
        { id: "comments", value: comTot.cur,     delta: comTot.pct, deltaCount: comTot.cur, spark: spark(comB) },
        { id: "reports",  value: pendingReports, delta: repTot.cur - repTot.prev, deltaCount: repTot.cur, spark: spark(repB), deltaInvert: true },
      ],
      topContent: topRows.map((a) => ({
        id: a.id, title: a.title, slug: a.slug, views: a.viewCount, category: a.category?.name ?? null,
      })),
    };
  },

  // ── Users ─────────────────────────────────────────────────────────────────

  // The list, one member's page and membership deltas live in adminUsers.service.
  listUsers:        adminUsersService.listUsers.bind(adminUsersService),
  getUserDetail:    adminUsersService.getUserDetail.bind(adminUsersService),
  patchUserGroups:  adminUsersService.patchUserGroups.bind(adminUsersService),

  /** Paginated security/login activity for a user (newest first). */
  async listUserLoginEvents(userId: string, page: number, limit: number) {
    // The security-activity view is for a human reviewer, so it shows only
    // security-meaningful events (login / failed_redeem / register /
    // password_change). Automatic, high-frequency telemetry — `refresh` (token
    // rotation every ~15 min) and beta-gate `page_visit` — floods the list with
    // redundant rows (BUGS.md #5) and is excluded. The rows stay in the table;
    // the security-analysis job reads loginEvent directly, unaffected.
    const where = { userId, eventType: { notIn: ["refresh", "page_visit"] } };
    return paginate(page, limit,
      (skip, take) => prisma.loginEvent.findMany({
        where,
        orderBy: { createdAt: "desc" },
        select:  { id: true, ip: true, userAgent: true, deviceCookieId: true, success: true, eventType: true, createdAt: true },
        skip, take,
      }),
      () => prisma.loginEvent.count({ where }),
    );
  },

  async setUserGroups(userId: string, groupIds: string[]) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw XentiumError.notFound("User not found");
    await prisma.$transaction(async (tx) => {
      await tx.userGroup.deleteMany({ where: { userId } });
      if (groupIds.length > 0) {
        await tx.userGroup.createMany({
          data: groupIds.map((groupId) => ({ userId, groupId })),
        });
      }
    });
    // Effective permissions changed — invalidate the user's cache
    await permissionCache.invalidate(userId);
  },

  async setUserActive(userId: string, isActive: boolean, requestingUserId?: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw XentiumError.notFound("User not found");
    if (requestingUserId && requestingUserId === userId) {
      throw XentiumError.forbidden("You cannot deactivate your own account");
    }
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.user.update({ where: { id: userId }, data: { isActive } });
      // Deactivation must revoke all sessions immediately (§49/§17b): the next
      // /auth/refresh fails (rotateSession rechecks isActive), so the account is
      // signed out everywhere within the access-token TTL instead of continuing
      // to mint fresh tokens for the full 30-day refresh window.
      if (!isActive) {
        await tx.session.updateMany({
          where: { userId, revokedAt: null },
          data:  { revokedAt: new Date() },
        });
      }
      return row;
    });
    // Denylist outstanding access tokens so deactivation is immediate, not just
    // bounded by the 15-min access-token TTL (BUGS.md #4).
    if (!isActive) await revokeUserAccessTokens(userId);
    return updated;
  },

  async banUser(opts: {
    userId: string;
    issuedById: string;
    type: "temporary" | "permanent";
    reason: string;
    expiresAt?: Date | null;
  }) {
    const user = await prisma.user.findUnique({
      where: { id: opts.userId },
      include: { groups: { include: { group: { select: { key: true } } } } },
    });
    if (!user) throw XentiumError.notFound("User not found");
    if (opts.issuedById === opts.userId) {
      throw XentiumError.forbidden("You cannot ban yourself");
    }
    const isAdmin = user.groups.some((ug) => ug.group.key === "admin");
    if (isAdmin) {
      throw XentiumError.forbidden("Administrator accounts cannot be banned");
    }

    await prisma.$transaction(async (tx) => {
      await tx.moderationBan.create({
        data: {
          userId:      opts.userId,
          issuedById:  opts.issuedById,
          type:        opts.type,
          reason:      opts.reason,
          status:      "active",
          expiresAt:   opts.expiresAt ?? null,
        },
      });
      const bannedUntil = opts.type === "permanent"
        ? new Date("9999-12-31")
        : (opts.expiresAt ?? null);
      await tx.user.update({ where: { id: opts.userId }, data: { bannedUntil } });
      // Revoke all sessions in the same transaction so the ban takes effect
      // immediately (§43): without this, an already-logged-in user keeps
      // refreshing a fresh access token every 15 min for the whole refresh
      // window, never re-hitting the login-time ban check.
      await tx.session.updateMany({
        where: { userId: opts.userId, revokedAt: null },
        data:  { revokedAt: new Date() },
      });
      await tx.moderationLog.create({
        data: {
          actorId:    opts.issuedById,
          actorType:  "user",
          action:     "ban.issued",
          targetType: "user",
          targetId:   opts.userId,
          reason:     opts.reason,
        },
      });
    });
    // Immediate ban (BUGS.md #4): denylist any access token already in flight so
    // the banned user is rejected on their next request, not up to 15 min later.
    await revokeUserAccessTokens(opts.userId);

    const { notificationService } = await import("../notifications/notification.service.js");
    await notificationService.dispatch({
      userId:   opts.userId,
      type:     "moderation.ban_issued",
      title:    opts.type === "permanent" ? "Your account has been permanently suspended" : "Your account has been temporarily suspended",
      body:     opts.reason,
      channels: ["in_app", "email"],
    });
  },

  async liftBan(userId: string, liftedById: string) {
    const activeBan = await prisma.moderationBan.findFirst({
      where: { userId, status: "active" },
      orderBy: { createdAt: "desc" },
    });
    if (!activeBan) throw XentiumError.notFound("No active ban found for this user");

    await prisma.$transaction(async (tx) => {
      await tx.moderationBan.update({
        where: { id: activeBan.id },
        data: { status: "lifted", liftedAt: new Date(), liftedBy: liftedById },
      });
      await tx.user.update({ where: { id: userId }, data: { bannedUntil: null } });
      await tx.moderationLog.create({
        data: {
          actorId:    liftedById,
          actorType:  "user",
          action:     "ban.lifted",
          targetType: "user",
          targetId:   userId,
          reason:     `Ban lifted (was: ${activeBan.reason})`,
        },
      });
    });

    const { notificationService } = await import("../notifications/notification.service.js");
    await notificationService.dispatch({
      userId,
      type:     "moderation.ban_lifted",
      title:    "Your account suspension has been lifted",
      body:     "Your suspension has been removed. You can now log in.",
      channels: ["in_app"],
    });
  },

  // ── Admin account actions (§17b) ──────────────────────────────────────────

  /** Force-logout a user: revoke ALL their active sessions. Their next refresh
   *  fails, so they are signed out everywhere within the 15-min access-token TTL
   *  (§43). Equivalent to "delete all refresh tokens for user" (§17b). */
  async forceLogoutUser(userId: string, actorId: string) {
    await assertActionableUser(userId, actorId);

    const { count } = await prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data:  { revokedAt: new Date() },
    });
    // Immediate force-logout (BUGS.md #4): revoke in-flight access tokens too.
    await revokeUserAccessTokens(userId);

    await prisma.moderationLog.create({
      data: {
        actorId,
        actorType:  "user",
        action:     "user.force_logout",
        targetType: "user",
        targetId:   userId,
        reason:     `Revoked ${count} active session(s)`,
      },
    });

    return { revokedSessions: count };
  },

  /** Send a password-reset email to a user's registered address on the admin's
   *  behalf. Reuses the same single-use DB-backed token flow as the public
   *  endpoint (§17b). No-op silently if the account has no email / is inactive. */
  async sendPasswordResetForUser(userId: string, actorId: string) {
    const user = await assertActionableUser(userId, actorId);

    const { requestPasswordReset } = await import("../auth/auth.service.js");
    await requestPasswordReset(user.email);

    await prisma.moderationLog.create({
      data: {
        actorId,
        actorType:  "user",
        action:     "user.password_reset_sent",
        targetType: "user",
        targetId:   userId,
        reason:     `Password reset email sent to ${user.email}`,
      },
    });

    return { ok: true };
  },

  // ── Profile Fields ────────────────────────────────────────────────────────

  async listProfileFields() {
    return prisma.userProfileField.findMany({ orderBy: { position: "asc" } });
  },

  async createProfileField(data: {
    key: string;
    label: string;
    type: string;
    placeholder?: string;
    showOnRegistration: boolean;
    requiredOnRegistration: boolean;
    showOnProfile: boolean;
  }) {
    const exists = await prisma.userProfileField.findUnique({ where: { key: data.key } });
    if (exists) throw XentiumError.conflict("A field with that key already exists");
    const max = await prisma.userProfileField.aggregate({ _max: { position: true } });
    return prisma.userProfileField.create({
      data: { ...data, position: (max._max.position ?? 0) + 1 },
    });
  },

  async updateProfileField(id: string, data: {
    label?: string;
    placeholder?: string;
    showOnRegistration?: boolean;
    requiredOnRegistration?: boolean;
    showOnProfile?: boolean;
    dobDisplayFormat?: string;
  }) {
    const field = await prisma.userProfileField.findUnique({ where: { id } });
    if (!field) throw XentiumError.notFound("Profile field not found");
    return prisma.userProfileField.update({ where: { id }, data });
  },

  async deleteProfileField(id: string) {
    const field = await prisma.userProfileField.findUnique({ where: { id } });
    if (!field) throw XentiumError.notFound("Profile field not found");
    if (field.isSystem) throw XentiumError.forbidden("Cannot delete a system profile field");
    await prisma.userProfileField.delete({ where: { id } });
  },

  async reorderProfileFields(items: Array<{ id: string; position: number }>) {
    await prisma.$transaction(
      items.map((item) =>
        prisma.userProfileField.update({
          where: { id: item.id },
          data: { position: item.position },
        }),
      ),
    );
  },

  // ── Settings ──────────────────────────────────────────────────────────────

  // Default values for structured admin settings (§60, §26, CLAUDE.md)
  SETTING_DEFAULTS: {
    "site.name":                           "My Xentium Site",
    "site.url":                            "",
    "site.description":                    "",
    "site.locale":                         "en",
    "site.timezone":                       "UTC",
    "auth.registration_mode":              "open",
    "auth.allow_registration":             true,
    "auth.require_email_verification":     true,
    "auth.default_group":                  "member",
    // Login (§43) — which identifier members sign in with, and failed-attempt lockout.
    "auth.login_method":                   "email",   // email | username | either
    "auth.lockout_enabled":                true,
    "auth.lockout_max_attempts":           5,
    "auth.lockout_duration_minutes":       10,
    // Registration — optionally collect a display name (full name) alongside username.
    "registration.collect_name":           false,
    "registration.name_required":          false,
    // Profile — show a user's recent former usernames ("previously known as …").
    // Admin-controlled; users cannot hide it. Window in days (0 = show all history).
    "profile.show_previous_usernames":     true,
    "profile.previous_username_days":      90,
    "articles.allow_comments":             true,
    "articles.require_comment_approval":   false,
    "articles.per_page":                   10,
    // Outbound mail. These are the keys the sender actually reads
    // (infrastructure/email/email.service.ts) — the old `email.smtp_*` trio was
    // written by the ACP and read by nothing, so configuring mail never worked.
    // user/pass stay blank for an unauthenticated local relay; smtp.pass is a
    // write-only secret (encrypted at rest, never returned by getSettings).
    "smtp.host":                           "",
    "smtp.port":                           587,
    "smtp.user":                           "",
    "smtp.pass":                           "",
    "smtp.from":                           "",
    "smtp.from_name":                      "",
    "smtp.secure":                         false,
    // Log retention windows in days, applied by the log-retention job (0 = keep
    // forever). Page visits are high-volume telemetry; ACP actions are the audit
    // trail and default to a longer window.
    "retention.activity_page_visit_days":  30,
    "retention.activity_action_days":      180,
    "retention.error_log_days":            90,
    "retention.login_events_days":         180,
    "retention.task_runs_days":            90,
    // Dead (revoked/expired) refresh-token sessions and spent single-use auth
    // tokens. Live sessions are never touched regardless of these windows.
    "retention.sessions_days":             30,
    "retention.auth_tokens_days":          7,
  } as Record<string, unknown>,

  async getSettings() {
    const stored = await prisma.setting.findMany({ orderBy: { key: "asc" } });
    const map = new Map(stored.map(s => [s.key, s]));

    // Merge defaults so structured settings always appear
    const defaults = adminService.SETTING_DEFAULTS;
    const merged = [...stored];
    for (const [key, value] of Object.entries(defaults)) {
      if (!map.has(key)) {
        merged.push({ key, value: value as any, updatedAt: new Date() });
      }
    }
    // Secrets never leave the server. The client only learns whether one is
    // set, which is all the ACP needs to render Set / Remove.
    return merged
      .map(r => SECRET_SETTING_KEYS.has(r.key)
        ? { ...r, value: r.value ? SECRET_MASK : "" }
        : r)
      .sort((a, b) => a.key.localeCompare(b.key));
  },

  async setSetting(key: string, value: unknown) {
    // No beta special-cases here any more. `beta.*` keys are still ordinary
    // settings rows, but the plugin that owns the gate validates them on its own
    // endpoint and normalises again on read — core has no opinion about what a
    // beta route is, so it cannot be the thing that checks one.
    if (SECRET_SETTING_KEYS.has(key)) {
      // The client renders the mask, so it can echo it back on an unrelated
      // save. Treat that as "leave the stored secret alone" rather than
      // overwriting the real password with a row of bullets.
      if (value === SECRET_MASK) return prisma.setting.findUnique({ where: { key } });
      value = value ? encryptSecret(String(value)) : "";
    }
    const row = await prisma.setting.upsert({
      where: { key },
      update: { value: value as any },
      create: { key, value: value as any },
    });
    bustSettingsCache(key);
    // Appearance keys written through the generic endpoint (e.g. the Style
    // Editor's font settings) feed the served stylesheet: bump the style
    // version so the CSS memo invalidates and clients re-pull via SSE.
    if (key.startsWith("appearance.")) {
      await appearanceService.bumpStyleVersion();
    }
    return row;
  },

  // ── Articles (admin) ──────────────────────────────────────────────────────

  async listArticles(opts: { page: number; limit: number; status?: string }) {
    const { page, limit, status } = opts;
    const where: any = { deletedAt: null };
    if (status) where.status = status;
    const [data, total] = await Promise.all([
      prisma.article.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          slug: true,
          status: true,
          viewCount: true,
          likeCount: true,
          commentCount: true,
          createdAt: true,
          publishedAt: true,
          author: { select: { id: true, username: true, ...badgeColorSelect } },
          category: { select: { id: true, name: true } },
        },
      }),
      prisma.article.count({ where }),
    ]);
    return {
      data: data.map((a) => ({
        ...a,
        author: toUserRef(a.author),
      })),
      meta: buildPaginationMeta({ page, limit, total }),
    };
  },

  // ── Health ────────────────────────────────────────────────────────────────

  async getHealth() {
    const t0db = Date.now();
    let dbStatus: "ok" | "error" = "ok";
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      dbStatus = "error";
    }
    const dbLatency = Date.now() - t0db;

    const t0redis = Date.now();
    let redisStatus: "ok" | "error" = "ok";
    try {
      await redis.ping();
    } catch {
      redisStatus = "error";
    }
    const redisLatency = Date.now() - t0redis;

    let queueStatus: "ok" | "error" = "ok";
    try {
      await bullConnection.ping();
    } catch {
      queueStatus = "error";
    }

    let storageStatus: "ok" | "error" = "ok";
    let storageWriteable = false;
    try {
      const probe = path.join(env.UPLOAD_DIR, ".health");
      await fs.writeFile(probe, "ok");
      await fs.unlink(probe);
      storageWriteable = true;
    } catch {
      storageStatus = "error";
    }

    const overall =
      dbStatus === "error" || queueStatus === "error"
        ? "critical"
        : redisStatus === "error" || storageStatus === "error"
          ? "degraded"
          : "healthy";

    return {
      db:      { status: dbStatus,      latencyMs: dbLatency },
      redis:   { status: redisStatus,   latencyMs: redisLatency },
      queue:   { status: queueStatus,   workerCount: 0 },
      storage: { status: storageStatus, writeable: storageWriteable },
      email:   { status: await isEmailConfigured() ? "configured" as const : "unconfigured" as const },
      overall,
    };
  },

  async softDeleteArticle(id: string) {
    const article = await prisma.article.findUnique({ where: { id } });
    if (!article) throw XentiumError.notFound("Article not found");
    await prisma.article.update({ where: { id }, data: { deletedAt: new Date() } });
  },

  // ── Moderation ────────────────────────────────────────────────────────────

  // ── Moderation lists (one implementation in moderationService — §A2 dedup) ──

  async listReports(opts: { page: number; limit: number; status?: string }) {
    return moderationService.listReports(opts);
  },

  async listWarnings(opts: { page: number; limit: number; status?: string }) {
    return moderationService.listWarnings(opts);
  },

  async listBans(opts: { page: number; limit: number; status?: string }) {
    return moderationService.listBans({ ...opts, withStats: true });
  },

  async listCases(opts: { page: number; limit: number; status?: string; type?: string }) {
    const { page, limit, status, type } = opts;
    const where: any = {
      ...(status ? { status } : {}),
      ...(type   ? { type   } : {}),
    };
    const SEV_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
    const [rows, total] = await Promise.all([
      prisma.moderationCase.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: "desc" } }),
      prisma.moderationCase.count({ where }),
    ]);
    rows.sort((a, b) => (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9));

    // Resolve linkedUserIds to { id, username, badgeColor }
    const allIds = [...new Set(rows.flatMap((r) => r.linkedUserIds))];
    const users  = allIds.length > 0
      ? await prisma.user.findMany({
          where:  { id: { in: allIds } },
          select: { id: true, username: true, ...badgeColorSelect },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, toUserRef(u)]));
    // Also fetch distinct IPs for linked users so the UI can display them in signals
    const ipRows = allIds.length > 0
      ? await prisma.loginEvent.findMany({
          where:    { userId: { in: allIds }, ip: { not: null }, success: true },
          select:   { ip: true },
          distinct: ["ip"],
        })
      : [];
    const ipAddresses = [...new Set(ipRows.map((r) => r.ip).filter(Boolean) as string[])];

    const data = rows.map((r) => ({
      ...r,
      linkedUsers:  r.linkedUserIds.map((id) => userMap.get(id) ?? { id, username: id, badgeColor: null }),
      ipAddresses,
    }));

    return { data, meta: buildPaginationMeta({ page, limit, total }) };
  },

  async revokeException(caseId: string, actorId: string) {
    const existing = await prisma.moderationCase.findUnique({ where: { id: caseId } });
    if (!existing) throw XentiumError.notFound("Case not found");

    // Remove all whitelist entries for this case
    const deleted = await prisma.reviewedSecuritySignal.deleteMany({ where: { caseId } });

    // Revert case status to open so it appears in the queue again
    const updated = await prisma.moderationCase.update({
      where: { id: caseId },
      data:  { status: "open", reviewedBy: null, reviewedAt: null },
    });

    await prisma.moderationLog.create({
      data: {
        actorId,
        actorType:  "user",
        action:     "security.exception_revoked",
        targetType: "moderation_case",
        targetId:   caseId,
        reason:     `Exception revoked — ${deleted.count} signal(s) removed from whitelist. Case re-opened for investigation.`,
      },
    });

    return updated;
  },

  async listModLog(opts: { page: number; limit: number; action?: string; actionPrefix?: string; actorType?: string }) {
    const { page, limit, action, actionPrefix, actorType } = opts;
    const where: any = {};
    if (action)       where.action    = action;
    if (actionPrefix) where.action    = { startsWith: actionPrefix + "." };
    if (actorType)    where.actorType = actorType;
    const [rows, total] = await Promise.all([
      prisma.moderationLog.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.moderationLog.count({ where }),
    ]);

    // Batch-resolve actor + user-target usernames
    const userIds = new Set<string>();
    for (const r of rows) {
      if (r.actorId)                             userIds.add(r.actorId);
      if (r.targetId && r.targetType === "user") userIds.add(r.targetId);
    }

    // Also resolve case-target → linked user IDs so we can show real names
    const caseTargetIds = rows
      .filter((r) => r.targetType === "moderation_case" && r.targetId)
      .map((r) => r.targetId as string);
    const cases = caseTargetIds.length > 0
      ? await prisma.moderationCase.findMany({
          where:  { id: { in: caseTargetIds } },
          select: { id: true, type: true, linkedUserIds: true },
        })
      : [];
    const caseMap     = new Map(cases.map((c) => [c.id, c]));
    cases.forEach((c) => c.linkedUserIds.forEach((uid) => userIds.add(uid)));

    const users = userIds.size > 0
      ? await prisma.user.findMany({
          where:  { id: { in: [...userIds] } },
          select: { id: true, username: true, ...badgeColorSelect },
        })
      : [];
    const userMap  = new Map(users.map((u) => [u.id, u.username]));
    const colorMap = new Map(users.map((u) => [u.id, extractBadgeColor(u.groups)]));

    const data = rows.map((r) => {
      let targetUsername: string | null = null;
      let targetBadgeColor: string | null = null;
      let targetDetail: string | null = null;

      if (r.targetId && r.targetType === "user") {
        targetUsername    = userMap.get(r.targetId) ?? r.targetId;
        targetBadgeColor  = colorMap.get(r.targetId) ?? null;
      } else if (r.targetId && r.targetType === "moderation_case") {
        // Subject = the case TYPE (e.g. "Multiaccounting"); detail = who shares what.
        const c           = caseMap.get(r.targetId);
        const linkedIds   = c?.linkedUserIds ?? [];
        const names       = linkedIds.map((uid) => userMap.get(uid) ?? uid).filter(Boolean);
        targetUsername    = c ? humanizeCaseType(c.type) : "Case";
        targetDetail      = c ? describeCaseSignal(c.type, names) : null;
      } else if (r.targetType === "device_cookie") {
        // Show a short, readable form — the full UUID is noise to a mod
        targetUsername    = r.targetId ? `Cookie ${r.targetId.slice(0, 8)}…` : "Device Cookie";
      } else if (r.targetType === "ip") {
        // The IP itself IS useful — show it directly
        targetUsername    = r.targetId ?? "IP";
      }

      return {
        ...r,
        actorUsername:    r.actorId ? (userMap.get(r.actorId)  ?? r.actorId)  : null,
        actorBadgeColor:  r.actorId ? (colorMap.get(r.actorId) ?? null)       : null,
        targetUsername,
        targetBadgeColor,
        targetDetail,
      };
    });

    return { data, meta: buildPaginationMeta({ page, limit, total }) };
  },

  // ── Moderation write ops (delegates to moderationService) ────────────────

  async updateReport(id: string, actorId: string, data: {
    status?: string; notes?: string; assignedTo?: string | null;
  }) {
    return moderationService.updateReport(id, actorId, data);
  },

  async issueWarning(data: {
    userId: string; issuedById: string; reason: string; expiresAt?: Date | null;
  }) {
    return moderationService.issueWarning(data);
  },

  async pardonWarning(id: string, adminId: string) {
    return moderationService.pardonWarning(id, adminId);
  },

  async updateCaseNotes(id: string, notes: string) {
    await prisma.moderationCase.update({ where: { id }, data: { notes: notes || null } });
  },

  async updateCase(id: string, actorId: string, status: "reviewed" | "dismissed") {
    return moderationService.updateCase(id, actorId, status);
  },

  async moderatorDeleteComment(type: "article" | "profile", id: string, actorId: string, reason: string) {
    if (type === "article") return moderationService.moderatorDeleteArticleComment(id, actorId, reason);
    return moderationService.moderatorDeleteProfileComment(id, actorId, reason);
  },

  // ── Plugins ───────────────────────────────────────────────────────────────

  async listInstalledPlugins() {
    return prisma.installedPlugin.findMany({ orderBy: { installedAt: "desc" } });
  },

  // ── License ───────────────────────────────────────────────────────────────

  /** The install's current signed entitlement document, or null. NOT proof of a
   *  licence — see the Entitlement model and licenseAttention.ts. */
  async getActiveEntitlement() {
    return prisma.entitlement.findFirst({
      where: { status: "active" },
      orderBy: { activatedAt: "desc" },
    });
  },

  // ── Error log ─────────────────────────────────────────────────────────────

  async listErrorLog(opts: { page: number; limit: number; severity?: string; domain?: string }) {
    const { page, limit, severity, domain } = opts;
    const where: any = {};
    if (severity) where.severity = severity;
    if (domain)   where.code = { startsWith: `XEC-${domain.toUpperCase()}-` };
    return paginate(page, limit,
      (skip, take) => prisma.errorLog.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
      () => prisma.errorLog.count({ where }),
    );
  },

  async clearErrorLog(severity?: string) {
    const where: any = severity ? { severity } : {};
    await prisma.errorLog.deleteMany({ where });
  },

  async listMigrationHistory() {
    const [runs, schema] = await Promise.all([
      prisma.migrationRun.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
      schemaStatus(),
    ]);
    return { runs, schema };
  },

  // ── Style history ─────────────────────────────────────────────────────────

  async listStyleHistory() {
    const rows = await prisma.styleHistory.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { savedBy: { select: { id: true, username: true, ...badgeColorSelect } } },
    });
    return rows.map((r) => ({
      ...r,
      savedBy: toUserRef(r.savedBy),
    }));
  },

  // ── Nav items ─────────────────────────────────────────────────────────────

  async listNavItems() {
    return prisma.navItem.findMany({ orderBy: { position: "asc" } });
  },

  async createNavItem(data: {
    label: string; url: string; openInNewTab: boolean; visibility: string;
  }) {
    const max = await prisma.navItem.aggregate({ _max: { position: true } });
    return prisma.navItem.create({
      data: { ...data, position: (max._max.position ?? 0) + 1 },
    });
  },

  async updateNavItem(id: string, data: Partial<{
    label: string; url: string; isActive: boolean; openInNewTab: boolean; visibility: string;
  }>) {
    const item = await prisma.navItem.findUnique({ where: { id } });
    if (!item) throw XentiumError.notFound("Nav item not found");
    return prisma.navItem.update({ where: { id }, data });
  },

  async reorderNavItems(items: Array<{ id: string; position: number }>) {
    await prisma.$transaction(
      items.map(({ id, position }) =>
        prisma.navItem.update({ where: { id }, data: { position } }),
      ),
    );
  },

  async deleteNavItem(id: string) {
    const item = await prisma.navItem.findUnique({ where: { id } });
    if (!item) return;
    if (item.isSystem) throw XentiumError.forbidden("Core nav links cannot be deleted — deactivate them instead");
    await prisma.navItem.delete({ where: { id } });
  },

  /** ACP "reset to defaults": re-create any missing core links (Home,
      Articles, Members). Shared with the installer seed + boot. */
  async seedDefaultNavItems() {
    await seedDefaultNavItems();
  },
};

/**
 * The schema as it actually is: the migrations this build ships against what
 * Prisma recorded as applied. Read live rather than from the history rows,
 * because not every deploy writes one — `xentium update` migrates through the
 * CLI, which never talks to the app.
 *
 * Null when either side cannot be read (no migrations folder beside a dev
 * build, or a database that predates Prisma's table): the page then shows no
 * schema figure rather than a wrong one.
 */
async function schemaStatus(): Promise<{
  total: number; applied: number; pending: string[]; failed: string[]; lastAppliedAt: Date | null;
} | null> {
  let shipped: string[];
  try {
    const dir = path.join(env.REPO_ROOT, "prisma", "migrations");
    const entries = await fs.readdir(dir, { withFileTypes: true });
    shipped = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    return null;
  }

  let rows: Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>;
  try {
    rows = await prisma.$queryRaw`
      SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations`;
  } catch {
    return null;
  }

  const applied = new Set(rows.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => r.migration_name));
  // Started, never finished, never rolled back: what P3009 refuses to deploy past.
  const failed = rows.filter((r) => !r.finished_at && !r.rolled_back_at).map((r) => r.migration_name);
  const lastAppliedAt = rows.reduce<Date | null>(
    (latest, r) => (r.finished_at && (!latest || r.finished_at > latest) ? r.finished_at : latest), null);

  return {
    total: shipped.length,
    applied: shipped.filter((name) => applied.has(name)).length,
    pending: shipped.filter((name) => !applied.has(name) && !failed.includes(name)),
    failed,
    lastAppliedAt,
  };
}
