import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { FontAwesomeIcon } from "../../../components/Icon";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faUsers, faNewspaper, faComments, faFlag, faUserPlus, faBan, faUnlock,
  faDatabase, faBolt, faServer, faHardDrive, faEnvelope,
  faUsersGear, faPlus, faPuzzlePiece, faArrowRight, faArrowUpRightFromSquare,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { timeAgo } from "../../../lib/time";
import { avatarGradient } from "../../../components/Avatar";
import { Sparkline, AreaChart, BarChart, fmtK, fmtFull } from "../components/DashCharts";
import "./DashboardPage.scss";

// ── API shapes ────────────────────────────────────────────────────────────────
type MetricId = "logins" | "registrations" | "comments" | "articles";
type Window = { cur: number; prev: number; pct: number };

interface Analytics {
  range: number;
  labels: string[];
  series: Record<MetricId, { values: number[]; compare: number[] }>;
  totals: Record<MetricId, Window> & { members: Window };
  kpis: { id: string; value: number; delta: number; deltaCount: number; spark: number[]; deltaInvert?: boolean }[];
  topContent: { id: string; title: string; slug: string; views: number; category: string | null }[];
}

interface HealthCheck {
  db:      { status: "ok" | "error"; latencyMs: number };
  redis:   { status: "ok" | "error"; latencyMs: number };
  queue:   { status: "ok" | "error"; workerCount: number };
  storage: { status: "ok" | "error"; writeable: boolean };
  email:   { status: "configured" | "unconfigured" | "error" };
  overall: "healthy" | "degraded" | "critical";
}

interface DashboardStats {
  recentUsers:    { id: string; username: string; createdAt: string }[];
  recentArticles: { id: string; title: string; slug: string; publishedAt: string | null; author: { username: string } }[];
  recentBans:     { id: string; type: string; createdAt: string; user: { username: string }; issuedBy: { username: string } }[];
  recentLiftedBans:{ id: string; liftedAt: string; user: { username: string } }[];
}

// ── Presentational metadata (colours/icons/labels stay client-side) ──────────
const SERIES: Record<MetricId, { color: string; unit: string }> = {
  logins:        { color: "var(--c-accent)",  unit: "logins" },
  registrations: { color: "var(--c-accent2)", unit: "sign-ups" },
  comments:      { color: "var(--c-success)", unit: "comments" },
  articles:      { color: "var(--c-warn)",    unit: "articles" },
};
const ORDER: MetricId[] = ["logins", "registrations", "comments", "articles"];

const KPI_META: Record<string, { tone: string; icon: IconDefinition; color: string }> = {
  members:  { tone: "accent",  icon: faUsers,     color: "var(--c-accent)" },
  articles: { tone: "accent2", icon: faNewspaper, color: "var(--c-accent2)" },
  comments: { tone: "success", icon: faComments,  color: "var(--c-success)" },
  reports:  { tone: "danger",  icon: faFlag,      color: "var(--c-danger)" },
};

const RANGES = [7, 30, 90];

function initials(username: string): string {
  const parts = username.replace(/[^a-zA-Z0-9]+/g, " ").trim().split(" ");
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")).toUpperCase();
}

function KpiCard({ k, label, sub }: {
  k: Analytics["kpis"][number]; label: string; sub: string;
}) {
  const meta = KPI_META[k.id] ?? KPI_META.members!;
  const isPct = !k.deltaInvert && k.id !== "reports";
  const up = k.delta >= 0;
  const good = k.deltaInvert ? !up : up;
  const sign = up ? "+" : "";
  return (
    <div className={`kpi kpi--${meta.tone}`}>
      <div className="kpi__top">
        <span className="kpi__ic"><FontAwesomeIcon icon={meta.icon} /></span>
        <span className="kpi__label">{label}</span>
        <span className={"kpi__delta " + (good ? "is-up" : "is-down")}>
          <FontAwesomeIcon icon={faArrowRight} style={{ transform: up ? "rotate(-45deg)" : "rotate(45deg)", fontSize: 11 }} />
          {sign + k.delta + (isPct ? "%" : "")}
        </span>
      </div>
      <div className="kpi__val">{fmtFull(k.value)}</div>
      <div className="kpi__sub">{sub}</div>
      <div className="kpi__spark"><Sparkline data={k.spark.length ? k.spark : [0, 0]} color={meta.color} height={40} /></div>
    </div>
  );
}

