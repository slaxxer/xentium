import { useState, useRef, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconProp } from "@fortawesome/fontawesome-svg-core";
import {
  faShield, faXmark, faFlag, faTriangleExclamation,
  faBan, faClipboardList, faBolt,
  faGear, faCheck, faMinus, faRotateRight,
  faMoon, faSun, faMagnifyingGlass, faCheckDouble, faUser, faFolderOpen,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../../lib/api";
import { timeAgo } from "../../lib/time";
import { useAuth } from "../../hooks/useAuth";
import { useTheme } from "../../hooks/useTheme";
import { swalToast, apiErrorMessage } from "../../lib/swal";
import { Username } from "../../components/Username";
import { UserAvatar } from "../../components/UserAvatar";
import "./ModCanvas.scss";
import { slotRegistry } from "../../plugins/slotRegistry";
import { UsersSection } from "./UsersSection";
import { CasesSection } from "./CasesSection";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Summary  { pendingReports: number; openCases: number; activeWarnings: number; activeBans: number }
interface UserRef  { id: string; username: string; badgeColor: string | null }
interface Report   {
  id: string; targetType: string; targetId: string; reason: string; status: string; createdAt: string;
  reporter: UserRef;
  /** Author of the reported content, when the filer resolved it (enables Warn/Ban quick actions). */
  targetUser: UserRef | null;
  /** Content text captured at filing time — survives deletion/pruning of the original. */
  contentSnapshot: string | null;
}
interface LogEntry {
  id: string; actorId: string | null; actorType: string; action: string;
  targetType: string | null; targetId: string | null; reason: string | null; createdAt: string;
  actorUsername: string | null; targetUsername: string | null; targetDetail: string | null;
}
interface Paged<T> { data: T[]; meta: { total: number } }

type Section = "dashboard" | "reports" | "warnings" | "bans" | "cases" | "log" | string;

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

/** Neutral tag by default; red only for critical states (severity high, permanent
 *  ban, open case) per the ModCanvas colour discipline. */
function Tag({ children, crit }: { children: React.ReactNode; crit?: boolean }) {
  return <span className={`mc-tag${crit ? " mc-tag--crit" : ""}`}>{children}</span>;
}

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

// ── Dashboard ─────────────────────────────────────────────────────────────────

function DashboardSection({ summary, onNav }: { summary: Summary | undefined; onNav: (s: Section) => void }) {
  const tiles: { label: string; value: number; icon: typeof faFlag; tab: Section }[] = [
    { label:"Open reports", value: summary?.pendingReports ?? 0, icon: faFlag,                tab:"reports" },
    { label:"Warnings",     value: summary?.activeWarnings ?? 0, icon: faTriangleExclamation, tab:"users"   },
    { label:"Active bans",  value: summary?.activeBans ?? 0,     icon: faBan,                 tab:"users"   },
  ];

  const logQuery = useQuery<Paged<LogEntry>>({
    queryKey: ["canvas-log-dash"],
    queryFn:  () => api.get("/moderation/log?limit=5"),
  });

  const quick: { label: string; icon: typeof faFlag; tab: Section }[] = [
    { label:"Review reports", icon: faFlag,       tab:"reports" },
    { label:"Look up user",   icon: faUser,       tab:"users"   },
  ];

  return (
    <div className="mc-pane">
      <div className="mc-stats">
        {tiles.map((t) => (
          <button key={t.label} type="button" className="mc-stat" onClick={() => onNav(t.tab)}>
            <div className="mc-stat__ic"><FontAwesomeIcon icon={t.icon} /></div>
            <div className="mc-stat__num">{t.value}</div>
            <div className="mc-stat__label">{t.label}</div>
          </button>
        ))}
      </div>

      <div className="mc-quick">
        <span className="mc-quick__h">Quick actions</span>
        {quick.map((q) => (
          <button key={q.label} type="button" className="mc-chip" onClick={() => onNav(q.tab)}>
            <FontAwesomeIcon icon={q.icon} /> {q.label}
          </button>
        ))}
      </div>

      <SectionHead title="Recent activity" sub="Across all moderators" />
      <div className="mc-act">
        {(logQuery.data?.data ?? []).map((e) => (
          <div key={e.id} className="mc-act__row">
            <ActorAvatar entry={e} size="md" />
            <div className="mc-act__body">
              <p><ActorName entry={e} /> <Tag>{humanizeAction(e.action)}</Tag></p>
              <span>{e.targetUsername ? <>on <em>{e.targetUsername}</em> · </> : null}{e.targetDetail ? <>{e.targetDetail} · </> : null}{timeAgo(e.createdAt)}</span>
            </div>
          </div>
        ))}
        {!logQuery.data?.data.length && <EmptyState>No recent activity.</EmptyState>}
      </div>
    </div>
  );
}

// ── Reports ───────────────────────────────────────────────────────────────────

/** Inline Warn/Ban form under a report row targeting the reported content's
 *  author. Reuses the core /moderation/warnings + /moderation/bans endpoints
 *  (staff protection + threshold policy enforced server-side); a successful
 *  action also resolves the report. */
function ReportQuickAction({ report, mode, onDone, onCancel }: {
  report: Report; mode: "warn" | "ban"; onDone: () => void; onCancel: () => void;
}) {
  const excerpt = report.contentSnapshot ? ` — "${report.contentSnapshot.slice(0, 120)}"` : "";
  const [reason, setReason]   = useState(`Reported ${report.targetType.replace(/[_-]/g, " ")}${excerpt}`);
  const [banType, setBanType] = useState<"temporary" | "permanent">("temporary");
  const [expiry, setExpiry]   = useState("");

  const actMut = useMutation({
    mutationFn: async () => {
      if (mode === "warn") {
        await api.post("/moderation/warnings", { userId: report.targetUser!.id, reason, expiresAt: null });
      } else {
        await api.post("/moderation/bans", {
          userId: report.targetUser!.id, type: banType, reason,
          expiresAt: banType === "temporary" && expiry ? new Date(expiry).toISOString() : null,
        });
      }
      await api.patch(`/moderation/reports/${report.id}`, { status: "resolved" });
    },
    onSuccess: () => { swalToast(mode === "warn" ? "Warning issued." : "Ban issued.", "success"); onDone(); },
    onError:   (e) => swalToast(apiErrorMessage(e)),
  });

  const canSubmit = reason.trim().length >= 3 && (mode === "warn" || banType === "permanent" || !!expiry);

  return (
    <div className="mc-row__quickact">
      <input
        type="text" value={reason} onChange={(e) => setReason(e.target.value)}
        placeholder="Reason" className="mc-inp"
        style={{ flex: 1, minWidth: 180, width: "auto", marginBottom: 0 }}
      />
      {mode === "ban" && (
        <>
          <select value={banType} onChange={(e) => setBanType(e.target.value as "temporary" | "permanent")} className="mc-inp" style={{ width: "auto", marginBottom: 0 }}>
            <option value="temporary">Temporary</option>
            <option value="permanent">Permanent</option>
          </select>
          {banType === "temporary" && (
            <input type="datetime-local" value={expiry} onChange={(e) => setExpiry(e.target.value)} className="mc-inp" style={{ width: "auto", marginBottom: 0 }} />
          )}
        </>
      )}
      <button type="button" className="mc-btn mc-btn--primary mc-btn--sm" disabled={!canSubmit || actMut.isPending}
        onClick={() => actMut.mutate()}>
        {actMut.isPending ? "Working…" : mode === "warn" ? "Issue warning" : "Issue ban"}
      </button>
      <button type="button" className="mc-btn mc-btn--ghost mc-btn--sm" onClick={onCancel}>Cancel</button>
    </div>
  );
}

function ReportsSection() {
  const qc = useQueryClient();
  const [quickAction, setQuickAction] = useState<{ id: string; mode: "warn" | "ban" } | null>(null);
  const { data, isLoading, refetch } = useQuery<Paged<Report>>({
    queryKey: ["canvas-reports"],
    queryFn:  () => api.get("/moderation/reports?limit=15"),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["canvas-reports"] });
    qc.invalidateQueries({ queryKey: ["mod-summary"] });
  };

  const updateMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/moderation/reports/${id}`, { status }),
    onSuccess: invalidate,
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  return (
    <div className="mc-pane">
      <SectionHead
        title="Reports"
        sub={`${data?.meta.total ?? 0} awaiting review`}
        right={<button type="button" className="mc-iconbtn" onClick={() => refetch()} title="Refresh"><FontAwesomeIcon icon={faRotateRight} /></button>}
      />

      {isLoading ? (
        <div className="mc-empty">Loading…</div>
      ) : !data?.data.length ? (
        <EmptyState>No pending reports.</EmptyState>
      ) : (
        <div className="mc-list">
          {data.data.map((r) => (
            <div key={r.id} className="mc-row mc-row--report">
              <div className="mc-row__body">
                <div className="mc-row__main">
                  <p className="mc-row__title">
                    <Tag crit={r.reason?.length > 100}>{r.targetType.replace(/[_-]/g, " ")}</Tag>
                    {r.reason}
                  </p>
                  {r.contentSnapshot && (
                    <blockquote className="mc-quote">{r.contentSnapshot}</blockquote>
                  )}
                  <span className="mc-row__meta">
                    {r.targetUser
                      ? <>by <Username username={r.targetUser.username} badgeColor={r.targetUser.badgeColor} /> · </>
                      : <>{r.targetId.slice(0, 14)}… · </>}
                    reported by <Username username={r.reporter.username} badgeColor={r.reporter.badgeColor} /> · {timeAgo(r.createdAt)}
                  </span>
                </div>
                <div className="mc-row__act">
                  {r.targetUser && (
                    <>
                      <button type="button" className="mc-btn mc-btn--ghost mc-btn--sm" disabled={updateMut.isPending}
                        onClick={() => setQuickAction((q) => q?.id === r.id && q.mode === "warn" ? null : { id: r.id, mode: "warn" })}>
                        <FontAwesomeIcon icon={faTriangleExclamation} /> Warn
                      </button>
                      <button type="button" className="mc-btn mc-btn--ghost mc-btn--sm" disabled={updateMut.isPending}
                        onClick={() => setQuickAction((q) => q?.id === r.id && q.mode === "ban" ? null : { id: r.id, mode: "ban" })}>
                        <FontAwesomeIcon icon={faBan} /> Ban
                      </button>
                    </>
                  )}
                  <button type="button" className="mc-btn mc-btn--ghost mc-btn--sm" disabled={updateMut.isPending}
                    onClick={() => updateMut.mutate({ id: r.id, status: "dismissed" })}>
                    <FontAwesomeIcon icon={faMinus} /> Dismiss
                  </button>
                  <button type="button" className="mc-btn mc-btn--primary mc-btn--sm" disabled={updateMut.isPending}
                    onClick={() => updateMut.mutate({ id: r.id, status: "resolved" })}>
                    <FontAwesomeIcon icon={faCheck} /> Resolve
                  </button>
                </div>
              </div>
              {quickAction?.id === r.id && r.targetUser && (
                <ReportQuickAction
                  report={r} mode={quickAction.mode}
                  onDone={() => { setQuickAction(null); invalidate(); }}
                  onCancel={() => setQuickAction(null)}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
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
            <FontAwesomeIcon icon={faMagnifyingGlass} style={{ color:"var(--c-fg-subtle)",fontSize:12 }} />
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

export function ModCanvas() {
  const { user } = useAuth();
  const location = useLocation();
  const { theme, toggle: toggleTheme } = useTheme();

  const isMod = user?.groups.some((g) => MOD_KEYS.has(g.key)) ?? false;

  const [open,    setOpen]    = useState(false);
  const [section, setSection] = useState<Section>("dashboard");

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

  // Nav rail items. Counts (always rendered as red badges) come from the summary
  // and plugin badge functions; dashboard + audit log carry no count.
  const NAV: { id: string; label: string; icon: IconProp; count?: number }[] = [
    { id:"dashboard", label:"Dashboard", icon:faBolt                                              },
    { id:"users",     label:"Users",     icon:faUser                                              },
    { id:"reports",   label:"Reports",   icon:faFlag,                count: summary?.pendingReports },
    { id:"cases",     label:"Cases",     icon:faFolderOpen,          count: summary?.openCases      },
    ...pluginSections.map((s) => ({ id: s.id, label: s.label, icon: s.icon as IconProp, count: pluginBadgeCounts[s.id] })),
    { id:"log",       label:"Audit log", icon:faClipboardList                                       },
  ];

  if (!isMod) return null;

  const staffGroup = user?.groups.find((g) => MOD_KEYS.has(g.key)) ?? user?.groups?.[0];
  const roleLabel = staffGroup?.badgeLabel ?? staffGroup?.name ?? "Staff";

  return (
    <>
      {open && (
        <div className="mc-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="mc-modal" role="dialog" aria-modal="true" aria-label="ModCanvas moderation tools">

            {/* Header */}
            <header className="mc-head">
              <div className="mc-brand">
                <span className="mc-brand__mark"><FontAwesomeIcon icon={faShield} /></span>
                <div className="mc-brand__txt">
                  <b>ModCanvas{contextUsername && <span className="mc-brand__ctx"> · {contextUsername}</span>}</b>
                  <span>Moderation tools</span>
                </div>
              </div>
              <div className="mc-head__right">
                <button type="button" className="mc-iconbtn" onClick={toggleTheme} title="Toggle theme">
                  <FontAwesomeIcon icon={theme === "dark" ? faSun : faMoon} />
                </button>
                <button type="button" className="mc-iconbtn" onClick={() => setOpen(false)} title="Close">
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              </div>
            </header>

            {/* Body: nav rail + content */}
            <div className="mc-body">
              <nav className="mc-nav">
                {NAV.map((n) => (
                  <button key={n.id} type="button" className={`mc-navitem${section === n.id ? " is-on" : ""}`} onClick={() => setSection(n.id)}>
                    <span className="mc-navitem__ic"><FontAwesomeIcon icon={n.icon} /></span>
                    <span className="mc-navitem__label">{n.label}</span>
                    {(n.count ?? 0) > 0 && <em className="mc-navitem__n">{n.count! > 99 ? "99+" : n.count}</em>}
                  </button>
                ))}
                <div className="mc-nav__spacer" />
                {user && (
                  <div className="mc-nav__me">
                    <UserAvatar user={{ username: user.username, avatar: user.avatar }} size={30} />
                    <div>
                      <b><Username username={user.username} badgeColor={staffGroup?.badgeColor} roleKey={staffGroup?.key} /></b>
                      <span>{roleLabel}</span>
                    </div>
                  </div>
                )}
              </nav>

              <section className="mc-content">
                {section === "dashboard" && <DashboardSection summary={summary} onNav={setSection} />}
                {section === "users"     && <UsersSection contextUsername={contextUsername} />}
                {section === "reports"   && <ReportsSection />}
                {section === "cases"     && <CasesSection />}
                {section === "log"       && <LogSection />}
                {pluginSections.map((s) => section === s.id && <s.component key={s.id} onNav={setSection} contextUsername={contextUsername} />)}
              </section>
            </div>

            {/* Footer */}
            <footer className="mc-foot">
              <span>Press <kbd>Shift</kbd>+<kbd>M</kbd> to toggle</span>
              <span>Nodevo v1 · mod console</span>
            </footer>
          </div>
        </div>
      )}

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
