import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { IconProp } from "@fortawesome/fontawesome-svg-core";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "../../components/Icon";
import { useAuth } from "../../hooks/useAuth";
import { slotRegistry } from "../../plugins/slotRegistry";
import { isModerator, useModQueues, useOpenCases, useReportGroups } from "./modData";
import { QueuePill } from "./QueuePill";
import { modStore, useModStore } from "./modSession";
import { ReportPill } from "./ReportPill";
import { CasePill } from "./CasePill";
import "./ModCanvas.scss";

/** How long to wait for a reported item to appear on its page before giving up. */
const FIND_MS = 8000;

/**
 * ModCanvas v1 — moderation where the content is.
 *
 * The shield in the navbar (`ModShield`) lists what waits; picking an item starts a
 * SESSION here: the page it belongs to opens, the reported item is scrolled to and
 * marked, and an action pill sits at the bottom of the screen. The old slide-over
 * console is gone; user tools, the audit log and the case list live in the ACP.
 *
 * Pages opt their content in with `data-mod-target="<targetType>:<targetId>"` — the
 * same pair a report carries — so a plugin marks its own content the same way.
 */
export function ModCanvas() {
  const { user } = useAuth();
  const isMod = isModerator(user);
  const { session, pluginSection } = useModStore();
  const location = useLocation();
  const navigate = useNavigate();

  const reports = useReportGroups(isMod && session?.kind === "report");
  const cases = useOpenCases(isMod && session?.kind === "case");
  const queues = useModQueues(isMod);

  const group = session?.kind === "report" ? reports.data?.find((g) => g.key === session.keys[session.index]) ?? null : null;
  const kase = session?.kind === "case" ? cases.data?.find((c) => c.id === session.ids[session.index]) ?? null : null;
  const queue = session?.kind === "queue" ? queues.find((q) => q.queue.id === session.queueId) ?? null : null;
  const qitem = session?.kind === "queue" ? queue?.items.find((i) => i.id === session.ids[session.index]) ?? null : null;
  const loaded = session?.kind === "report" ? !!reports.data
    : session?.kind === "case" ? !!cases.data
    : session?.kind === "queue" ? !!queue && !queue.loading : false;
  const currentKey = session ? (session.kind === "report" ? session.keys[session.index] : session.ids[session.index]) : null;
  const current = group ?? kase ?? qitem;

  // `?modcanvas=…` opens the shield — how the ACP dashboard's "Review" sends a
  // moderator here. Removed again so a reload or a shared link does not reopen it.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (!params.has("modcanvas") || !isMod) return;
    modStore.setMenu(true);
    params.delete("modcanvas");
    const qs = params.toString();
    navigate({ pathname: location.pathname, search: qs ? `?${qs}` : "", hash: location.hash }, { replace: true });
  }, [location.search, location.pathname, location.hash, isMod, navigate]);

  // Shift+M opens and closes the shield, as it did the old panel.
  useEffect(() => {
    if (!isMod) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable)) return;
      if (e.shiftKey && e.key === "M") modStore.setMenu(!modStore.get().menuOpen);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMod]);

  // Something another moderator already handled drops out: step past it.
  useEffect(() => {
    if (session && loaded && !current) modStore.go(session.index + 1);
  }, [session, loaded, current]);

  // Each item opens its own page — once per item, so a case's account chips can then
  // move between the linked profiles without being pulled back.
  const navigatedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!currentKey || navigatedFor.current === currentKey) return;
    const target = group?.href ?? qitem?.href
      ?? (kase?.linkedUsers[0] ? `/u/${encodeURIComponent(kase.linkedUsers[0].username)}` : null);
    if (!current) return;
    navigatedFor.current = currentKey;
    // A link may carry a query (`?page=3` on a forum thread): compare the whole of it.
    if (target && target !== location.pathname + location.search) navigate(target);
  }, [currentKey, current, group, kase, qitem, location.pathname, location.search, navigate]);
  useEffect(() => { if (!session) navigatedFor.current = null; }, [session]);

  // Mark the reported item: scroll to it once and outline it until the session moves on.
  const markKey = group ? `${group.targetType}:${group.targetId}` : qitem?.markKey ?? null;
  const markLabel = group ? `Reported ×${group.reports.length}` : queue ? queue.queue.label : "";
  useEffect(() => {
    if (!markKey) return;
    let el: HTMLElement | null = null;
    const apply = () => {
      const found = document.querySelector<HTMLElement>(`[data-mod-target="${CSS.escape(markKey)}"]`);
      if (!found) return false;
      el = found;
      el.setAttribute("data-mc-reported", markLabel);
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      return true;
    };
    if (apply()) return () => el?.removeAttribute("data-mc-reported");
    // Not rendered yet (the page is still loading): watch for it, for a while.
    const obs = new MutationObserver(() => { if (apply()) obs.disconnect(); });
    obs.observe(document.body, { childList: true, subtree: true });
    const stop = setTimeout(() => obs.disconnect(), FIND_MS);
    return () => { obs.disconnect(); clearTimeout(stop); el?.removeAttribute("data-mc-reported"); };
  }, [markKey, markLabel, location.pathname]);

  // Room at the bottom of the page, so the pill never covers the last thing on it.
  const pillShown = !!current;
  useEffect(() => {
    document.body.classList.toggle("has-modpill", pillShown);
    return () => document.body.classList.remove("has-modpill");
  }, [pillShown]);

  if (!isMod) return null;

  const plugin = pluginSection ? slotRegistry.getModCanvasSections().find((s) => s.id === pluginSection) : null;
  const contextUsername = decodeURIComponent(location.pathname.match(/^\/u\/([^/]+)/)?.[1] ?? "");

  return (
    <>
      {session?.kind === "report" && group && (
        <div className="mcp-dock"><ReportPill key={group.key} group={group} position={session.index} total={session.keys.length} /></div>
      )}
      {session?.kind === "case" && kase && (
        <div className="mcp-dock"><CasePill key={kase.id} c={kase} position={session.index} total={session.ids.length} /></div>
      )}

      {session?.kind === "queue" && queue && qitem && (
        <div className="mcp-dock"><QueuePill key={qitem.id} queue={queue.queue} item={qitem} position={session.index} total={session.ids.length} /></div>
      )}

      {plugin && (
        <div className="mcd-scrim" onMouseDown={() => modStore.openPlugin(null)}>
          <div className="mcd" role="dialog" aria-modal="true" aria-label={plugin.label} onMouseDown={(e) => e.stopPropagation()}>
            <header className="mcd__head">
              <FontAwesomeIcon icon={plugin.icon as IconProp} />
              <h2>{plugin.label}</h2>
              <button type="button" className="mcp__round" aria-label="Close" onClick={() => modStore.openPlugin(null)}>
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </header>
            <div className="mcd__body">
              <plugin.component onNav={() => modStore.openPlugin(null)} contextUsername={contextUsername} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
