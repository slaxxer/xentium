import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faDatabase, faCheck, faCircleExclamation } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";

interface MigrationRun {
  id:         string;
  command:    string;
  durationMs: number;
  output:     string;
  createdAt:  string;
}

function Badge({ ok }: { ok: boolean }) {
  const { t } = useTranslation("acp");
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 10px", borderRadius:100, fontSize:11, fontWeight:700, background: ok ? "color-mix(in srgb, var(--c-success) 15%, transparent)" : "color-mix(in srgb, var(--c-danger) 15%, transparent)", color: ok ? "var(--c-success)" : "var(--c-danger)" }}>
      <FontAwesomeIcon icon={ok ? faCheck : faCircleExclamation} />
      {ok ? t("migrations.success") : t("migrations.failed")}
    </span>
  );
}

function formatDate(d: string) {
  return new Date(d).toLocaleString("en-US", { month:"short", day:"numeric", year:"numeric", hour:"2-digit", minute:"2-digit" });
}

function succeeded(run: MigrationRun) {
  return !run.output.toLowerCase().includes("error") && !run.output.toLowerCase().includes("failed");
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
            const ok     = succeeded(run);
            const isOpen = expandedId === run.id;
            const dur    = run.durationMs < 1000 ? `${run.durationMs}ms` : `${(run.durationMs / 1000).toFixed(1)}s`;
            return (
              <div key={run.id}>
                <div
                  onClick={() => setExpandedId(isOpen ? null : run.id)}
                  style={{ display:"grid", gridTemplateColumns:"1fr 120px 80px 80px", alignItems:"center", gap:12, padding:"14px 20px", borderBottom: i < runs.length - 1 && !isOpen ? "1px solid var(--c-border)" : "none", cursor:"pointer", transition:"background 0.12s" }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "var(--c-accent-soft)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                >
                  <div>
                    <div style={{ fontSize:13, fontWeight:700, color:"var(--c-fg)", fontFamily:"monospace", marginBottom:2 }}>{run.command}</div>
                    <div style={{ fontSize:12, color:"var(--c-fg-muted)" }}>{formatDate(run.createdAt)}</div>
                  </div>
                  <Badge ok={ok} />
                  <div style={{ fontSize:12, color:"var(--c-fg-muted)" }}>{dur}</div>
                  <div style={{ fontSize:12, color:"var(--c-fg-muted)", textAlign:"right" }}>{isOpen ? t("migrations.hide") : t("migrations.output")}</div>
                </div>
                {isOpen && (
                  <div style={{ padding:"14px 20px", background:"var(--c-bg)", borderBottom: i < runs.length - 1 ? "1px solid var(--c-border)" : "none" }}>
                    <pre style={{ margin:0, fontSize:12, fontFamily:"monospace", color: ok ? "var(--c-fg-muted)" : "var(--c-danger)", whiteSpace:"pre-wrap", wordBreak:"break-all", maxHeight:300, overflowY:"auto" }}>
                      {run.output || t("migrations.noOutput")}
                    </pre>
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
