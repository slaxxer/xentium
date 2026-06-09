import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGear } from "@fortawesome/free-solid-svg-icons";
import { api } from "../lib/api";
import { slotRegistry } from "../plugins/slotRegistry";
import { UserAvatar } from "./UserAvatar";

interface Notification {
  id:        string;
  type:      string;
  title:     string;
  body:      string;
  link:      string | null;
  readAt:    string | null;
  createdAt: string;
  meta?:     { senderUsername?: string; senderAvatar?: string | null; senderBadgeColor?: string | null } | null;
}

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60)   return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function NotificationBell() {
  const qc              = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref             = useRef<HTMLDivElement>(null);

  const { data: countData } = useQuery<{ count: number }>({
    queryKey:      ["notif-unread-count"],
    queryFn:       () => api.get("/notifications/unread-count"),
    refetchInterval: 60_000,
  });

  const { data: listData, isLoading: listLoading } = useQuery<{ data: Notification[] }>({
    queryKey: ["notif-list"],
    queryFn:  () => api.get("/notifications?limit=15"),
    enabled:  open,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`, {}),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ["notif-unread-count"] });
      qc.invalidateQueries({ queryKey: ["notif-list"] });
    },
  });

  const markAllMutation = useMutation({
    mutationFn: () => api.post("/notifications/read-all", {}),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ["notif-unread-count"] });
      qc.invalidateQueries({ queryKey: ["notif-list"] });
    },
  });

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const unread = countData?.count ?? 0;
  const notifications = listData?.data ?? [];

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {/* Bell button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          position: "relative",
          background: "var(--input-bg)",
          border: "none",
          borderRadius: "var(--radius-md)",
          width: 40, height: 40,
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", color: "var(--c-fg-muted)",
          transition: "background .15s, color .15s",
          ...(open ? { background: "var(--c-accent-soft)", color: "var(--c-accent)" } : {}),
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--c-accent-soft)"; e.currentTarget.style.color = "var(--c-fg)"; }}
        onMouseLeave={(e) => {
          if (!open) { e.currentTarget.style.background = "var(--input-bg)"; e.currentTarget.style.color = "var(--c-fg-muted)"; }
        }}
        aria-label="Notifications"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        {unread > 0 && (
          <span style={{
            position: "absolute", top: -4, right: -4,
            background: "var(--c-accent2)", color: "#fff",
            fontSize: 9, fontWeight: 800,
            minWidth: 16, height: 16,
            borderRadius: 99, display: "flex", alignItems: "center", justifyContent: "center",
            padding: "0 3px", lineHeight: 1,
            border: "2px solid var(--c-card)",
          }}>
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 8px)", right: 0,
          width: 340, maxHeight: 420,
          background: "var(--c-card)", border: "1px solid var(--c-border)",
          borderRadius: "var(--radius-md)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
          display: "flex", flexDirection: "column",
          overflow: "hidden", zIndex: 200,
        }}>
          {/* Header */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "12px 16px", borderBottom: "1px solid var(--c-border)", flexShrink: 0,
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--c-fg)" }}>
              Notifications {unread > 0 && <span style={{ color: "var(--c-accent)", fontSize: 12 }}>({unread})</span>}
            </span>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => markAllMutation.mutate()}
                disabled={markAllMutation.isPending}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "var(--c-accent)", fontWeight: 600, padding: 0 }}
              >
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div style={{ overflowY: "auto", flex: 1 }}>
            {listLoading ? (
              <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--c-fg-muted)", fontSize: 13 }}>
                Loading…
              </div>
            ) : notifications.length === 0 ? (
              <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--c-fg-muted)", fontSize: 13 }}>
                No notifications
              </div>
            ) : (
              notifications.map((n) => {
                const isUnread = !n.readAt;
                const isSystemNotif = slotRegistry.getSystemNotificationPrefixes().some((prefix) => n.type.startsWith(prefix) || n.type === prefix);
                const senderUser = n.meta?.senderUsername
                  ? { username: n.meta.senderUsername, avatar: n.meta.senderAvatar ?? null }
                  : null;
                const senderColor = n.meta?.senderBadgeColor ?? undefined;

                const inner = (
                  <div style={{
                    display: "flex", alignItems: "flex-start", gap: 10, padding: "11px 16px",
                    background: isUnread ? "rgba(124,106,247,0.06)" : "transparent",
                    borderBottom: "1px solid var(--c-border)",
                    cursor: "pointer", transition: "background .15s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--c-surface)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = isUnread ? "rgba(124,106,247,0.06)" : "transparent"; }}
                  onClick={() => { if (isUnread) markReadMutation.mutate(n.id); setOpen(false); }}
                  >
                    {/* Avatar: gear for system, UserAvatar for everything else */}
                    <div style={{ flexShrink: 0, position: "relative", marginTop: 1 }}>
                      {isSystemNotif ? (
                        <div style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--c-surface)", border: "1px solid var(--c-border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "var(--c-fg-muted)" }}>
                          <FontAwesomeIcon icon={faGear} />
                        </div>
                      ) : (
                        <UserAvatar
                          user={senderUser ?? { username: n.title, avatar: null }}
                          size={30}
                        />
                      )}
                      {isUnread && (
                        <div style={{ position: "absolute", top: -1, right: -1, width: 8, height: 8, borderRadius: "50%", background: "var(--c-accent)", border: "2px solid var(--c-card)" }} />
                      )}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: isUnread ? 700 : 500, color: senderColor ?? "var(--c-fg)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {n.title}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--c-fg-muted)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {n.body}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--c-fg-muted)", marginTop: 4 }}>{timeAgo(n.createdAt)}</div>
                    </div>
                  </div>
                );

                return n.link ? (
                  <Link key={n.id} to={n.link} style={{ textDecoration: "none", display: "block" }}>
                    {inner}
                  </Link>
                ) : (
                  <div key={n.id}>{inner}</div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
