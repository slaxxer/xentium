import { useQuery } from "@tanstack/react-query";
import { useTranslation, Trans } from "react-i18next";
import { Link } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faUsers, faNewspaper, faComments, faFlag,
  faUser,
  faUsersGear, faBan, faPuzzlePiece, faUnlock,
} from "@fortawesome/free-solid-svg-icons";
import type { TFunction } from "i18next";
import { api } from "../../../lib/api";
import { Username } from "../../../components/Username";

interface HealthCheck {
  db:      { status: "ok" | "error"; latencyMs: number };
  redis:   { status: "ok" | "error"; latencyMs: number };
  queue:   { status: "ok" | "error"; workerCount: number };
  storage: { status: "ok" | "error"; writeable: boolean };
  email:   { status: "configured" | "unconfigured" | "error" };
  overall: "healthy" | "degraded" | "critical";
}

interface DashboardStats {
  userCount: number;
  articleCount: number;
  commentCount: number;
  groupCount: number;
  pendingReportCount: number;
  recentUsers: { id: string; username: string; createdAt: string; badgeColor: string | null }[];
  recentArticles: {
    id: string; title: string; slug: string; publishedAt: string | null;
    author: { username: string; badgeColor: string | null };
  }[];
  recentBans: {
    id: string; type: string; reason: string; createdAt: string;
    user: { username: string; badgeColor: string | null };
    issuedBy: { username: string; badgeColor: string | null };
  }[];
  recentLiftedBans: {
    id: string; liftedAt: string;
    user: { username: string; badgeColor: string | null };
  }[];
}

function timeAgo(dateStr: string, t: TFunction) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return t("dashboard.agoM", { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("dashboard.agoH", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t("dashboard.agoD", { n: days });
  return t("dashboard.agoMo", { n: Math.floor(days / 30) });
}

function StatCard({ label, value, sub, color, icon }: {
  label: string; value: string | number; sub: string; color: string; icon: IconDefinition;
}) {
  return (
    <div className="acp-card" style={{ padding: "20px 22px" }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{
          width: 40, height: 40,
          background: `${color}15`,
          border: `1px solid ${color}30`,
          borderRadius: "var(--radius-sm)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 18, color,
        }}>
          <FontAwesomeIcon icon={icon} />
        </div>
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color, letterSpacing: "-0.03em" }}>{value}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--c-fg-muted)", marginTop: 4 }}>{label}</div>
      <div style={{ fontSize: 12, color: "var(--c-fg-muted)", marginTop: 2 }}>{sub}</div>
    </div>
  );
}

function StatusDot({ color }: { color: string }) {
  return (
    <span style={{
      width: 8, height: 8, borderRadius: "50%",
      background: color, display: "inline-block", flexShrink: 0,
    }} />
  );
}

