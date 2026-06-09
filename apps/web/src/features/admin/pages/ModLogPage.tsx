import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faShield, faGear } from "@fortawesome/free-solid-svg-icons";
import { Username } from "../../../components/Username";
import { api } from "../../../lib/api";

interface LogEntry {
  id: string;
  actorId:          string | null;
  actorType:        string;
  actorUsername:    string | null;
  actorBadgeColor:  string | null;
  action:           string;
  targetType:       string | null;
  targetId:         string | null;
  targetUsername:   string | null;
  targetBadgeColor: string | null;
  targetDetail:     string | null;
  reason:           string | null;
  createdAt:        string;
}

interface ModLogResponse {
  data: LogEntry[];
  meta: { total: number };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  "ban.issued":          "Ban Issued",
  "ban.lifted":          "Ban Lifted",
  "ban.expired":         "Ban Expired",
  "warn.issued":         "Warning Issued",
  "warn.pardoned":       "Warning Pardoned",
  "warn.expired":        "Warning Expired",
  "warning.issued":      "Warning Issued",
  "warning.pardoned":    "Warning Pardoned",
  "warning.expired":     "Warning Expired",
  "case.ban_all":              "Banned All Linked Accounts",
  "security.exception_granted": "Exception Granted",
  "security.exception_active":  "Exception Matched",
  "user.promoted":       "User Promoted",
  "user.banned":         "User Banned",
  "user.group_changed":  "Group Changed",
  "user.deleted":        "Account Deactivated",
  "moderation.policy_changed": "Policy Changed",
  "plugin.installed":    "Plugin Installed",
  "plugin.enabled":      "Plugin Enabled",
  "plugin.disabled":     "Plugin Disabled",
  "plugin.uninstalled":  "Plugin Uninstalled",
  "settings.changed":    "Settings Changed",
  "article.published":   "Article Published",
  "article.deleted":     "Article Deleted",
};

