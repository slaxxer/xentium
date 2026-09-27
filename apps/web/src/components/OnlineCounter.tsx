import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { UserAvatar } from "./UserAvatar";
import { Username } from "./Username";

interface OnlineGroup {
  name:       string;
  key:        string;
  badgeColor: string | null;
  badgeLabel: string | null;
  count:      number;
}

interface OnlineUser {
  username:   string;
  avatar:     string | null;
  groupKey:   string;
  badgeColor: string | null;
}

interface OnlineData {
  total:  number;
  groups: OnlineGroup[];
  users:  OnlineUser[];
}

export function OnlineCounter() {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const ref             = useRef<HTMLDivElement>(null);
  const PAGE_SIZE       = 10;

  const { data } = useQuery<OnlineData>({
    queryKey:        ["online-count"],
    queryFn:         () => api.get("/online"),
    refetchInterval: 60_000,
    placeholderData: { total: 0, groups: [], users: [] },
  });

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const total    = data?.total ?? 0;
  const allUsers = data?.users ?? [];
  const totalPages = Math.max(1, Math.ceil(allUsers.length / PAGE_SIZE));
  const users      = allUsers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setPage(1); }}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          background: "transparent", border: "none", cursor: "pointer",
          padding: 0, color: "var(--c-fg-muted)", fontSize: "var(--fs-sm)",
          fontFamily: "inherit",
        }}
      >
        {/* Pulsing green dot */}
        <span style={{ position: "relative", width: 8, height: 8, flexShrink: 0 }}>
          <span style={{
            position: "absolute", inset: 0, borderRadius: "50%",
            background: "var(--c-success)", opacity: 0.4,
            animation: "online-pulse 2s ease-in-out infinite",
          }} />
          <span style={{
            position: "absolute", inset: 1, borderRadius: "50%",
            background: "var(--c-success)",
          }} />
        </span>
        <span style={{ fontWeight: 600, color: "var(--c-success)" }}>{total}</span>
        <span>online</span>
      </button>

      {open && total > 0 && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 8px)", right: 0,
          background: "var(--c-card)", border: "1px solid var(--c-border)",
          borderRadius: "var(--radius-md)", padding: "10px 0",
          minWidth: 220, maxHeight: 360, overflowY: "auto",
          boxShadow: "0 -8px 24px rgba(0,0,0,0.2)",
          zIndex: 50,
        }}>
          <div style={{ padding: "4px 14px 8px", fontSize: "var(--fs-2xs)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--c-fg-muted)", borderBottom: "1px solid var(--c-border)", marginBottom: 4 }}>
            Online now
          </div>

          {users.map((u) => (
            <div key={u.username} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px" }}>
              <UserAvatar
                user={{ username: u.username, avatar: u.avatar ? `/uploads/${u.avatar}` : null }}
                size={22}
              />
              <Username username={u.username} badgeColor={u.badgeColor} style={{ fontSize: "var(--fs-sm)" }} />
            </div>
          ))}

          {totalPages > 1 && (
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "8px 14px 4px",
              borderTop: "1px solid var(--c-border)", marginTop: 4,
            }}>
              <button
                type="button"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
                style={{ background: "none", border: "none", cursor: page === 1 ? "not-allowed" : "pointer", color: page === 1 ? "var(--c-fg-muted)" : "var(--c-accent)", fontSize: "var(--fs-sm)", fontWeight: 600, padding: "2px 4px", opacity: page === 1 ? 0.4 : 1, fontFamily: "inherit" }}
              >
                ‹ Prev
              </button>
              <span style={{ fontSize: "var(--fs-2xs)", color: "var(--c-fg-muted)" }}>
                {page} / {totalPages}
              </span>
              <button
                type="button"
                disabled={page === totalPages}
                onClick={() => setPage((p) => p + 1)}
                style={{ background: "none", border: "none", cursor: page === totalPages ? "not-allowed" : "pointer", color: page === totalPages ? "var(--c-fg-muted)" : "var(--c-accent)", fontSize: "var(--fs-sm)", fontWeight: 600, padding: "2px 4px", opacity: page === totalPages ? 0.4 : 1, fontFamily: "inherit" }}
              >
                Next ›
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
