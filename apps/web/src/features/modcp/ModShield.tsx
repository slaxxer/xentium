import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { IconProp } from "@fortawesome/fontawesome-svg-core";
import { faCheckDouble, faFlag, faGear, faShield, faShieldHalved } from "@fortawesome/free-solid-svg-icons";
import { TokenIcon } from "../../components/TokenIcon";
import { FontAwesomeIcon } from "../../components/Icon";
import { api } from "../../lib/api";
import { timeAgo } from "../../lib/time";
import { useAuth } from "../../hooks/useAuth";
import { userCan } from "../../lib/authStore";
import { slotRegistry } from "../../plugins/slotRegistry";
import {
  caseIcon, caseSummary, caseTitle, isModerator, reportLine, severityLabel, targetTypeLabel, topReason, useModQueues, useOpenCases, useReportGroups,
  type ModSummary,
} from "./modData";
import { modStore, useModStore } from "./modSession";
import "./ModCanvas.scss";

/**
 * 2a — the moderation shield in the navbar, beside the notification bell. A red dot
 * when anything waits; the dropdown lists reports and security cases together, oldest
 * first, and a click starts working through them on the page itself (the pills).
 * Plugin sections (the forum's thread approvals) get their own group and open in a
 * dialog. Moderators only.
 */
