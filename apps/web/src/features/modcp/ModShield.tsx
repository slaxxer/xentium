import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { IconProp } from "@fortawesome/fontawesome-svg-core";
import { faCheckDouble, faFlag, faGear, faShield, faShieldHalved } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "../../components/Icon";
import { api } from "../../lib/api";
import { timeAgo } from "../../lib/time";
import { useAuth } from "../../hooks/useAuth";
import { userCan } from "../../lib/authStore";
import { slotRegistry } from "../../plugins/slotRegistry";
import { typeLabel } from "./modTemplates";
import {
  caseIcon, caseSummary, caseTitle, isModerator, reportLine, topReason, useModQueues, useOpenCases, useReportGroups,
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
export function ModShield() {
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
        aria-label={waiting ? `Moderation, ${waiting} waiting` : "Moderation"} aria-expanded={menuOpen}
        title="Moderation (Shift+M)" onClick={() => modStore.setMenu(!menuOpen)}>
        <FontAwesomeIcon icon={faShield} />
        {waiting > 0 && <span className="mcs__dot" aria-hidden />}
      </button>

      {menuOpen && (
        <div className="mcs__menu" role="menu">
          <div className="mcs__head">
            <span>Moderation {waiting > 0 && <em>({waiting})</em>}</span>
            <small>Oldest waits longest</small>
          </div>

          <div className="mcs__list">
            {loading ? (
              <div className="mcs__state">Loading…</div>
            ) : nothing ? (
              <div className="mcs__state"><FontAwesomeIcon icon={faCheckDouble} /> Nothing is waiting.</div>
            ) : (
              <>
                {reportRows.length > 0 && (
                  <>
                    <div className="mcs__group"><FontAwesomeIcon icon={faFlag} /> Reports <span>{reportRows.length}</span></div>
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
                            <span className="mcs__line">{reportLine(g, typeLabel(g.targetType, g.targetId))}</span>
                            <span className="mcs__time">{timeAgo(g.firstReportedAt)}</span>
                          </span>
                        </button>
                      );
                    })}
                  </>
                )}

                {caseRows.length > 0 && (
                  <>
                    <div className="mcs__group"><FontAwesomeIcon icon={faShieldHalved} /> Security <span>{caseRows.length}</span></div>
                    {caseRows.map((c, i) => {
                      const hot = c.severity === "high";
                      return (
                        <button key={c.id} type="button" role="menuitem" className={`mcs__row${hot ? " is-hot" : ""}`}
                          onClick={() => modStore.startCases(caseRows.map((x) => x.id), i)}>
                          <span className="mcs__ic"><FontAwesomeIcon icon={caseIcon(c.type)} /></span>
                          <span className="mcs__body">
                            <span className="mcs__title">
                              {caseTitle(c.type)}
                              <span className={`mcs__tag${hot ? "" : " mcs__tag--neutral"}`}>{c.severity}</span>
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
                        <span className="mcs__line">{pluginCounts[s.id]} waiting · open to review</span>
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
              <span>Moderation in the ACP</span>
              <small>cases, users, log</small>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
