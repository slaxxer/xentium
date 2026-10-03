import { useTranslation } from "react-i18next";
import { faCheck, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "../../../../components/Icon";
import { timeAgo } from "../../../../lib/time";
import { daysSince, type ErrorGroup, type Severity } from "./errorLogModel";

export function SeverityPill({ severity }: { severity: Severity }) {
  const { t } = useTranslation("acp");
  return <span className={`el-sev el-sev--${severity}`}><span className="el-sev__dot" />{t(`errorLog.sev.${severity}`)}</span>;
}

export function MethodChip({ method }: { method: string | null }) {
  return method ? <span className="el-method">{method}</span> : null;
}

export function ResolvedPill() {
  const { t } = useTranslation("acp");
  return <span className="el-resolved"><FontAwesomeIcon icon={faCheck} className="el-ic" /> {t("errorLog.resolved")}</span>;
}

/** Seven days of occurrences; today in the severity's colour. */
function Spark({ days, severity }: { days: number[]; severity: Severity }) {
  const peak = Math.max(1, ...days);
  return (
    <span className="el-spark" aria-hidden>
      {days.map((n, i) => (
        <span key={i} className={i === days.length - 1 ? `is-today el-spark--${severity}` : ""}
          style={{ height: `${Math.max(n ? 3 : 1, (n / peak) * 20)}px` }} />
      ))}
    </span>
  );
}

export function GroupTable({ loading, items, selectedKey, dimResolved, onSelect, onReset }: {
  loading: boolean;
  items: ErrorGroup[];
  selectedKey: string | null;
  dimResolved: boolean;
  onSelect: (key: string) => void;
  onReset?: () => void;
}) {
  const { t, i18n } = useTranslation("acp");
  return (
    <div className="el-card el-table">
      <div className="el-row el-row--head">
        <span>{t("errorLog.col.severity")}</span>
        <span>{t("errorLog.col.error")}</span>
        <span>{t("errorLog.col.context")}</span>
        <span>{t("errorLog.col.count")}</span>
        <span>{t("errorLog.col.last")}</span>
        <span />
      </div>

      {loading && <div className="el-empty">{t("errorLog.loading")}</div>}
      {!loading && items.length === 0 && (
        <div className="el-empty">
          <p>{onReset ? t("errorLog.emptyFiltered") : t("errorLog.empty")}</p>
          {onReset && <button type="button" className="el-link" onClick={onReset}>{t("errorLog.resetFilters")}</button>}
        </div>
      )}

      {items.map((g) => {
        const on = g.key === selectedKey;
        const others = Math.max(0, g.routeCount - 1);
        const since = daysSince(g.firstSeen);
        return (
          <button key={g.key} type="button" aria-expanded={on}
            className={`el-row${on ? " is-on" : ""}${g.resolved && dimResolved ? " is-dim" : ""}`}
            onClick={() => onSelect(g.key)}>
            <span><SeverityPill severity={g.severity} /></span>
            <span className="el-cell">
              <span className="el-cell__main">
                <span className="el-msg" title={g.message}>{g.message}</span>
                {g.resolved && <ResolvedPill />}
              </span>
              <span className="el-cell__sub"><code className="el-code">{g.code}</code> · {g.domain}</span>
            </span>
            <span className="el-cell">
              <span className="el-cell__main">
                {g.topRoute ? <><MethodChip method={g.topRoute.method} /><code className="el-url" title={g.topRoute.url}>{g.topRoute.url}</code></> : <span className="el-cell__sub">—</span>}
              </span>
              <span className="el-cell__sub">
                {[
                  others ? t("errorLog.moreRoutes", { count: others }) : null,
                  g.userCount ? t("errorLog.users", { count: g.userCount }) : t("errorLog.noUsers"),
                ].filter(Boolean).join(" · ")}
              </span>
            </span>
            <span className="el-count">
              <span>{g.count.toLocaleString(i18n.language)}</span>
              <Spark days={g.spark7d} severity={g.severity} />
            </span>
            <span className="el-cell">
              <span className="el-when">{timeAgo(g.lastSeen)}</span>
              <span className="el-cell__sub">{since ? t("errorLog.sinceDays", { count: since }) : t("errorLog.sinceToday")}</span>
            </span>
            <FontAwesomeIcon icon={faChevronRight} className="el-ic el-chev" />
          </button>
        );
      })}
    </div>
  );
}