export function DashboardPage() {
  const { t } = useTranslation("acp");
  const { data, isLoading } = useQuery<DashboardStats>({
    queryKey: ["acp-dashboard"],
    queryFn: () => api.get("/admin/dashboard"),
  });

  const { data: health, isLoading: healthLoading, isError: healthError } = useQuery<HealthCheck>({
    queryKey: ["acp-health"],
    queryFn: () => api.get("/admin/health"),
    refetchInterval: 30_000,
  });

  const activityFeed = [
    ...( data?.recentUsers.map(u => ({
      icon:      faUser,
      text:      <Trans ns="acp" i18nKey="dashboard.userRegistered" components={[<Username username={u.username} badgeColor={u.badgeColor} />]} />,
      sub:       timeAgo(u.createdAt, t),
      color:     "var(--c-accent)",
      timestamp: u.createdAt,
    })) ?? []),
    ...( data?.recentArticles.map(a => ({
      icon:      faNewspaper,
      text:      <Trans ns="acp" i18nKey="dashboard.articlePublishedBy" components={[<Username username={a.author.username} badgeColor={a.author.badgeColor} />]} />,
      sub:       `"${a.title}"`,
      color:     "var(--c-success)",
      timestamp: a.publishedAt,
    })) ?? []),
    ...( data?.recentBans.map(b => ({
      icon:      faBan,
      text:      <Trans ns="acp" i18nKey="dashboard.userBanned" components={[<Username username={b.user.username} badgeColor={b.user.badgeColor} />]} />,
      sub:       <>{b.type === "permanent" ? t("dashboard.permanently") : t("dashboard.temporarily")} · <Trans ns="acp" i18nKey="dashboard.byUser" components={[<Username username={b.issuedBy.username} badgeColor={b.issuedBy.badgeColor} />]} /></>,
      color:     "var(--c-danger)",
      timestamp: b.createdAt,
    })) ?? []),
    ...( data?.recentLiftedBans.map(b => ({
      icon:      faUnlock,
      text:      <Trans ns="acp" i18nKey="dashboard.banLifted" components={[<Username username={b.user.username} badgeColor={b.user.badgeColor} />]} />,
      sub:       timeAgo(b.liftedAt, t),
      color:     "var(--c-success)",
      timestamp: b.liftedAt,
    })) ?? []),
  ]
    .filter(item => !!item.timestamp)
    .sort((a, b) => new Date(a.timestamp!).getTime() - new Date(b.timestamp!).getTime())
    .slice(-6);

  const MUTED = "var(--c-fg-muted)";
  const OK    = "var(--c-success)";
  const WARN  = "var(--c-warn)";
  const ERR   = "var(--c-danger)";

  const healthRows: Array<[string, string, string]> = health
    ? [
        [
          t("dashboard.hDatabase"),
          health.db.status === "ok"
            ? t("dashboard.hConnected", { ms: health.db.latencyMs })
            : t("dashboard.hConnError"),
          health.db.status === "ok" ? OK : ERR,
        ],
        [
          t("dashboard.hRedis"),
          health.redis.status === "ok"
            ? t("dashboard.hConnected", { ms: health.redis.latencyMs })
            : t("dashboard.hConnError"),
          health.redis.status === "ok" ? OK : ERR,
        ],
        [
          t("dashboard.hQueue"),
          health.queue.status === "ok" ? t("dashboard.hRunning") : t("dashboard.hUnavailable"),
          health.queue.status === "ok" ? OK : ERR,
        ],
        [
          t("dashboard.hStorage"),
          health.storage.status === "ok"
            ? health.storage.writeable ? t("dashboard.hWritable") : t("dashboard.hReadOnly")
            : t("dashboard.hError"),
          health.storage.status === "ok"
            ? health.storage.writeable ? OK : WARN
            : ERR,
        ],
        [
          t("dashboard.hEmail"),
          health.email.status === "configured"   ? t("dashboard.hConfigured")
            : health.email.status === "unconfigured" ? t("dashboard.hNotConfigured")
            : t("dashboard.hError"),
          health.email.status === "configured" ? OK
            : health.email.status === "unconfigured" ? WARN
            : ERR,
        ],
      ]
    : [
        [t("dashboard.hDatabase"), "—", MUTED],
        [t("dashboard.hRedis"),    "—", MUTED],
        [t("dashboard.hQueue"),    "—", MUTED],
        [t("dashboard.hStorage"),  "—", MUTED],
        [t("dashboard.hEmail"),    "—", MUTED],
      ];

  const overallColor =
    healthError                          ? ERR  :
    health?.overall === "healthy"        ? OK   :
    health?.overall === "degraded"       ? WARN :
    health?.overall === "critical"       ? ERR  :
    MUTED;

  const overallLabel =
    healthError          ? t("dashboard.overallUnreachable") :
    healthLoading        ? t("dashboard.overallChecking")    :
    health?.overall === "healthy"  ? t("dashboard.overallHealthy")  :
    health?.overall === "degraded" ? t("dashboard.overallDegraded") :
    health?.overall === "critical" ? t("dashboard.overallCritical") :
    t("dashboard.overallUnknown");

  const quickActions: Array<[IconDefinition, string, string]> = [
    [faUsersGear,  t("dashboard.qaManageUsers"),  "/admin/users"],
    [faNewspaper,  t("dashboard.qaViewArticles"), "/admin/articles"],
    [faFlag,       t("dashboard.qaReportQueue"),  "/admin/reports"],
    [faPuzzlePiece,t("dashboard.qaMarketplace"),   "/admin/marketplace"],
  ];

  return (
    <div>
      {/* Page header */}
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">{t("nav.overview")}</div>
          <h1 className="acp-page-title">{t("nav.dashboard")}</h1>
        </div>
      </div>

      {/* Stat cards — matches mockup: Users / Articles / Forum Posts / Pending Reports */}
      <div className="acp-stat-grid">
        <StatCard
          label={t("dashboard.statUsers")} value={isLoading ? "—" : (data?.userCount ?? 0).toLocaleString()}
          sub={t("dashboard.statUsersSub")} color="var(--c-accent)" icon={faUsers}
        />
        <StatCard
          label={t("dashboard.statArticles")} value={isLoading ? "—" : (data?.articleCount ?? 0).toLocaleString()}
          sub={t("dashboard.statArticlesSub")} color="var(--c-success)" icon={faNewspaper}
        />
        <StatCard
          label={t("dashboard.statComments")} value={isLoading ? "—" : (data?.commentCount ?? 0).toLocaleString()}
          sub={t("dashboard.statCommentsSub")} color="var(--c-info, #38bdf8)" icon={faComments}
        />
        <StatCard
          label={t("dashboard.statReports")} value={isLoading ? "—" : (data?.pendingReportCount ?? 0).toLocaleString()}
          sub={t("dashboard.statReportsSub")} color="var(--c-danger)" icon={faFlag}
        />
      </div>

      {/* Main content */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 20, marginBottom: 20 }}>
        {/* Activity feed */}
        <div className="acp-card" style={{ padding: "22px" }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "var(--c-fg)", marginBottom: 18 }}>
            {t("dashboard.recentActivity")}
          </div>
          {isLoading ? (
            <div style={{ color: "var(--c-fg-muted)", fontSize: 13 }}>{t("dashboard.loading")}</div>
          ) : (
            <div>
              {activityFeed.map((a, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex", gap: 10, padding: "10px 0",
                    borderBottom: i < activityFeed.length - 1 ? "1px solid var(--c-border)" : "none",
                  }}
                >
                  <div style={{
                    width: 32, height: 32,
                    background: `${a.color}15`,
                    border: `1px solid ${a.color}30`,
                    borderRadius: "var(--radius-sm)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 13, color: a.color, flexShrink: 0,
                  }}>
                    <FontAwesomeIcon icon={a.icon} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--c-fg)" }}>{a.text}</div>
                    <div style={{ fontSize: 12, color: "var(--c-fg-muted)" }}>{a.sub}</div>
                  </div>
                </div>
              ))}
              {activityFeed.length === 0 && (
                <div style={{ color: "var(--c-fg-muted)", fontSize: 13 }}>{t("dashboard.noActivity")}</div>
              )}
            </div>
          )}
        </div>

        {/* Right column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* System Health */}
          <div className="acp-card" style={{ padding: "22px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: "var(--c-fg)" }}>{t("dashboard.systemHealth")}</div>
              <span style={{
                fontSize: 11, fontWeight: 700, padding: "2px 8px",
                borderRadius: 20,
                background: `${overallColor}18`,
                color: overallColor,
                border: `1px solid ${overallColor}35`,
              }}>
                {overallLabel}
              </span>
            </div>
            {healthRows.map(([label, value, color], i) => (
              <div
                key={label}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "8px 0",
                  borderBottom: i < healthRows.length - 1 ? "1px solid var(--c-border)" : "none",
                  opacity: healthLoading ? 0.45 : 1,
                  transition: "opacity .3s",
                }}
              >
                <span style={{ fontSize: 13, color: "var(--c-fg-muted)" }}>{label}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <StatusDot color={color} />
                  <span style={{ fontSize: 12, color, fontWeight: 600 }}>{value}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Quick Actions */}
          <div className="acp-card" style={{ padding: "22px" }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "var(--c-fg)", marginBottom: 16 }}>
              {t("dashboard.quickActions")}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {quickActions.map(([, label, to]) => (
                <Link
                  key={to}
                  to={to}
                  style={{
                    background: "var(--c-surface)",
                    border: "1px solid var(--c-border)",
                    color: "var(--c-fg-muted)",
                    padding: "9px 14px",
                    borderRadius: "var(--radius-sm)",
                    fontSize: 13, fontWeight: 600,
                    textDecoration: "none",
                    display: "flex", alignItems: "center",
                    transition: "border-color 0.15s, color 0.15s",
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = "var(--c-accent-glow)";
                    e.currentTarget.style.color = "var(--c-fg)";
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = "var(--c-border)";
                    e.currentTarget.style.color = "var(--c-fg-muted)";
                  }}
                >
                  {label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
