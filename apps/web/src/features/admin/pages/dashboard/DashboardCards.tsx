import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faArrowRight, faBug, faCheck, faCircleCheck, faClockRotateLeft, faCodeBranch, faEnvelope, faFlag, faKey,
  faNewspaper, faPlus, faPuzzlePiece, faShieldHalved,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "../../../../components/Icon";
import { timeAgo } from "../../../../lib/time";
import { compact, pctChange, type AttentionItem, type Health, type Overview } from "./dashboardModel";
import { SETUP_STEP_LINK } from "../../../../lib/setupSteps";

// ── Needs attention ──────────────────────────────────────────────────────────

type Tone = "danger" | "warn" | "accent" | "accent2";
interface Row { icon: IconDefinition; tone: Tone; title: string; meta: string; action: string; to: string }

function useAttentionRows(items: AttentionItem[]): Row[] {
  const { t } = useTranslation("acp");
  return items.map((x): Row => {
    switch (x.kind) {
      case "reports":
        return { icon: faFlag, tone: "danger", to: "/?modcanvas=reports", action: t("dashboard.act.review"),
          title: t("dashboard.att.reports", { count: x.count }), meta: t("dashboard.att.reportsMeta", { ago: timeAgo(x.oldestAt) }) };
      case "coreUpdate": {
        const urgent = x.severity === "security" || x.severity === "critical";
        return { icon: urgent ? faShieldHalved : faCodeBranch, tone: urgent ? "warn" : "accent", to: "/admin/updates", action: t("dashboard.act.update"),
          title: urgent ? t("dashboard.att.coreSecurity", { version: x.to }) : t("dashboard.att.core", { version: x.to }),
          meta: `${x.from} → ${x.to}` };
      }
      case "pluginUpdate":
        return { icon: x.critical ? faShieldHalved : faPuzzlePiece, tone: x.critical ? "warn" : "accent", to: "/admin/updates", action: t("dashboard.act.update"),
          title: x.critical ? t("dashboard.att.pluginSecurity", { name: x.name }) : t("dashboard.att.plugin", { name: x.name }),
          meta: [x.from ? `${x.from} → ${x.to}` : x.to, x.critical ? t("dashboard.att.markedCritical") : null].filter(Boolean).join(" · ") };
      case "license":
        return { icon: faKey, tone: x.expired ? "danger" : "accent", to: "/admin/license", action: t("dashboard.act.manage"),
          title: x.expired ? t("dashboard.att.licenseExpired") : t("dashboard.att.licenseStale", { count: x.daysLeft ?? 0 }),
          meta: x.domain ?? t("dashboard.att.licenseMeta") };
      case "errors":
        return { icon: faBug, tone: "accent2", to: "/admin/error-log", action: t("dashboard.act.openLog"),
          title: t("dashboard.att.errors", { count: x.count }),
          meta: x.codes.map((c) => (c.count > 1 ? `${c.code} ×${c.count}` : c.code)).join(" · ") };
      case "tasks":
        return { icon: faClockRotateLeft, tone: "warn", to: "/admin/scheduled-tasks", action: t("dashboard.act.open"),
          title: t("dashboard.att.tasks", { count: x.failing }), meta: t("dashboard.att.tasksMeta") };
      case "email":
        return { icon: faEnvelope, tone: "warn", to: "/admin/email", action: t("dashboard.act.setUp"),
          title: t("dashboard.att.email"), meta: t("dashboard.att.emailMeta") };
    }
  });
}

