import { useTranslation } from "react-i18next";
import { SEVERITIES, bucketLabel, bucketTotal, type Range, type Severity, type StatsResponse } from "./errorLogModel";

/** Severity tiles (click = filter) and the stacked activity chart. */
export function Overview({ stats, range, onRange, severity, onSeverity }: {
  stats: StatsResponse | undefined;
  range: Range;
  onRange: (r: Range) => void;
  severity: Severity | null;
  onSeverity: (s: Severity) => void;
}) {
  const { t, i18n } = useTranslation("acp");
  const buckets = stats?.buckets ?? [];
  const inRange = (s: Severity) => buckets.reduce((a, b) => a + b[s], 0);
  const events = buckets.reduce((a, b) => a + bucketTotal(b, severity), 0);
  const peak = Math.max(1, ...buckets.map((b) => bucketTotal(b, severity)));
  // Bottom to top: the worst sits on the baseline, where the eye starts.
  const stack: Severity[] = severity ? [severity] : ["critical", "error", "warn", "info"];

  return (
    <div className="el-overview">
      <div className="el-tiles">
        {SEVERITIES.map((s) => {
          const n = inRange(s);
          const open = stats?.openGroups[s] ?? 0;
          const on = severity === s;
          return (
            <button key={s} type="button" className={`el-tile${on ? " is-on" : ""}`} aria-pressed={on} onClick={() => onSeverity(s)}>
              <span className="el-tile__row">
                <span className={`el-dot el-dot--${s}`} />
                <span className="el-tile__label">{t(`errorLog.sev.${s}`)}</span>
                {on && <span className="el-tile__active">{t("errorLog.filterActive")}</span>}
              </span>
              <span className={`el-tile__value${n ? "" : " is-zero"}`}>{stats ? n.toLocaleString(i18n.language) : "–"}</span>
              <span className="el-tile__sub">{open ? t("errorLog.openGroups", { count: open }) : t("errorLog.noOpenGroups")}</span>
            </button>
          );
        })}
      </div>

      <section className="el-card el-chart">
        <div className="el-chart__head">
          <div>
            <h2 className="el-chart__title">{t("errorLog.activity")}</h2>
            <p className="el-chart__sub">
              {t(range === "7d" ? "errorLog.events7d" : "errorLog.events24h", { count: events })}
              {severity && <> · {t("errorLog.onlySeverity", { severity: t(`errorLog.sev.${severity}`) })}</>}
            </p>
          </div>
          <div className="el-range" role="tablist">
            {(["24h", "7d"] as Range[]).map((r) => (
              <button key={r} type="button" role="tab" aria-selected={range === r} className={range === r ? "is-on" : ""} onClick={() => onRange(r)}>
                {t(`errorLog.range.${r}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="el-bars" role="img" aria-label={t(range === "7d" ? "errorLog.events7d" : "errorLog.events24h", { count: events })}>
          {buckets.map((b) => {
            const total = bucketTotal(b, severity);
            const title = [
              bucketLabel(b.t, range, i18n.language),
              t("errorLog.eventsCount", { count: total }),
              !severity && b.critical ? t("errorLog.criticalCount", { count: b.critical }) : null,
            ].filter(Boolean).join(" · ");
            return (
              <div key={b.t} className="el-bar" title={title}>
                <div className="el-bar__stack" style={{ height: `${(total / peak) * 100}%` }}>
                  {stack.map((s) => b[s] > 0 && (
                    <span key={s} className={`el-bar__seg el-bar__seg--${s}`} style={{ flexGrow: b[s] }} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="el-axis">
          {range === "7d"
            ? <><span>{t("errorLog.axis.d7")}</span><span>{t("errorLog.axis.d3")}</span><span>{t("errorLog.axis.today")}</span></>
            : <><span>{t("errorLog.axis.h24")}</span><span>{t("errorLog.axis.h12")}</span><span>{t("errorLog.axis.now")}</span></>}
        </div>
      </section>
    </div>
  );
}