/** `icon`: a glyph chosen in the layout editor (the `modTool` block), else the shield. */
export function ModShield({ icon }: { icon?: string } = {}) {
  const { t } = useTranslation("common", { keyPrefix: "modcanvas.shield" });
  const { user } = useAuth();
  const isMod = isModerator(user);
  const { menuOpen, pluginSection } = useModStore();
  const ref = useRef<HTMLDivElement>(null);

  const { data: summary } = useQuery<ModSummary>({
    queryKey: ["mod-summary"],
    queryFn: () => api.get("/moderation/summary"),
    enabled: isMod,
    refetchInterval: isMod ? 60_000 : false,
  });
  // The lists only while the menu is open; the dot needs the counts alone.
  const reports = useReportGroups(isMod && menuOpen);
  const cases = useOpenCases(isMod && menuOpen);
  // Plugin queues are polled all the time: their items ARE the count.
  const queues = useModQueues(isMod);

  const pluginSections = slotRegistry.getModCanvasSections();
  const [pluginCounts, setPluginCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!isMod) return;
    const load = () => pluginSections.forEach((s) => {
      s.badgeCountFn?.().then((n) => setPluginCounts((p) => ({ ...p, [s.id]: n }))).catch(() => {});
    });
    load();
    const iv = setInterval(load, 60_000);
    return () => clearInterval(iv);
    // Also on opening the menu and on closing a plugin's dialog: an approval made in
    // the dialog must not leave a stale count behind for a minute.
  }, [isMod, menuOpen, pluginSection]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) modStore.setMenu(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") modStore.setMenu(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [menuOpen]);

  if (!isMod) return null;

  const queueTotal = queues.reduce((n, q) => n + q.items.length, 0);
  const pluginTotal = Object.values(pluginCounts).reduce((a, b) => a + b, 0) + queueTotal;
  const waiting = (summary?.pendingReports ?? 0) + (summary?.openCases ?? 0) + pluginTotal;
  const reportRows = reports.data ?? [];
  const caseRows = cases.data ?? [];
  const loading = reports.isLoading || cases.isLoading;
  const isAdmin = userCan(user, "admin.access");
  const nothing = !loading && reportRows.length === 0 && caseRows.length === 0 && pluginTotal === 0;

  return (
    <div className="mcs" ref={ref}>
      <button type="button" className={`mcs__btn${menuOpen ? " is-open" : ""}`}
        aria-label={waiting ? t("labelWaiting", { count: waiting }) : t("label")} aria-expanded={menuOpen}
        title={t("title")} onClick={() => modStore.setMenu(!menuOpen)}>
        {icon ? <TokenIcon token={icon} /> : <FontAwesomeIcon icon={faShield} />}
        {waiting > 0 && <span className="mcs__dot" aria-hidden />}
      </button>

      {menuOpen && (
        <div className="mcs__menu xt-pop" role="menu">
          <div className="mcs__head">
            <span>{t("label")} {waiting > 0 && <em>({waiting})</em>}</span>
            <small>{t("oldest")}</small>
          </div>

          <div className="mcs__list">
            {loading ? (
              <div className="mcs__state">{t("loading")}</div>
            ) : nothing ? (
              <div className="mcs__state"><FontAwesomeIcon icon={faCheckDouble} /> {t("nothing")}</div>
            ) : (
              <>
                {reportRows.length > 0 && (
                  <>
                    <div className="mcs__group"><FontAwesomeIcon icon={faFlag} /> {t("reports")} <span>{reportRows.length}</span></div>
                    {reportRows.map((g, i) => {
                      const hot = g.reports.length > 1;
                      return (
                        <button key={g.key} type="button" role="menuitem" className={`mcs__row${hot ? " is-hot" : ""}`}
                          onClick={() => modStore.startReports(reportRows.map((r) => r.key), i)}>
                          <span className="mcs__ic"><FontAwesomeIcon icon={faFlag} /></span>
                          <span className="mcs__body">
                            <span className="mcs__title">
                              {topReason(g)}
                              {hot && <span className="mcs__tag">×{g.reports.length}</span>}
                            </span>
                            <span className="mcs__line">{reportLine(g, targetTypeLabel(g.targetType, g.targetId))}</span>
                            <span className="mcs__time">{timeAgo(g.firstReportedAt)}</span>
                          </span>
                        </button>
                      );
                    })}
                  </>
                )}

                {caseRows.length > 0 && (
                  <>
                    <div className="mcs__group"><FontAwesomeIcon icon={faShieldHalved} /> {t("security")} <span>{caseRows.length}</span></div>
                    {caseRows.map((c, i) => {
                      const hot = c.severity === "high";
                      return (
                        <button key={c.id} type="button" role="menuitem" className={`mcs__row${hot ? " is-hot" : ""}`}
                          onClick={() => modStore.startCases(caseRows.map((x) => x.id), i)}>
                          <span className="mcs__ic"><FontAwesomeIcon icon={caseIcon(c.type)} /></span>
                          <span className="mcs__body">
                            <span className="mcs__title">
                              {caseTitle(c.type)}
                              <span className={`mcs__tag${hot ? "" : " mcs__tag--neutral"}`}>{severityLabel(c.severity)}</span>
                            </span>
                            <span className="mcs__line">{caseSummary(c)}</span>
                            <span className="mcs__time">{timeAgo(c.createdAt)}</span>
                          </span>
                        </button>
                      );
                    })}
                  </>
                )}

                {queues.filter((q) => q.items.length > 0).map(({ queue, items }) => (
                  <div key={queue.id}>
                    <div className="mcs__group"><FontAwesomeIcon icon={queue.icon as IconProp} /> {queue.label} <span>{items.length}</span></div>
                    {items.map((item, i) => (
                      <button key={item.id} type="button" role="menuitem" className={`mcs__row${item.hot ? " is-hot" : ""}`}
                        onClick={() => modStore.startQueue(queue.id, items.map((x) => x.id), i)}>
                        <span className="mcs__ic"><FontAwesomeIcon icon={queue.icon as IconProp} /></span>
                        <span className="mcs__body">
                          <span className="mcs__title">{item.title}</span>
                          {item.line && <span className="mcs__line">{item.line}</span>}
                          <span className="mcs__time">{timeAgo(item.createdAt)}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                ))}

                {/* Legacy sections (`registerModCanvasSection`) still open in a dialog. */}
                {pluginSections.filter((s) => (pluginCounts[s.id] ?? 0) > 0).map((s) => (
                  <div key={s.id}>
                    <div className="mcs__group"><FontAwesomeIcon icon={s.icon as IconProp} /> {s.label} <span>{pluginCounts[s.id]}</span></div>
                    <button type="button" role="menuitem" className="mcs__row" onClick={() => modStore.openPlugin(s.id)}>
                      <span className="mcs__ic"><FontAwesomeIcon icon={s.icon as IconProp} /></span>
                      <span className="mcs__body">
                        <span className="mcs__title">{s.label}</span>
                        <span className="mcs__line">{t("pluginLine", { count: pluginCounts[s.id] })}</span>
                      </span>
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>

          {isAdmin && (
            <Link to="/admin/cases" className="mcs__foot" onClick={() => modStore.setMenu(false)}>
              <FontAwesomeIcon icon={faGear} />
              <span>{t("acpLink")}</span>
              <small>{t("acpLinkSub")}</small>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