export function AttentionCard({ items }: { items: AttentionItem[] }) {
  const { t } = useTranslation("acp");
  const rows = useAttentionRows(items);
  return (
    <section className="dsh-card dsh-attn">
      <div className="dsh-card__head">
        <h3 className="dsh-card__title">{t("dashboard.attention")}</h3>
        {rows.length > 0 && <span className="dsh-count">{rows.length}</span>}
      </div>
      {rows.length === 0 ? (
        <div className="dsh-attn__clear">
          <FontAwesomeIcon icon={faCircleCheck} className="dsh-ic" />
          <p>{t("dashboard.allClear")}</p>
        </div>
      ) : (
        <div className="dsh-attn__list">
          {rows.map((r, i) => (
            <div key={i} className="dsh-attn__row">
              <span className={`dsh-tile dsh-tile--${r.tone}`}><FontAwesomeIcon icon={r.icon} className="dsh-ic" /></span>
              <div className="dsh-attn__main">
                <p className="dsh-attn__title">{r.title}</p>
                {r.meta && <p className="dsh-attn__meta">{r.meta}</p>}
              </div>
              <Link to={r.to} className="dsh-btn">{r.action}</Link>
            </div>
          ))}
        </div>
      )}
      {rows.length > 0 && (
        <div className="dsh-attn__foot"><FontAwesomeIcon icon={faCircleCheck} className="dsh-ic" />{t("dashboard.elseNormal")}</div>
      )}
    </section>
  );
}

// ── Setup (a young site) ─────────────────────────────────────────────────────


export function SetupCard({ steps }: { steps: Overview["setup"]["steps"] }) {
  const { t } = useTranslation("acp");
  const next = steps.findIndex((s) => !s.done);
  const done = steps.filter((s) => s.done).length;
  return (
    <section className="dsh-card dsh-setup">
      <div className="dsh-setup__head">
        <div className="dsh-card__head">
          <h3 className="dsh-card__title">{t("dashboard.setupTitle")}</h3>
          <span className="dsh-setup__n">{t("dashboard.setupCount", { done, total: steps.length })}</span>
        </div>
        <div className="dsh-setup__bar" aria-hidden>
          {steps.map((s) => <i key={s.key} className={s.done ? "is-done" : ""} />)}
        </div>
      </div>
      <div className="dsh-setup__list">
        {steps.map((s, i) => {
          const isNext = i === next;
          const to = SETUP_STEP_LINK[s.key];
          const body = (
            <>
              <span className={`dsh-step__dot${s.done ? " is-done" : isNext ? " is-next" : ""}`}>
                {s.done && <FontAwesomeIcon icon={faCheck} className="dsh-ic" />}
              </span>
              <div className="dsh-step__main">
                <p className="dsh-step__title">{t(`dashboard.step.${s.key}`)}</p>
                {(isNext || (s.done && s.detail)) && (
                  <p className="dsh-step__meta">{s.done ? s.detail : t(`dashboard.step.${s.key}Hint`)}</p>
                )}
              </div>
              {isNext && <span className="dsh-btn dsh-btn--primary">{t("dashboard.act.setUp")}</span>}
              {!s.done && !isNext && <FontAwesomeIcon icon={faArrowRight} className="dsh-ic dsh-step__go" />}
            </>
          );
          const cls = `dsh-step${s.done ? " is-done" : ""}${isNext ? " is-next" : ""}`;
          return !s.done && to
            ? <Link key={s.key} to={to} className={cls}>{body}</Link>
            : <div key={s.key} className={cls}>{body}</div>;
        })}
      </div>
    </section>
  );
}

export function Milestones({ m }: { m: Overview["setup"]["milestones"] }) {
  const { t } = useTranslation("acp");
  const rows: Array<[string, number, number, string]> = [
    [t("dashboard.ms.members"), m.members, 10, "var(--c-accent)"],
    [t("dashboard.ms.article"), m.articles, 1, "var(--c-warn)"],
    [t("dashboard.ms.comment"), m.comments, 1, "var(--c-success)"],
    [t("dashboard.ms.week"), m.activeDays, 7, "var(--c-accent2)"],
  ];
  return (
    <div className="dsh-ms">
      {rows.map(([label, c, total, color]) => (
        <div key={label} className="dsh-ms__item">
          <div className="dsh-ms__row"><span>{label}</span><span className="dsh-ms__n">{Math.min(c, total)} / {total}</span></div>
          <div className="dsh-ms__bar"><i style={{ width: `${Math.min(100, (c / total) * 100)}%`, background: color }} /></div>
        </div>
      ))}
    </div>
  );
}

// ── Top articles ─────────────────────────────────────────────────────────────

