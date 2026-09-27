import { useState, useRef, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FontAwesomeIcon } from "../../components/Icon";
import type { IconProp } from "@fortawesome/fontawesome-svg-core";
import {
  faShield, faXmark, faFlag, faClipboardList, faGear,
  faMoon, faSun, faMagnifyingGlass, faCheckDouble, faUser, faFolderOpen,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../../lib/api";
import { timeAgo } from "../../lib/time";
import { useAuth } from "../../hooks/useAuth";
import { useTheme } from "../../hooks/useTheme";
import "./ModCanvas.scss";
import { slotRegistry } from "../../plugins/slotRegistry";
import { UsersSection } from "./UsersSection";
import { CasesSection } from "./CasesSection";
import { ReportsInspector } from "./ReportsInspector";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Summary  { pendingReports: number; openCases: number; activeWarnings: number; activeBans: number }
interface LogEntry {
  id: string; actorId: string | null; actorType: string; action: string;
  targetType: string | null; targetId: string | null; reason: string | null; createdAt: string;
  actorUsername: string | null; targetUsername: string | null; targetDetail: string | null;
}
interface Paged<T> { data: T[]; meta: { total: number } }

type Section = "reports" | "cases" | "users" | "log" | string;

const MOD_KEYS = new Set(["admin", "supermod", "moderator"]);

const ACTION_LABELS: Record<string, string> = {
  "ban.issued":                    "Issued ban",
  "ban.lifted":                    "Lifted ban",
  "ban.expired":                   "Ban expired",
  "ban.auto_issued":               "Auto-ban (threshold)",
  "case.ban_all":                  "Banned all (case)",
  "warning.issued":                "Issued warning",
  "warning.pardoned":              "Pardoned warning",
  "warning.expired":               "Warning expired",
  "report.resolved":               "Resolved report",
  "report.dismissed":              "Dismissed report",
  "report.reviewed":               "Reviewed report",
  "report.updated":                "Updated report",
  "report.reopened":               "Reopened report",
  "report.claimed":                "Claimed report",
  "report.unclaimed":              "Released report",
  "article.deleted":               "Removed article",
  "case.assigned":                 "Assigned case",
  "case.unassigned":               "Unassigned case",
  "comment.deleted":               "Deleted comment",
  "profile_comment.deleted":       "Deleted profile comment",
  "session.revoke_all":            "Logged out all sessions",
  "security.exception_granted":    "Exception granted",
  "security.exception_active":     "Exception matched",
  "security.signals_whitelisted":  "Whitelisted signals",
  "security.reviewed_signal_matched": "Reviewed signal matched",
};
function humanizeAction(a: string) {
  return ACTION_LABELS[a] ?? a.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Shared pieces ───────────────────────────────────────────────────────────────

/** Consistent "nothing to do here" state for every ModCanvas tab — a calm
 *  double-check icon over the message. */
function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="mc-empty">
      <FontAwesomeIcon icon={faCheckDouble} className="mc-empty__ic" />
      <span>{children}</span>
    </div>
  );
}

function SectionHead({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div className="mc-sechead">
      <div>
        <h3>{title}</h3>
        {sub && <span>{sub}</span>}
      </div>
      {right}
    </div>
  );
}

function ActorAvatar({ entry, size }: { entry: LogEntry; size: "sm" | "md" }) {
  const cls = size === "sm" ? "mc-log__ava" : "mc-act__ava";
  return (
    <div className={`${cls}${entry.actorType === "system" ? " is-system" : ""}`}>
      <FontAwesomeIcon icon={entry.actorType === "system" ? faGear : faShield} />
    </div>
  );
}

function ActorName({ entry }: { entry: LogEntry }) {
  return <b>{entry.actorType === "system" ? "SYSTEM" : (entry.actorUsername ?? entry.actorId?.slice(0, 10) ?? "mod")}</b>;
}

// ── Audit log ───────────────────────────────────────────────────────────────────

