import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { IconProp } from "@fortawesome/fontawesome-svg-core";
import { faCheckDouble, faFlag, faGear, faShield } from "@fortawesome/free-solid-svg-icons";
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
 * when anything waits; the dropdown is ONE feed, newest first: reports, security cases
 * and plugin queues (thread approvals, support tickets) mixed by when they came in,
 * each row labelled with what it is. A click starts working through that kind on the
 * page itself (the pills), in the same order. Legacy plugin sections (no time) close
 * the list and open in a dialog. Moderators only.
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

  // One feed, newest first. Each kind's own list keeps the same order, so the pill's
  // "next" walks the rows the moderator sees.
  const newest = <T,>(xs: T[], at: (x: T) => string) => [...xs].sort((a, b) => at(b).localeCompare(at(a)));
  const reportsByNew = newest(reportRows, (g) => g.latestAt ?? g.firstReportedAt);
  const casesByNew = newest(caseRows, (c) => c.createdAt);
  type Row = { key: string; at: string; kind: string; icon: IconProp; title: ReactNode; tag?: ReactNode; line?: ReactNode; hot: boolean; open: () => void };
  const feed: Row[] = [
    ...reportsByNew.map((g, i): Row => ({
      key: `r:${g.key}`, at: g.latestAt ?? g.firstReportedAt, kind: t("reports"), icon: faFlag, hot: g.reports.length > 1,
      title: topReason(g), tag: g.reports.length > 1 ? <span className="mcs__tag">×{g.reports.length}</span> : undefined,
      line: reportLine(g, targetTypeLabel(g.targetType, g.targetId)),
      open: () => modStore.startReports(reportsByNew.map((r) => r.key), i),
    })),
    ...casesByNew.map((c, i): Row => ({
      key: `c:${c.id}`, at: c.createdAt, kind: t("security"), icon: caseIcon(c.type) as IconProp, hot: c.severity === "high",
      title: caseTitle(c.type), tag: <span className={`mcs__tag${c.severity === "high" ? "" : " mcs__tag--neutral"}`}>{severityLabel(c.severity)}</span>,
      line: caseSummary(c),
      open: () => modStore.startCases(casesByNew.map((x) => x.id), i),
    })),
    ...queues.flatMap(({ queue, items }) => {
      const byNew = newest(items, (x) => x.createdAt);
      return byNew.map((item, i): Row => ({
        key: `q:${queue.id}:${item.id}`, at: item.createdAt, kind: queue.label, icon: queue.icon as IconProp, hot: !!item.hot,
        title: item.title, line: item.line,
        open: () => modStore.startQueue(queue.id, byNew.map((x) => x.id), i),
      }));
    }),
  ].sort((a, b) => b.at.localeCompare(a.at));

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
            <small>{t("newest")}</small>
          </div>

          <div className="mcs__list">
            {loading ? (
              <div className="mcs__state">{t("loading")}</div>
            ) : nothing ? (
              <div className="mcs__state"><FontAwesomeIcon icon={faCheckDouble} /> {t("nothing")}</div>
            ) : (
              <>
                {feed.map((row) => (
                  <button key={row.key} type="button" role="menuitem" className={`mcs__row${row.hot ? " is-hot" : ""}`} onClick={row.open}>
                    <span className="mcs__ic"><FontAwesomeIcon icon={row.icon} /></span>
                    <span className="mcs__body">
                      <span className="mcs__title">{row.title}{row.tag}</span>
                      {row.line && <span className="mcs__line">{row.line}</span>}
                      <span className="mcs__time">{row.kind} · {timeAgo(row.at)}</span>
                    </span>
                  </button>
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