export function TopArticles({ items }: { items: Overview["topArticles"] }) {
  const { t, i18n } = useTranslation("acp");
  const top = items[0]?.views || 1;
  return (
    <section className="dsh-card dsh-top">
      <div className="dsh-card__head dsh-card__head--split">
        <div>
          <h3 className="dsh-card__title">{t("dashboard.topArticles")}</h3>
          <p className="dsh-card__sub">{t("dashboard.topArticlesSub")}</p>
        </div>
        <Link to="/admin/articles" className="dsh-link">{t("dashboard.allArticles")}</Link>
      </div>
      {items.length === 0 ? (
        <div className="dsh-empty">
          <span className="dsh-tile dsh-tile--warn"><FontAwesomeIcon icon={faNewspaper} className="dsh-ic" /></span>
          <div>
            <p className="dsh-empty__title">{t("dashboard.noArticles")}</p>
            <p className="dsh-empty__text">{t("dashboard.noArticlesText")}</p>
          </div>
          <Link to="/articles/new" className="dsh-btn dsh-btn--primary"><FontAwesomeIcon icon={faPlus} className="dsh-ic" />{t("dashboard.writeFirst")}</Link>
        </div>
      ) : (
        <div className="dsh-top__list">
          {items.map((a, i) => (
            <Link key={a.id} to={`/articles/${a.slug}`} className="dsh-top__row">
              <span className="dsh-top__rank">{i + 1}</span>
              <span className="dsh-top__main">
                <span className="dsh-top__title">{a.title}</span>
                <span className="dsh-top__meta">{[a.category, a.author].filter(Boolean).join(" · ")}</span>
              </span>
              <span className="dsh-top__bar" aria-hidden><i style={{ width: `${Math.round((a.views / top) * 100)}%` }} /></span>
              <span className="dsh-top__views">{compact(a.views, i18n.language)}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Platform ─────────────────────────────────────────────────────────────────

type Status = "ok" | "warn" | "danger" | "muted" | "accent";

export function PlatformCard({ p, health, healthError }: { p: Overview["platform"]; health: Health | undefined; healthError: boolean }) {
  const { t } = useTranslation("acp");
  const lic = p.license;
  const rows: Array<{ icon: IconDefinition; label: string; detail: string; status: string; tone: Status; strip?: string[] }> = [
    {
      icon: faCodeBranch, label: t("dashboard.pf.core"), detail: `Xentium ${p.version}`,
      status: p.coreUpdate ? t("dashboard.pf.coreUpdate", { version: p.coreUpdate.to }) : t("dashboard.pf.upToDate"),
      tone: p.coreUpdate ? "warn" : "ok",
    },
    {
      icon: faPuzzlePiece, label: t("dashboard.pf.plugins"),
      detail: p.plugins.installed ? t("dashboard.pf.installed", { count: p.plugins.installed }) : t("dashboard.pf.noneInstalled"),
      status: p.plugins.updates ? t("dashboard.pf.updates", { count: p.plugins.updates }) : p.plugins.installed ? t("dashboard.pf.upToDate") : t("dashboard.pf.browse"),
      tone: p.plugins.updates ? (p.plugins.critical ? "danger" : "warn") : p.plugins.installed ? "ok" : "accent",
    },
    {
      icon: faKey, label: t("dashboard.pf.license"),
      detail: lic.grants > 0
        ? [t("dashboard.pf.grants", { count: lic.grants }), lic.domain].filter(Boolean).join(" · ")
        : lic.paidPlugins > 0 ? t("dashboard.pf.paidNoLicense", { count: lic.paidPlugins }) : t("dashboard.pf.coreFree"),
      status: lic.expired ? t("dashboard.pf.expired") : lic.expiringSoon ? t("dashboard.pf.needsRefresh")
        : lic.grants > 0 ? t("dashboard.pf.active") : lic.paidPlugins > 0 ? t("dashboard.pf.missing") : t("dashboard.pf.notNeeded"),
      tone: lic.expired ? "danger" : lic.expiringSoon || (lic.grants === 0 && lic.paidPlugins > 0) ? "warn" : lic.grants > 0 ? "ok" : "muted",
    },
    {
      icon: faClockRotateLeft, label: t("dashboard.pf.tasks"),
      detail: p.tasks.lastRunAt
        ? t("dashboard.pf.tasksDetail", { count: p.tasks.enabled, ago: timeAgo(p.tasks.lastRunAt) })
        : t("dashboard.pf.tasksNone", { count: p.tasks.enabled }),
      status: p.tasks.failing ? t("dashboard.pf.failing", { count: p.tasks.failing }) : t("dashboard.pf.passing"),
      tone: p.tasks.failing ? "danger" : "ok",
      strip: p.tasks.runs,
    },
    {
      icon: faBug, label: t("dashboard.pf.errors"), detail: t("dashboard.pf.last24h"),
      status: p.errors24h ? t("dashboard.pf.errorCount", { count: p.errors24h }) : t("dashboard.pf.noErrors"),
      tone: p.errors24h ? "warn" : "ok",
    },
  ];

  const svc: Array<[string, Status, string]> = health ? [
    [t("dashboard.svc.db"), health.db.status === "ok" ? "ok" : "danger", health.db.status === "ok" ? t("dashboard.svc.ms", { ms: health.db.latencyMs }) : ""],
    [t("dashboard.svc.redis"), health.redis.status === "ok" ? "ok" : "danger", health.redis.status === "ok" ? t("dashboard.svc.ms", { ms: health.redis.latencyMs }) : ""],
    [t("dashboard.svc.queue"), health.queue.status === "ok" ? "ok" : "danger", ""],
    [t("dashboard.svc.storage"), health.storage.status !== "ok" ? "danger" : health.storage.writeable ? "ok" : "warn", health.storage.writeable ? "" : t("dashboard.svc.readOnly")],
    [t("dashboard.svc.email"), health.email.status === "configured" ? "ok" : health.email.status === "unconfigured" ? "warn" : "danger",
      health.email.status === "unconfigured" ? t("dashboard.svc.notSetUp") : ""],
  ] : [];

  return (
    <section className="dsh-card dsh-pf">
      <div className="dsh-card__head dsh-card__head--split">
        <div>
          <h3 className="dsh-card__title">{t("dashboard.platform")}</h3>
          <p className="dsh-card__sub">Xentium {p.version}</p>
        </div>
        <Link to="/admin/about" className="dsh-link">{t("dashboard.about")}</Link>
      </div>
      <div className="dsh-pf__list">
        {rows.map((r) => (
          <div key={r.label} className="dsh-pf__row">
            <span className="dsh-tile dsh-tile--muted"><FontAwesomeIcon icon={r.icon} className="dsh-ic" /></span>
            <div className="dsh-pf__main">
              <p className="dsh-pf__label">{r.label}</p>
              <p className="dsh-pf__detail">{r.detail}</p>
              {r.strip && r.strip.length > 0 && (
                <span className="dsh-runs" title={t("dashboard.pf.lastRuns", { count: r.strip.length })}>
                  {r.strip.map((s, i) => <i key={i} className={`is-${s}`} />)}
                </span>
              )}
            </div>
            <span className={`dsh-status dsh-status--${r.tone}`}><i />{r.status}</span>
          </div>
        ))}
      </div>
      <div className="dsh-svc">
        {healthError && <span className="dsh-svc__pill dsh-status--danger"><i />{t("dashboard.svc.unreachable")}</span>}
        {svc.map(([label, tone, note]) => (
          <span key={label} className={`dsh-svc__pill dsh-status--${tone}`}><i />{label}{note && <b>{note}</b>}</span>
        ))}
      </div>
    </section>
  );
}

/** The header's delta: "▲ 26%", or nothing to compare against yet. */
export function Delta({ cur, prev }: { cur: number; prev: number }) {
  const { t } = useTranslation("acp");
  const pct = pctChange(cur, prev);
  if (pct == null) return <span className="dsh-delta is-none">{t("dashboard.noEarlier")}</span>;
  return (
    <span className={`dsh-delta ${pct >= 0 ? "is-up" : "is-down"}`}>
      <b>{pct >= 0 ? "▲" : "▼"} {Math.abs(pct)}%</b> {t("dashboard.vs", { n: prev })}
    </span>
  );
}