function LogSection() {
  const [filter, setFilter] = useState("");
  const { data, isLoading } = useQuery<Paged<LogEntry>>({
    queryKey: ["canvas-log"],
    queryFn:  () => api.get("/moderation/log?limit=20"),
  });

  const rows = (data?.data ?? []).filter((e) => {
    if (!filter.trim()) return true;
    const hay = `${e.actorUsername ?? ""} ${humanizeAction(e.action)} ${e.targetUsername ?? ""} ${e.targetDetail ?? ""}`.toLowerCase();
    return hay.includes(filter.toLowerCase());
  });

  return (
    <div className="mc-pane">
      <SectionHead
        title="Audit log"
        sub="Every moderator action, newest first"
        right={(
          <div className="mc-inp" style={{ display:"flex",alignItems:"center",gap:8,width:180,marginBottom:0,padding:"7px 12px" }}>
            <FontAwesomeIcon icon={faMagnifyingGlass} style={{ color:"var(--c-fg-subtle)",fontSize:"var(--fs-xs)" }} />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter log…"
              style={{ border:"none",background:"none",outline:"none",font:"inherit",color:"var(--c-fg)",width:"100%" }} />
          </div>
        )}
      />

      {isLoading ? (
        <div className="mc-empty">Loading…</div>
      ) : !rows.length ? (
        <EmptyState>No log entries.</EmptyState>
      ) : (
        <div className="mc-log">
          {rows.map((e) => (
            <div key={e.id} className="mc-log__row">
              <ActorAvatar entry={e} size="sm" />
              <p>
                <ActorName entry={e} /> {humanizeAction(e.action)}
                {e.targetUsername && <> <em>{e.targetUsername}</em></>}
                {e.targetDetail && <span className="mc-log__detail"> · {e.targetDetail}</span>}
              </p>
              <span className="mc-log__time">{timeAgo(e.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main ModCanvas ──────────────────────────────────────────────────────────────

/**
 * The moderation console: a slide-over from the right, one tab strip in the header.
 *
 * Reports are a split inspector (list | detail + action composer) and every action
 * starts from a premade text. The texts are READ here; admins write them in
 * ACP → Moderation → Templates. The centred modal with a nav rail and a
 * dashboard it replaced is gone; its counts live on the tabs.
 */
export function ModCanvas() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggle: toggleTheme } = useTheme();

  const isMod = user?.groups.some((g) => MOD_KEYS.has(g.key)) ?? false;

  const [open,    setOpen]    = useState(false);
  const [section, setSection] = useState<Section>("reports");
  /** Set when the inspector opens a member's profile, so Users lands on them. */
  const [usersFor, setUsersFor] = useState<string | null>(null);

  // ── Draggable trigger ──────────────────────────────────────────────────────
  const BTN = 58; // button diameter px
  const [pos, setPos] = useState({ x: 0, y: 0 });  // set on mount
  const posRef   = useRef({ x: 0, y: 0 });
  const dragging = useRef(false);
  const hasMoved = useRef(false);
  const dragOff  = useRef({ x: 0, y: 0 });

  // Initialise to bottom-right after first paint
  useEffect(() => {
    const x = window.innerWidth  - BTN / 2 - 26;
    const y = window.innerHeight - BTN / 2 - 26;
    posRef.current = { x, y };
    setPos({ x, y });
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!dragging.current) return;
      const src = "touches" in e ? e.touches[0] : e;
      const clientX = src!.clientX;
      const clientY = src!.clientY;
      const hw = BTN / 2;
      const nx = Math.max(hw, Math.min(window.innerWidth  - hw, clientX - dragOff.current.x));
      const ny = Math.max(hw, Math.min(window.innerHeight - hw, clientY - dragOff.current.y));
      const dx = nx - posRef.current.x;
      const dy = ny - posRef.current.y;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) hasMoved.current = true;
      posRef.current = { x: nx, y: ny };
      setPos({ x: nx, y: ny });
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend",  onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
      window.removeEventListener("touchmove", onMove as EventListener);
      window.removeEventListener("touchend",  onUp);
    };
  }, []);

  const onTriggerDown = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const clientX = "touches" in e ? e.touches[0]?.clientX ?? 0 : e.clientX;
    const clientY = "touches" in e ? e.touches[0]?.clientY ?? 0 : e.clientY;
    dragging.current = true;
    hasMoved.current = false;
    dragOff.current  = { x: clientX - posRef.current.x, y: clientY - posRef.current.y };
  };

  const onTriggerUp = () => {
    if (!hasMoved.current) setOpen((v) => !v);
  };

  // ── Keyboard shortcut ──────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) { setOpen(false); return; }
      if (e.shiftKey && e.key === "M" &&
          !(e.target instanceof HTMLInputElement) &&
          !(e.target instanceof HTMLTextAreaElement)) {
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  // ── Context user ───────────────────────────────────────────────────────────
  const profileMatch = location.pathname.match(/^\/u\/([^/]+)/);
  const contextUsername = profileMatch?.[1] ?? "";

  const { data: summary, refetch: refetchSummary } = useQuery<Summary>({
    queryKey: ["mod-summary"],
    queryFn:  () => api.get("/moderation/summary"),
    refetchInterval: open ? 30000 : false,
    enabled: isMod,
  });
  useEffect(() => { if (open) refetchSummary(); }, [open, refetchSummary]);

  const pluginSections = slotRegistry.getModCanvasSections();
  const [pluginBadgeCounts, setPluginBadgeCounts] = useState<Record<string, number>>({});

  // Refresh plugin badge counts whenever the canvas opens
  useEffect(() => {
    if (!isMod || !open) return;
    pluginSections.forEach((s) => {
      if (s.badgeCountFn) {
        s.badgeCountFn().then((n) => setPluginBadgeCounts((prev) => ({ ...prev, [s.id]: n })));
      }
    });
  }, [isMod, open]);

  const pluginBadgeTotal = Object.values(pluginBadgeCounts).reduce((a, b) => a + b, 0);
  const badge = (summary?.pendingReports ?? 0) + (summary?.openCases ?? 0) + pluginBadgeTotal;

  // Header tabs. Counts are always red badges; plugin sections sit before the log.
  const TABS: { id: string; label: string; icon: IconProp; count?: number }[] = [
    { id:"reports",   label:"Reports",   icon:faFlag,       count: summary?.pendingReports },
    { id:"cases",     label:"Cases",     icon:faFolderOpen, count: summary?.openCases      },
    { id:"users",     label:"Users",     icon:faUser                                       },
    ...pluginSections.map((s) => ({ id: s.id, label: s.label, icon: s.icon as IconProp, count: pluginBadgeCounts[s.id] })),
    { id:"log",       label:"Audit log", icon:faClipboardList                                },
  ];

  if (!isMod) return null;

  const openUser = (username: string) => { setUsersFor(username); setSection("users"); };
  /**
   * The texts are managed in the ACP (Moderation → Templates), by admins; ModCanvas only
   * reads them. The link is offered to those who can open the ACP at all.
   */
  const canManageTemplates = user?.groups.some((g) => g.key === "admin") ?? false;
  const manageTemplates = canManageTemplates
    ? (id: string | null) => { setOpen(false); navigate(`/admin/mod-templates${id ? `?id=${encodeURIComponent(id)}` : ""}`); }
    : null;
  const split = section === "reports";

  return (
    <>
      <div className={`mc-scrim${open ? " is-open" : ""}`} onMouseDown={() => setOpen(false)} aria-hidden={!open} />
      <aside className={`mc-panel${open ? " is-open" : ""}`} role="dialog" aria-modal="true" aria-label="ModCanvas moderation tools" aria-hidden={!open}>
        {open && (
          <>
            <header className="mc-head">
              <div className="mc-head__left">
                <span className="mc-brand__mark" title={contextUsername ? `ModCanvas · ${contextUsername}` : "ModCanvas"}>
                  <FontAwesomeIcon icon={faShield} />
                </span>
                <nav className="mc-tabs" aria-label="ModCanvas sections">
                  {TABS.map((t) => (
                    <button key={t.id} type="button" className={`mc-tab${section === t.id ? " is-on" : ""}`}
                      onClick={() => { if (t.id === "users") setUsersFor(null); setSection(t.id); }}>
                      <FontAwesomeIcon icon={t.icon} />
                      <span>{t.label}</span>
                      {(t.count ?? 0) > 0 && <em className="mc-tab__n">{t.count! > 99 ? "99+" : t.count}</em>}
                    </button>
                  ))}
                </nav>
              </div>
              <div className="mc-head__right">
                <button type="button" className="mc-iconbtn" onClick={toggleTheme} title="Toggle theme">
                  <FontAwesomeIcon icon={theme === "dark" ? faSun : faMoon} />
                </button>
                <button type="button" className="mc-iconbtn" onClick={() => setOpen(false)} title="Close (Esc)">
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              </div>
            </header>

            <div className={`mc-main${split ? " mc-main--split" : ""}`}>
              {section === "reports"   && <ReportsInspector onManageTemplates={manageTemplates} onOpenUser={openUser} />}
              {section === "users"     && <UsersSection key={usersFor ?? contextUsername} contextUsername={usersFor ?? contextUsername} />}
              {section === "cases"     && <CasesSection />}
              {section === "log"       && <LogSection />}
              {pluginSections.map((s) => section === s.id && <s.component key={s.id} onNav={setSection} contextUsername={contextUsername} />)}
            </div>
          </>
        )}
      </aside>

      {/* Draggable floating trigger */}
      <button
        type="button"
        className="mc-trigger"
        title="ModCanvas (Shift+M)"
        onMouseDown={onTriggerDown}
        onMouseUp={onTriggerUp}
        onTouchStart={onTriggerDown}
        onTouchEnd={onTriggerUp}
        style={{ left: pos.x - BTN / 2, top: pos.y - BTN / 2 }}
      >
        <FontAwesomeIcon icon={faShield} />
        {badge > 0 && <em className="mc-trigger__n">{badge > 99 ? "99+" : badge}</em>}
      </button>
    </>
  );
}
