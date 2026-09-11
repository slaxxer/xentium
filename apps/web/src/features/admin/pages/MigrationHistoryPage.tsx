import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "../../../components/Icon";
import { faDatabase, faCheck, faCircleExclamation, faArrowsRotate } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";

interface MigrationRun {
  id:          string;
  adapter:     string;            // "core" = schema deploy; otherwise platform adapter
  adapterVer:  string | null;
  sourceInfo:  string | null;     // e.g. "XenForo 2.2.14"
  status:      string;            // running | completed | partial | failed
  command:     string | null;
  durationMs:  number | null;
  output:      string | null;
  startedAt:   string | null;
  completedAt: string | null;
  summary:     Record<string, number> | null;
  errors:      Array<{ entity?: string; sourceId?: string; reason?: string }> | null;
  reportPath:  string | null;
  createdAt:   string;
}

function StatusBadge({ status, output }: { status: string; output: string | null }) {
  const { t } = useTranslation("acp");
  // Legacy core rows predate the status column — infer from output.
  const failedOutput = !!output && (/error|failed/i.test(output));
  const effective = status === "completed" && failedOutput ? "failed" : status;
  const ok      = effective === "completed";
  const running = effective === "running";
  const color   = ok ? "var(--c-success)" : running ? "var(--c-accent)" : effective === "partial" ? "var(--c-warn)" : "var(--c-danger)";
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 10px", borderRadius:100, fontSize:11, fontWeight:700, background:`color-mix(in srgb, ${color} 15%, transparent)`, color }}>
      <FontAwesomeIcon icon={ok ? faCheck : running ? faArrowsRotate : faCircleExclamation} />
      {t(`migrations.status.${effective}`, { defaultValue: effective })}
    </span>
  );
}

function formatDate(d: string) {
  return new Date(d).toLocaleString("en-US", { month:"short", day:"numeric", year:"numeric", hour:"2-digit", minute:"2-digit" });
}

export function MigrationHistoryPage() {
  const { t } = useTranslation("acp");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: runs = [], isLoading } = useQuery<MigrationRun[]>({
    queryKey: ["acp-migration-history"],
    queryFn:  () => api.get("/admin/migration-history"),
  });

  return (
    <div style={{ maxWidth: 860 }}>
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">{t("nav.system")}</div>
          <h1 className="acp-page-title">{t("migrations.title")}</h1>
        </div>
      </div>

      {isLoading ? (
        <div className="acp-card acp-empty">{t("migrations.loading")}</div>
      ) : runs.length === 0 ? (
        <div className="acp-card" style={{ padding: 40, textAlign: "center" }}>
          <FontAwesomeIcon icon={faDatabase} style={{ fontSize: 32, color: "var(--c-fg-muted)", marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--c-fg)", marginBottom: 6 }}>{t("migrations.emptyTitle")}</div>
          <div style={{ fontSize: 13, color: "var(--c-fg-muted)" }}>
            {t("migrations.emptyHint")}
          </div>
        </div>
      ) : (
        <div className="acp-card" style={{ padding: 0, overflow: "hidden" }}>
          {runs.map((run, i) => {
            const isCore   = run.adapter === "core";
            const isOpen   = expandedId === run.id;
            const dur      = run.durationMs == null ? "—" : run.durationMs < 1000 ? `${run.durationMs}ms` : `${(run.durationMs / 1000).toFixed(1)}s`;
            const title    = isCore ? (run.command ?? "migrate deploy") : `${run.adapter}${run.adapterVer ? ` v${run.adapterVer}` : ""}`;
            const subtitle = [run.sourceInfo, formatDate(run.startedAt ?? run.createdAt)].filter(Boolean).join(" · ");
            const summary  = run.summary
              ? Object.entries(run.summary).map(([k, v]) => `${v.toLocaleString()} ${k}`).join(" · ")
              : null;
            return (
              <div key={run.id}>
                <div
                  onClick={() => setExpandedId(isOpen ? null : run.id)}
                  style={{ display:"grid", gridTemplateColumns:"1fr 120px 80px 80px", alignItems:"center", gap:12, padding:"14px 20px", borderBottom: i < runs.length - 1 && !isOpen ? "1px solid var(--c-border)" : "none", cursor:"pointer", transition:"background 0.12s" }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "var(--c-accent-soft)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                >
                  <div>
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:2 }}>
                      <span style={{ fontSize:13, fontWeight:700, color:"var(--c-fg)", fontFamily: isCore ? "monospace" : undefined }}>{title}</span>
                      <span className={`acp-badge ${isCore ? "acp-badge--muted" : "acp-badge--neutral"}`} style={{ marginTop: 0 }}>
                        {isCore ? t("migrations.coreBadge", { defaultValue: "Core" }) : t("migrations.importBadge", { defaultValue: "Import" })}
                      </span>
                    </div>
                    <div style={{ fontSize:12, color:"var(--c-fg-muted)" }}>{subtitle}</div>
                    {summary && <div style={{ fontSize:12, color:"var(--c-fg-muted)", marginTop:2 }}>{summary}</div>}
                  </div>
                  <StatusBadge status={run.status} output={run.output} />
                  <div style={{ fontSize:12, color:"var(--c-fg-muted)" }}>{dur}</div>
                  <div style={{ fontSize:12, color:"var(--c-fg-muted)", textAlign:"right" }}>{isOpen ? t("migrations.hide") : t("migrations.output")}</div>
                </div>
                {isOpen && (
                  <div style={{ padding:"14px 20px", background:"var(--c-bg)", borderBottom: i < runs.length - 1 ? "1px solid var(--c-border)" : "none" }}>
                    {run.errors && run.errors.length > 0 && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize:12, fontWeight:700, color:"var(--c-danger)", marginBottom:4 }}>
                          {t("migrations.errors", { defaultValue: "Errors" })} ({run.errors.length})
                        </div>
                        <pre style={{ margin:0, fontSize:12, fontFamily:"monospace", color:"var(--c-danger)", whiteSpace:"pre-wrap", wordBreak:"break-all", maxHeight:200, overflowY:"auto" }}>
                          {run.errors.map((e) => `${e.entity ?? "?"} ${e.sourceId ?? ""}: ${e.reason ?? "unknown"}`).join("\n")}
                        </pre>
                      </div>
                    )}
                    <pre style={{ margin:0, fontSize:12, fontFamily:"monospace", color:"var(--c-fg-muted)", whiteSpace:"pre-wrap", wordBreak:"break-all", maxHeight:300, overflowY:"auto" }}>
                      {run.output || t("migrations.noOutput")}
                    </pre>
                    {run.reportPath && (
                      <div style={{ fontSize:12, color:"var(--c-fg-muted)", marginTop:8 }}>
                        {t("migrations.report", { defaultValue: "Full report" })}: <code>{run.reportPath}</code>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
