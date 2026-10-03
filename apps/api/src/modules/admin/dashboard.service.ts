/**
 * The ACP dashboard in one read: the four metrics with a previous-period
 * comparison, the newest members, what needs an admin's attention, the setup
 * checklist a young site gets instead, top articles and the platform summary.
 * Service health stays its own endpoint (`/admin/health`) because it probes.
 */
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../infrastructure/db.js";
import { isEmailConfigured } from "../../infrastructure/email/email.service.js";
import { XENTIUM_VERSION } from "../../config/version.js";
import { getSetting } from "../../shared/utils/settings.js";
import { marketplaceService } from "./marketplace.service.js";

export const DASHBOARD_RANGES = [7, 30, 90] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];
export type MetricId = "members" | "active" | "comments" | "articles";

/** A site this young, with setup steps left, gets the setup card. */
const NEW_SITE_DAYS = 30;

export type AttentionItem =
  | { kind: "reports"; count: number; oldestAt: string }
  | { kind: "coreUpdate"; from: string; to: string; severity: string | null }
  | { kind: "pluginUpdate"; pluginId: string; name: string; from: string | null; to: string; critical: boolean }
  | { kind: "license"; expired: boolean; daysLeft: number | null; domain: string | null }
  | { kind: "errors"; count: number; codes: Array<{ code: string; count: number }> }
  | { kind: "tasks"; failing: number }
  | { kind: "email" };

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