function humanizeAction(action: string): string {
  return ACTION_LABELS[action]
    ?? action.split(".").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function humanizeDomain(action: string): string {
  const prefix = action.split(".")[0] ?? action;
  const map: Record<string, string> = {
    ban:        "Ban",
    warn:       "Warning",
    user:       "User",
    moderation: "Moderation",
    plugin:     "Plugin",
    settings:   "Settings",
    article:    "Content",
    license:    "License",
    group:      "Groups",
  };
  return map[prefix] ?? (prefix.charAt(0).toUpperCase() + prefix.slice(1));
}

function actionColor(action: string): string {
  if (action.startsWith("ban"))  return "var(--c-danger)";
  if (action.startsWith("warn")) return "var(--c-warn)";
  if (action.includes("lifted") || action.includes("pardoned")) return "var(--c-success)";
  return "var(--c-accent)";
}

function timeAgo(d: string) {
  const mins = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

function Badge({ label, color = "var(--c-accent)" }: { label: string; color?: string }) {
  return (
    <span style={{ display:"inline-flex",alignItems:"center",padding:"3px 10px",borderRadius:100,fontSize:11,fontWeight:700,background:`${color}20`,color }}>
      {label}
    </span>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

const ACTION_GROUPS = [
  { value: "",           label: "All actions"  },
  { value: "ban",        label: "Bans"         },
  { value: "warning",    label: "Warnings"     },
  { value: "report",     label: "Reports"      },
  { value: "case",       label: "Cases"        },
  { value: "security",   label: "Security"     },
  { value: "user",       label: "Users"        },
  { value: "article",    label: "Content"      },
] as const;

export function ModLogPage() {
  const [actorType,   setActorType]   = useState("");
  const [actionGroup, setActionGroup] = useState("");

  const qs = new URLSearchParams({ limit: "50" });
  if (actorType)   qs.set("actorType", actorType);
  // action group filter: prefix-match handled server-side via LIKE
  // We pass a partial action key; the service filters by prefix
  if (actionGroup) qs.set("actionPrefix", actionGroup);

  const { data, isLoading } = useQuery<ModLogResponse>({
    queryKey: ["acp-modlog", actorType, actionGroup],
    queryFn:  () => api.get(`/admin/modlog?${qs.toString()}`),
  });

  return (
    <div>
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">Moderation</div>
          <h1 className="acp-page-title">Moderation Log</h1>
        </div>
      </div>

      <div style={{ display:"flex", gap:10, marginBottom:20 }}>
        <select className="acp-select" style={{ width:"auto" }}
          value={actionGroup} onChange={(e) => setActionGroup(e.target.value)}
        >
          {ACTION_GROUPS.map((g) => (
            <option key={g.value} value={g.value}>{g.label}</option>
          ))}
        </select>
        <select className="acp-select" style={{ width:"auto" }}
          value={actorType} onChange={(e) => setActorType(e.target.value)}
        >
          <option value="">All actors</option>
          <option value="user">Human</option>
          <option value="system">System</option>
        </select>
      </div>

      {isLoading ? (
        <div className="acp-card acp-empty">Loading…</div>
      ) : data?.data.length === 0 ? (
        <div className="acp-card acp-empty">Moderation log is empty.</div>
      ) : (
        <div className="acp-card" style={{ padding:0, overflow:"hidden" }}>
          {data?.data.map((e, i) => {
            const isSystem  = e.actorType === "system";
            const aColor    = isSystem ? "var(--c-warn)" : "var(--c-accent)";
            const iconBg    = isSystem ? "rgba(251,191,36,.15)" : "var(--c-accent-soft)";
            const typeColor = actionColor(e.action);
            const actorLabel  = isSystem ? "System" : (e.actorUsername ?? "Unknown");
            const targetLabel = e.targetUsername ?? e.targetId ?? null;

            return (
              <div
                key={e.id}
                style={{ display:"grid", gridTemplateColumns:"40px 1fr 110px 80px 80px", alignItems:"center", gap:12, padding:"13px 18px", borderBottom: i < (data?.data.length ?? 1) - 1 ? "1px solid var(--c-border)" : "none", transition:"background 0.15s" }}
                onMouseEnter={(el) => (el.currentTarget.style.background = "var(--c-accent-soft)")}
                onMouseLeave={(el) => (el.currentTarget.style.background = "transparent")}
              >
                {/* Icon */}
                <div style={{ width:32, height:32, borderRadius:"50%", background:iconBg, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, color:aColor }}>
                  <FontAwesomeIcon icon={isSystem ? faGear : faShield} />
                </div>

                {/* Description */}
                <div>
                  <div style={{ fontSize:13, fontWeight:600, color:"var(--c-fg)" }}>
                    {humanizeAction(e.action)}
                  </div>
                  <div style={{ fontSize:12, color:"var(--c-fg-muted)", marginTop:2 }}>
                    by{" "}
                    {isSystem
                      ? <span style={{ color:aColor, fontWeight:600 }}>System</span>
                      : <Username username={actorLabel} badgeColor={e.actorBadgeColor} style={{ fontWeight:600 }} />
                    }
                    {targetLabel && (
                      <>
                        {e.targetType === "moderation_case" ? " · case: " : " · target: "}
                        <Username username={targetLabel} badgeColor={e.targetBadgeColor} style={{ fontWeight:600 }} />
                      </>
                    )}
                    {e.targetDetail && (
                      <span style={{ color:"var(--c-fg-muted)" }}> · {e.targetDetail}</span>
                    )}
                    {e.reason && (
                      <span style={{ color:"var(--c-fg-muted)" }}> · {e.reason}</span>
                    )}
                  </div>
                </div>

                {/* Domain badge */}
                <Badge label={humanizeDomain(e.action)} color={typeColor} />

                {/* Actor type badge */}
                <Badge label={isSystem ? "System" : "Human"} color={aColor} />

                {/* Time */}
                <div style={{ fontSize:12, color:"var(--c-fg-muted)" }}>{timeAgo(e.createdAt)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
