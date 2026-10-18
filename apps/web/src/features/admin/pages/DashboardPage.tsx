import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import { faArrowRight } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "../../../components/Icon";
import { Avatar } from "../../../components/Avatar";
import { api } from "../../../lib/api";
import {
  METRICS, METRIC_COLOR, RANGES, pctChange, type Health, type MetricId, type Overview, type Range,
} from "./dashboard/dashboardModel";
import { PulseChart } from "./dashboard/PulseChart";
import { AttentionCard, Delta, Milestones, PlatformCard, SetupCard, TopArticles } from "./dashboard/DashboardCards";
import "./dashboard/Dashboard.scss";

export function DashboardPage() {
  const { t, i18n } = useTranslation("acp");
  const [range, setRange] = useState<Range>(30);
  const [metric, setMetric] = useState<MetricId>("members");

  const { data: o, isLoading } = useQuery<Overview>({
    queryKey: ["acp-dash-overview", range],
    queryFn: () => api.get(`/admin/dashboard/overview?range=${range}`),
    placeholderData: (prev) => prev,
  });
  const { data: health, isError: healthError } = useQuery<Health>({
    queryKey: ["acp-health"],
    queryFn: () => api.get("/admin/health"),
    refetchInterval: 60_000,
  });

  const fmt = (n: number) => n.toLocaleString(i18n.language);
  const today = new Date().toLocaleDateString(i18n.language, { weekday: "short", month: "short", day: "numeric" });
  const isNew = o?.stage === "new";

  // One pill for the whole platform: the worst thing /admin/health knows.
  const status = healthError
    ? { tone: "danger", label: t("dashboard.statusUnreachable") }
    : !health ? null
    : health.overall === "critical" ? { tone: "danger", label: t("dashboard.statusCritical") }
    : health.overall === "degraded" ? { tone: "warn", label: t("dashboard.statusDegraded") }
    : health.email.status !== "configured" ? { tone: "warn", label: t("dashboard.statusNoEmail") }
    : { tone: "ok", label: t("dashboard.statusOk") };

  const m = o?.metrics[metric];
  const joined = o?.metrics.members;
  const joinedPct = joined ? pctChange(joined.total, joined.prevTotal) : null;
  const liveDays = o ? Math.max(0, Math.floor((Date.now() - new Date(o.liveSince).getTime()) / 86_400_000)) : 0;
  const newest = o?.newest.users ?? [];

  return (
    <div className="dsh">
      <div className="pg-head dsh-head">
        <div className="dsh-head__main">
          <p className="pg-eyebrow dsh-eyebrow">{t("nav.overview")} · {today}</p>
          <h1 className="pg-title">{t("nav.dashboard")}</h1>
          {o && joined && (
            <p className="dsh-pulse">
              {isNew ? (
                <Trans t={t} i18nKey="dashboard.pulseNew" count={o.totalMembers}
                  values={{ members: fmt(o.totalMembers), days: liveDays }} components={{ b: <b /> }} />
              ) : joinedPct == null ? (
                <Trans t={t} i18nKey="dashboard.pulseFlat" count={joined.total}
                  values={{ n: fmt(joined.total), range, total: fmt(o.totalMembers) }} components={{ b: <b /> }} />
              ) : (
                <Trans t={t} i18nKey={joinedPct >= 0 ? "dashboard.pulseUp" : "dashboard.pulseDown"} count={joined.total}
                  values={{ n: fmt(joined.total), range, pct: Math.abs(joinedPct), total: fmt(o.totalMembers) }}
                  components={{ b: <b />, up: <b className="is-up" />, down: <b className="is-down" /> }} />
              )}
            </p>
          )}
        </div>
        <div className="dsh-head__tools">
          {status && <span className={`dsh-status dsh-status--${status.tone} dsh-status--pill`}><i />{status.label}</span>}
          <div className="dsh-range" role="tablist" aria-label={t("dashboard.range")}>
            {RANGES.map((r) => (
              <button key={r} type="button" role="tab" aria-selected={range === r} className={range === r ? "is-on" : ""} onClick={() => setRange(r)}>
                {t("dashboard.days", { n: r })}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading || !o || !m ? (
        <div className="dsh-card dsh-loading">{t("dashboard.loading")}</div>
      ) : (
        <>
          <div className="dsh-row dsh-row--top">
            <div className="dsh-side">
              <section className="dsh-card dsh-main">
                <div className="dsh-tabs" role="tablist">
                  {METRICS.map((id) => {
                    const x = o.metrics[id];
                    return (
                      <button key={id} type="button" role="tab" aria-selected={metric === id}
                        className={`dsh-tab${metric === id ? " is-on" : ""}`} style={{ "--mc": METRIC_COLOR[id] } as React.CSSProperties}
                        onClick={() => setMetric(id)}>
                        <span className="dsh-tab__label"><i />{t(`dashboard.metric.${id}`)}</span>
                        <span className="dsh-tab__value">{fmt(x.total)}</span>
                        <Delta cur={x.total} prev={x.prevTotal} />
                      </button>
                    );
                  })}
                </div>
                <div className="dsh-main__head">
                  <h3 className="dsh-card__title">{t(`dashboard.perDay.${metric}`)}</h3>
                  {isNew ? (
                    <span className="dsh-main__note">{t("dashboard.compareLater", { n: range })}</span>
                  ) : (
                    <div className="dsh-legend">
                      <span><i className="dsh-legend__bar" style={{ background: METRIC_COLOR[metric] }} />{t("dashboard.thisPeriod")}</span>
                      <span><i className="dsh-legend__dash" />{t("dashboard.prevPeriod")}</span>
                    </div>
                  )}
                </div>
                <div className="dsh-main__chart">
                  <PulseChart days={o.days} values={m.values} compare={m.compare} color={METRIC_COLOR[metric]}
                    unit={(n) => t(`dashboard.unit.${metric}`, { count: n, n: fmt(n) })}
                    showCompare={!isNew} height={isNew ? 150 : 220} />
                </div>
                {isNew && <Milestones m={o.setup.milestones} />}
                <div className="dsh-newest">
                  {newest.length > 0 && (
                    <div className="dsh-newest__faces">
                      {newest.map((u) => <Avatar key={u.id} user={u} size={30} className="dsh-newest__face" />)}
                    </div>
                  )}
                  <p className="dsh-newest__text">
                    {newest.length === 0 ? t("dashboard.nobodyJoined", { n: range })
                      : newest.length === 1 ? <Trans t={t} i18nKey="dashboard.joinedOne" values={{ a: newest[0]!.username }} components={{ b: <b /> }} />
                      : o.newest.count > 2
                        ? <Trans t={t} i18nKey="dashboard.joinedMany" count={o.newest.count - 2}
                            values={{ a: newest[0]!.username, b: newest[1]!.username }} components={{ b: <b /> }} />
                        : <Trans t={t} i18nKey="dashboard.joinedTwo" values={{ a: newest[0]!.username, b: newest[1]!.username }} components={{ b: <b /> }} />}
                  </p>
                  <Link to="/admin/users" className="dsh-link">{t("dashboard.allMembers")}<FontAwesomeIcon icon={faArrowRight} className="dsh-ic" /></Link>
                </div>
              </section>
              <TopArticles items={o.topArticles} />
            </div>

            <div className="dsh-side">
              {isNew ? (
                // A young site gets the checklist, but never loses a real problem to it.
                <>
                  <SetupCard steps={o.setup.steps} />
                  {o.attention.length > 0 && <AttentionCard items={o.attention} />}
                </>
              ) : <AttentionCard items={o.attention} />}
              <PlatformCard p={o.platform} health={health} healthError={healthError} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