export const dashboardService = {
  async overview(range: DashboardRange) {
    const span = range * 2;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    // Local-midnight day buckets, the last one today; the first half is the
    // previous period. Columns hold naive UTC, hence the double AT TIME ZONE.
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (span - 1));
    const mid = new Date(start);
    mid.setDate(mid.getDate() + range);
    const days: string[] = [];
    for (let i = 0; i < span; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    }
    const day = (col: string) => Prisma.sql`to_char((${Prisma.raw(col)} AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD')`;
    const perDay = async (sql: Prisma.Sql) => {
      const rows = await prisma.$queryRaw<Array<{ day: string; n: number }>>(sql);
      const m = new Map(rows.map((r) => [r.day, Number(r.n)]));
      return days.map((k) => m.get(k) ?? 0);
    };
    // A member is active on a day they signed in or opened a page.
    const activeRows = Prisma.sql`
      SELECT "createdAt" AS t, "userId" AS uid FROM xcf_login_events
        WHERE success AND "userId" IS NOT NULL AND "createdAt" >= ${start}
      UNION ALL
      SELECT created_at, user_id FROM xcf_activity_log
        WHERE user_id IS NOT NULL AND created_at >= ${start}`;

    const [members, comments, articles, active, activeTotals] = await Promise.all([
      perDay(Prisma.sql`SELECT ${day(`"createdAt"`)} AS day, count(*)::int AS n FROM xcf_users WHERE "createdAt" >= ${start} GROUP BY 1`),
      perDay(Prisma.sql`SELECT ${day("created_at")} AS day, count(*)::int AS n FROM xcf_article_comments WHERE created_at >= ${start} AND deleted_at IS NULL GROUP BY 1`),
      perDay(Prisma.sql`SELECT ${day("published_at")} AS day, count(*)::int AS n FROM xcf_articles WHERE published_at >= ${start} AND status = 'published' AND deleted_at IS NULL GROUP BY 1`),
      perDay(Prisma.sql`SELECT ${day("t")} AS day, count(DISTINCT uid)::int AS n FROM (${activeRows}) x GROUP BY 1`),
      // Distinct over the whole period, not the sum of the days.
      prisma.$queryRaw<Array<{ cur: number; prev: number }>>`
        SELECT count(DISTINCT uid) FILTER (WHERE t >= ${mid})::int AS cur,
               count(DISTINCT uid) FILTER (WHERE t <  ${mid})::int AS prev
        FROM (${activeRows}) x`,
    ]);

    const metric = (values: number[], total?: { cur: number; prev: number }) => ({
      total: total?.cur ?? sum(values.slice(range)),
      prevTotal: total?.prev ?? sum(values.slice(0, range)),
      values: values.slice(range),
      compare: values.slice(0, range),
    });

    const [
      totalMembers, newest, published, commentCount, categoryCount, activeTheme, styleEdits, siteName,
      firstUser, reports, errors, errorCodes, failingTasks, taskCount, lastRuns, pluginCount, emailOk, signals, top,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.findMany({
        where: { createdAt: { gte: mid } }, orderBy: { createdAt: "desc" }, take: 6,
        select: { id: true, username: true, avatar: true },
      }),
      prisma.article.count({ where: { status: "published", deletedAt: null } }),
      prisma.articleComment.count({ where: { deletedAt: null } }),
      prisma.articleCategory.count(),
      prisma.theme.count({ where: { active: true } }),
      prisma.styleHistory.count(),
      getSetting<string>("site.name", ""),
      prisma.user.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
      prisma.moderationReport.aggregate({ where: { status: "pending" }, _count: { _all: true }, _min: { createdAt: true } }),
      prisma.errorLog.count({ where: { severity: { in: ["error", "critical"] }, createdAt: { gte: new Date(Date.now() - 86_400_000) } } }),
      prisma.errorLog.groupBy({
        by: ["code"],
        where: { severity: { in: ["error", "critical"] }, createdAt: { gte: new Date(Date.now() - 86_400_000) } },
        _count: { _all: true }, orderBy: { _count: { code: "desc" } }, take: 3,
      }),
      prisma.scheduledTask.count({ where: { enabled: true, lastStatus: "error" } }),
      prisma.scheduledTask.count({ where: { enabled: true } }),
      prisma.scheduledTaskRun.findMany({ orderBy: { startedAt: "desc" }, take: 24, select: { status: true, startedAt: true } }),
      prisma.installedPlugin.count(),
      isEmailConfigured(),
      marketplaceService.getDashboardSignals(),
      prisma.article.findMany({
        where: { status: "published", deletedAt: null }, orderBy: { viewCount: "desc" }, take: 5,
        select: { id: true, title: true, slug: true, viewCount: true, category: { select: { name: true } }, author: { select: { username: true } } },
      }),
    ]);

    // ── Setup (a young site) ─────────────────────────────────────────────────
    const liveSince = firstUser?.createdAt ?? new Date();
    const steps = [
      { key: "admin", done: true },
      { key: "siteName", done: !!siteName, detail: siteName || null },
      { key: "email", done: emailOk },
      { key: "categories", done: categoryCount > 0 },
      { key: "article", done: published > 0 },
      { key: "theme", done: activeTheme > 0 || styleEdits > 0 },
    ];
    const ageDays = Math.floor((Date.now() - liveSince.getTime()) / 86_400_000);
    const stage = ageDays < NEW_SITE_DAYS && steps.some((s) => !s.done) ? "new" : "active";
    const lastWeek = active.slice(-7);

    // ── Needs attention ──────────────────────────────────────────────────────
    const attention: AttentionItem[] = [];
    if (reports._count._all > 0) {
      attention.push({ kind: "reports", count: reports._count._all, oldestAt: reports._min.createdAt!.toISOString() });
    }
    if (signals.core) attention.push({ kind: "coreUpdate", ...signals.core });
    // Critical plugin updates first: they are why this list exists.
    for (const u of [...signals.pluginUpdates].sort((a, b) => Number(b.critical) - Number(a.critical))) {
      attention.push({ kind: "pluginUpdate", ...u });
    }
    if (signals.license.expiringSoon || signals.license.expired) {
      attention.push({ kind: "license", expired: signals.license.expired, daysLeft: signals.license.daysLeft, domain: signals.license.domain });
    }
    if (errors > 0) {
      attention.push({ kind: "errors", count: errors, codes: errorCodes.map((c) => ({ code: c.code, count: c._count._all })) });
    }
    if (failingTasks > 0) attention.push({ kind: "tasks", failing: failingTasks });
    // On a young site email is a setup step; later, a missing provider is a problem.
    if (!emailOk && stage === "active") attention.push({ kind: "email" });

    return {
      range,
      stage,
      liveSince: liveSince.toISOString(),
      days: days.slice(range),
      metrics: {
        members: metric(members),
        active: metric(active, activeTotals[0]),
        comments: metric(comments),
        articles: metric(articles),
      },
      totalMembers,
      newest: { users: newest, count: sum(members.slice(range)) },
      attention,
      setup: {
        steps,
        milestones: {
          members: totalMembers,
          articles: published,
          comments: commentCount,
          activeDays: lastWeek.filter((n) => n > 0).length,
        },
      },
      topArticles: top.map((a) => ({
        id: a.id, title: a.title, slug: a.slug, views: a.viewCount,
        category: a.category?.name ?? null, author: a.author.username,
      })),
      platform: {
        version: XENTIUM_VERSION,
        coreUpdate: signals.core,
        plugins: { installed: pluginCount, updates: signals.pluginUpdates.length, critical: signals.pluginUpdates.some((u) => u.critical) },
        license: { ...signals.license, paidPlugins: await prisma.installedPlugin.count({ where: { licenseRequired: true } }) },
        tasks: {
          enabled: taskCount,
          failing: failingTasks,
          lastRunAt: lastRuns[0]?.startedAt.toISOString() ?? null,
          runs: lastRuns.map((r) => r.status).reverse(),
        },
        errors24h: errors,
      },
    };
  },
};