export function DashboardPage() {
  const { t } = useTranslation("acp");
  const [range, setRange] = useState(30);
  const [metric, setMetric] = useState<MetricId>("logins");

  const { data: a, isLoading } = useQuery<Analytics>({
    queryKey: ["acp-dash-analytics", range],
    queryFn: () => api.get(`/admin/dashboard/analytics?range=${range}`),
  });
  const { data: stats } = useQuery<DashboardStats>({
    queryKey: ["acp-dashboard"],
    queryFn: () => api.get("/admin/dashboard"),
  });
  const { data: health, isError: healthError } = useQuery<HealthCheck>({
    queryKey: ["acp-health"],
    queryFn: () => api.get("/admin/health"),
    refetchInterval: 30_000,
  });

  const labels = a?.labels ?? [];
  const ser = a?.series[metric];
  const values = ser?.values ?? [];
  const compare = ser?.compare ?? null;
  const tot = a?.totals[metric] ?? { cur: 0, prev: 0, pct: 0 };
  const totUp = tot.pct >= 0;

  // registrations bar — daily for ≤30d, weekly buckets for 90d
  const regValuesRaw = a?.series.registrations.values ?? [];
  let regLabels: string[] = labels, regValues: number[] = regValuesRaw;
  if (range > 30) {
    regLabels = []; regValues = [];
    for (let i = 0; i < regValuesRaw.length; i += 7) {
      regValues.push(regValuesRaw.slice(i, i + 7).reduce((x, y) => x + y, 0));
      regLabels.push(labels[i] ?? "");
    }
  }
  const regTotal = regValues.reduce((x, y) => x + y, 0);

  // ── Activity feed (real, from /admin/dashboard) ────────────────────────────
  type Feed = { who: string; text: string; time: string; tone: string; icon: IconDefinition; ts: number };
  const feed: Feed[] = [
    ...(stats?.recentUsers ?? []).map((u) => ({
      who: u.username, text: t("dashboard.userRegisteredPlain"), time: timeAgo(u.createdAt),
      tone: "accent", icon: faUserPlus, ts: new Date(u.createdAt).getTime(),
    })),
    ...(stats?.recentArticles ?? []).filter((x) => x.publishedAt).map((x) => ({
      who: x.author.username, text: t("dashboard.articlePublishedPlain", { title: x.title }),
      time: timeAgo(x.publishedAt!), tone: "accent2", icon: faNewspaper, ts: new Date(x.publishedAt!).getTime(),
    })),
    ...(stats?.recentBans ?? []).map((b) => ({
      who: b.issuedBy.username, text: t("dashboard.bannedPlain", { user: b.user.username }),
      time: timeAgo(b.createdAt), tone: "danger", icon: faBan, ts: new Date(b.createdAt).getTime(),
    })),
    ...(stats?.recentLiftedBans ?? []).map((b) => ({
      who: b.user.username, text: t("dashboard.banLiftedPlain"), time: timeAgo(b.liftedAt),
      tone: "success", icon: faUnlock, ts: new Date(b.liftedAt).getTime(),
    })),
  ].sort((x, y) => y.ts - x.ts).slice(0, 6);

  // ── System health rows ─────────────────────────────────────────────────────
  type Svc = { label: string; note: string; status: "ok" | "warn" | "error" | "muted"; icon: IconDefinition };
  const svc: Svc[] = health ? [
    { label: t("dashboard.hDatabase"), icon: faDatabase,
      status: health.db.status === "ok" ? "ok" : "error",
      note: health.db.status === "ok" ? t("dashboard.hConnected", { ms: health.db.latencyMs }) : t("dashboard.hConnError") },
    { label: t("dashboard.hRedis"), icon: faBolt,
      status: health.redis.status === "ok" ? "ok" : "error",
      note: health.redis.status === "ok" ? t("dashboard.hConnected", { ms: health.redis.latencyMs }) : t("dashboard.hConnError") },
    { label: t("dashboard.hQueue"), icon: faServer,
      status: health.queue.status === "ok" ? "ok" : "error",
      note: health.queue.status === "ok" ? t("dashboard.hRunning") : t("dashboard.hUnavailable") },
    { label: t("dashboard.hStorage"), icon: faHardDrive,
      status: health.storage.status === "ok" ? (health.storage.writeable ? "ok" : "warn") : "error",
      note: health.storage.status === "ok" ? (health.storage.writeable ? t("dashboard.hWritable") : t("dashboard.hReadOnly")) : t("dashboard.hError") },
    { label: t("dashboard.hEmail"), icon: faEnvelope,
      status: health.email.status === "configured" ? "ok" : health.email.status === "unconfigured" ? "warn" : "error",
      note: health.email.status === "configured" ? t("dashboard.hConfigured") : health.email.status === "unconfigured" ? t("dashboard.hNotConfigured") : t("dashboard.hError") },
  ] : [
    { label: t("dashboard.hDatabase"), note: "—", status: "muted", icon: faDatabase },
    { label: t("dashboard.hRedis"), note: "—", status: "muted", icon: faBolt },
    { label: t("dashboard.hQueue"), note: "—", status: "muted", icon: faServer },
    { label: t("dashboard.hStorage"), note: "—", status: "muted", icon: faHardDrive },
    { label: t("dashboard.hEmail"), note: "—", status: "muted", icon: faEnvelope },
  ];

  const overall = healthError ? "critical" : (health?.overall ?? "healthy");
  const overallLabel = healthError ? t("dashboard.overallUnreachable")
    : overall === "healthy" ? t("dashboard.overallHealthy")
    : overall === "degraded" ? t("dashboard.overallDegraded")
    : t("dashboard.overallCritical");

  const quickActions: { icon: IconDefinition; label: string; to: string; tone: string; badge?: string }[] = [
    { icon: faUsersGear, label: t("dashboard.qaManageUsers"),  to: "/admin/users",       tone: "accent" },
    { icon: faPlus,      label: t("dashboard.qaNewArticle"),   to: "/admin/articles",    tone: "accent2" },
    { icon: faFlag,      label: t("dashboard.qaReportQueue"),  to: "/admin/reports",     tone: "danger",
      badge: a && a.kpis.find((k) => k.id === "reports")?.value ? String(a.kpis.find((k) => k.id === "reports")!.value) : undefined },
    { icon: faPuzzlePiece, label: t("dashboard.qaMarketplace"), to: "/admin/marketplace", tone: "success" },
  ];

  const kpiText: Record<string, { label: string; sub: (k: Analytics["kpis"][number]) => string }> = {
    members:  { label: t("dashboard.kMembers"),  sub: (k) => t("dashboard.kMembersSub", { n: k.deltaCount }) },
    articles: { label: t("dashboard.kArticles"), sub: (k) => t("dashboard.kArticlesSub", { n: k.deltaCount }) },
    comments: { label: t("dashboard.kComments"), sub: () => t("dashboard.kCommentsSub", { n: range }) },
    reports:  { label: t("dashboard.kReports"),  sub: () => t("dashboard.kReportsSub") },
  };

  return (
    <div className="dash">
      {/* header */}
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">{t("nav.overview")}</div>
          <h1 className="acp-page-title">{t("nav.dashboard")}</h1>
          <p className="acp-page-subtitle">{t("dashboard.intro")}</p>
        </div>
        <div className="dash-head__tools">
          <div className="seg">
            {RANGES.map((r) => (
              <button key={r} type="button" className={"seg__btn " + (range === r ? "is-on" : "")} onClick={() => setRange(r)}>
                {r}d
              </button>
            ))}
          </div>
          <Link className="nbghost" to="/"><FontAwesomeIcon icon={faArrowUpRightFromSquare} />{t("dashboard.viewSite")}</Link>
        </div>
      </div>

      {/* KPI row */}
      <div className="dash-kpis">
        {(a?.kpis ?? []).map((k) => (
          <KpiCard key={k.id} k={k} label={kpiText[k.id]?.label ?? k.id} sub={kpiText[k.id]?.sub(k) ?? ""} />
        ))}
        {!a && [0, 1, 2, 3].map((i) => (
          <div key={i} className="kpi"><div className="kpi__val">—</div></div>
        ))}
      </div>

      {/* main grid */}
      <div className="dash-grid">
        {/* traffic */}
        <section className="card dash-traffic">
          <div className="card__head">
            <div>
              <h3 className="card__title">{t("dashboard.trafficTitle")}</h3>
              <p className="card__sub">
                <b>{fmtFull(tot.cur)}</b> {t(`dashboard.s_${metric}`).toLowerCase()} · {t("dashboard.lastNDays", { n: range })}
                <span className={"card__delta " + (totUp ? "is-up" : "is-down")}>
                  {(totUp ? "▲ " : "▼ ") + Math.abs(tot.pct) + "%"}
                </span>
              </p>
            </div>
            <div className="seg seg--metrics">
              {ORDER.map((m) => (
                <button key={m} type="button" className={"seg__btn " + (metric === m ? "is-on" : "")} onClick={() => setMetric(m)}>
                  <i className="seg__dot" style={{ background: SERIES[m].color }} />{t(`dashboard.s_${m}`)}
                </button>
              ))}
            </div>
          </div>
          <AreaChart labels={labels} values={values} compare={compare} color={SERIES[metric].color} height={286} unit={SERIES[metric].unit} />
          <div className="chart-legend">
            <span><i style={{ background: SERIES[metric].color }} />{t("dashboard.thisPeriod")}</span>
            {compare && <span className="is-cmp"><i />{t("dashboard.prevPeriod")}</span>}
          </div>
        </section>

        {/* system health */}
        <section className="card dash-health">
          <div className="card__head">
            <div>
              <h3 className="card__title">{t("dashboard.systemHealth")}</h3>
              <p className="card__sub">{t("dashboard.allCoreServices")}</p>
            </div>
            <span className={"health-pill" + (overall === "degraded" ? " health-pill--degraded" : overall === "critical" ? " health-pill--critical" : "")}>
              <span className="health-pill__dot" />{overallLabel}
            </span>
          </div>
          <div className="svc">
            {svc.map((s) => (
              <div key={s.label} className="svc__row">
                <span className="svc__ic"><FontAwesomeIcon icon={s.icon} /></span>
                <span className="svc__label">{s.label}</span>
                <span className={"svc__note svc__note--" + s.status}>
                  <i className={"svc__dot svc__dot--" + s.status} />{s.note}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* registrations */}
        <section className="card dash-reg">
          <div className="card__head">
            <div>
              <h3 className="card__title">{t("dashboard.newRegistrations")}</h3>
              <p className="card__sub">
                <b>{fmtFull(regTotal)}</b> {t("dashboard.newMembers")} · {range <= 30 ? t("dashboard.perDay") : t("dashboard.perWeek")}
              </p>
            </div>
            <span className="card__chip"><FontAwesomeIcon icon={faUserPlus} /></span>
          </div>
          <BarChart labels={regLabels} values={regValues} color="var(--c-success)" height={196} />
        </section>

        {/* recent activity */}
        <section className="card dash-act">
          <div className="card__head">
            <h3 className="card__title">{t("dashboard.recentActivity")}</h3>
            <Link className="card__link" to="/admin/activity-log">{t("dashboard.viewAll")}</Link>
          </div>
          <div className="feed">
            {feed.map((f, i) => (
              <div key={i} className="feed__row">
                <span className="feed__ava" style={{ background: `linear-gradient(140deg, ${avatarGradient(f.who)[0]}, ${avatarGradient(f.who)[1]})` }}>
                  {initials(f.who)}
                  <span className={"feed__badge feed__badge--" + f.tone}><FontAwesomeIcon icon={f.icon} style={{ fontSize: 9 }} /></span>
                </span>
                <div className="feed__body">
                  <p><b>{f.who}</b> {f.text}</p>
                  <span>{f.time}</span>
                </div>
              </div>
            ))}
            {feed.length === 0 && <div className="dash-empty">{isLoading ? t("dashboard.loading") : t("dashboard.noActivity")}</div>}
          </div>
        </section>

        {/* quick actions + top content */}
        <section className="card dash-side">
          <div className="card__head"><h3 className="card__title">{t("dashboard.quickActions")}</h3></div>
          <div className="qa">
            {quickActions.map((q) => (
              <Link key={q.to} to={q.to} className={"qa__btn qa__btn--" + q.tone}>
                <span className="qa__ic"><FontAwesomeIcon icon={q.icon} /></span>
                <span className="qa__lbl">{q.label}</span>
                {q.badge
                  ? <span className="qa__badge">{q.badge}</span>
                  : <FontAwesomeIcon icon={faArrowRight} className="qa__arrow" />}
              </Link>
            ))}
          </div>
          <div className="card__divlabel">{t("dashboard.topContent")}</div>
          <div className="topc">
            {(a?.topContent ?? []).map((c, i) => (
              <Link key={c.id} to={`/articles/${c.slug}`} className="topc__row">
                <span className="topc__rank">{i + 1}</span>
                <div className="topc__body">
                  <p>{c.title}</p>
                  <span>{c.category ?? t("dashboard.uncategorized")}</span>
                </div>
                <span className="topc__views">{fmtK(c.views)}</span>
              </Link>
            ))}
            {a && a.topContent.length === 0 && <div className="dash-empty">{t("dashboard.noContent")}</div>}
          </div>
        </section>
      </div>
    </div>
  );
}
