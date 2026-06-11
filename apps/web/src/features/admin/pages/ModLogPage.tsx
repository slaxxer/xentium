import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
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

function humanizeAction(action: string, t: TFunction): string {
  const fallback = action.split(".").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  return t(`modLog.actions.${action.replace(/\./g, "_")}`, { defaultValue: fallback });
}

function humanizeDomain(action: string, t: TFunction): string {
  const prefix = action.split(".")[0] ?? action;
  const fallback = prefix.charAt(0).toUpperCase() + prefix.slice(1);
  return t(`modLog.domains.${prefix}`, { defaultValue: fallback });
}

function actionColor(action: string): string {
  if (action.startsWith("ban"))  return "var(--c-danger)";
  if (action.startsWith("warn")) return "var(--c-warn)";
  if (action.includes("lifted") || action.includes("pardoned")) return "var(--c-success)";
  return "var(--c-accent)";
}

function timeAgo(d: string, t: TFunction) {
  const mins = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 60) return t("dashboard.agoM", { n: mins });
  const h = Math.floor(mins / 60);
  return h < 24 ? t("dashboard.agoH", { n: h }) : t("dashboard.agoD", { n: Math.floor(h / 24) });
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
  { value: "",           key: "all"      },
  { value: "ban",        key: "ban"      },
  { value: "warning",    key: "warning"  },
  { value: "report",     key: "report"   },
  { value: "case",       key: "case"     },
  { value: "security",   key: "security" },
  { value: "user",       key: "user"     },
  { value: "article",    key: "article"  },
] as const;

export function ModLogPage() {
  const { t } = useTranslation("acp");
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
          <div className="acp-page-sub">{t("modLog.sub")}</div>
          <h1 className="acp-page-title">{t("modLog.title")}</h1>
        </div>
      </div>

      <div style={{ display:"flex", gap:10, marginBottom:20 }}>
        <select className="acp-select" style={{ width:"auto" }}
          value={actionGroup} onChange={(e) => setActionGroup(e.target.value)}
        >
          {ACTION_GROUPS.map((g) => (
            <option key={g.value} value={g.value}>{t(`modLog.groups.${g.key}`)}</option>
          ))}
        </select>
        <select className="acp-select" style={{ width:"auto" }}
          value={actorType} onChange={(e) => setActorType(e.target.value)}
        >
          <option value="">{t("modLog.allActors")}</option>
          <option value="user">{t("modLog.actorHuman")}</option>
          <option value="system">{t("modLog.actorSystem")}</option>
        </select>
      </div>

      {isLoading ? (
        <div className="acp-card acp-empty">{t("modLog.loading")}</div>
      ) : data?.data.length === 0 ? (
        <div className="acp-card acp-empty">{t("modLog.empty")}</div>
      ) : (
        <div className="acp-card" style={{ padding:0, overflow:"hidden" }}>
          {data?.data.map((e, i) => {
            const isSystem  = e.actorType === "system";
            const aColor    = isSystem ? "var(--c-warn)" : "var(--c-accent)";
            const iconBg    = isSystem ? "rgba(251,191,36,.15)" : "var(--c-accent-soft)";
            const typeColor = actionColor(e.action);
            const actorLabel  = isSystem ? t("modLog.system") : (e.actorUsername ?? t("modLog.unknown"));
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
                    {humanizeAction(e.action, t)}
                  </div>
                  <div style={{ fontSize:12, color:"var(--c-fg-muted)", marginTop:2 }}>
                    {t("modLog.by")}{" "}
                    {isSystem
                      ? <span style={{ color:aColor, fontWeight:600 }}>{t("modLog.system")}</span>
                      : <Username username={actorLabel} badgeColor={e.actorBadgeColor} style={{ fontWeight:600 }} />
                    }
                    {targetLabel && (
                      <>
                        {e.targetType === "moderation_case" ? ` · ${t("modLog.caseLabel")} ` : ` · ${t("modLog.targetLabel")} `}
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
                <Badge label={humanizeDomain(e.action, t)} color={typeColor} />

                {/* Actor type badge */}
                <Badge label={isSystem ? t("modLog.actorSystem") : t("modLog.actorHuman")} color={aColor} />

                {/* Time */}
                <div style={{ fontSize:12, color:"var(--c-fg-muted)" }}>{timeAgo(e.createdAt, t)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
