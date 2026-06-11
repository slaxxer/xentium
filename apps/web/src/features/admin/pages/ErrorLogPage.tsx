import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTrash, faRotateRight } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { swalToast, apiErrorMessage, swalConfirm } from "../../../lib/swal";

interface ErrorEntry {
  id:        string;
  code:      string;
  message:   string;
  severity:  string;
  context:   Record<string, unknown> | null;
  requestId: string | null;
  userId:    string | null;
  createdAt: string;
}
interface ErrorLogResponse {
  data: ErrorEntry[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

const DOMAINS = ["API", "AUTH", "PERM", "ARTICLE", "STORE", "PLUGIN", "CORE", "MOD", "INSTALL", "DB", "QUEUE"];

const SEV_COLOR: Record<string, string> = {
  critical: "var(--c-danger)",
  error:    "var(--c-danger)",
  warn:     "var(--c-warn)",
  info:     "var(--c-accent)",
};

function Badge({ label, color = "var(--c-accent)" }: { label: string; color?: string }) {
  return (
    <span style={{ display:"inline-flex",alignItems:"center",padding:"3px 10px",borderRadius:100,fontSize:11,fontWeight:700,background:`${color}20`,color }}>
      {label}
    </span>
  );
}

function timeAgo(d: string) {
  const mins = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

const SEV_LABEL_KEY: Record<string, string> = {
  critical: "errorLog.sevCritical",
  error:    "errorLog.sevError",
  warn:     "errorLog.sevWarn",
  info:     "errorLog.sevInfo",
};

export function ErrorLogPage() {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const [severity, setSeverity] = useState("");
  const [domain,   setDomain]   = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery<ErrorLogResponse>({
    queryKey: ["acp-error-log", severity, domain],
    queryFn: () => {
      const p = new URLSearchParams({ limit: "50" });
      if (severity) p.set("severity", severity);
      if (domain)   p.set("domain", domain);
      return api.get(`/admin/error-log?${p}`);
    },
  });

  const clearMut = useMutation({
    mutationFn: () => {
      const p = new URLSearchParams();
      if (severity) p.set("severity", severity);
      return api.delete(`/admin/error-log${p.size ? `?${p}` : ""}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["acp-error-log"] });
      swalToast(t("errorLog.cleared"), "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  const sevLabel = (s: string) => SEV_LABEL_KEY[s] ? t(SEV_LABEL_KEY[s]!) : s;

  const handleClear = async () => {
    const title = severity
      ? t("errorLog.confirmSeverity", { severity: sevLabel(severity) })
      : t("errorLog.confirmAll");
    const ok = await swalConfirm(title, t("errorLog.confirmBody"), t("errorLog.confirmBtn"));
    if (ok) clearMut.mutate();
  };

  return (
    <div>
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">{t("nav.system")}</div>
          <h1 className="acp-page-title">{t("errorLog.title")}</h1>
        </div>
        <button type="button" className="btn-ghost btn-sm" onClick={() => refetch()}>
          <FontAwesomeIcon icon={faRotateRight} />
        </button>
      </div>

      <div style={{ display:"flex", gap:10, marginBottom:20, flexWrap:"wrap" }}>
        <select className="acp-select" style={{ width:"auto" }} value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="">{t("errorLog.allSeverity")}</option>
          <option value="critical">{t("errorLog.sevCritical")}</option>
          <option value="error">{t("errorLog.sevError")}</option>
          <option value="warn">{t("errorLog.sevWarn")}</option>
          <option value="info">{t("errorLog.sevInfo")}</option>
        </select>
        <select className="acp-select" style={{ width:"auto" }} value={domain} onChange={(e) => setDomain(e.target.value)}>
          <option value="">{t("errorLog.allDomains")}</option>
          {DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <button type="button" className="btn-danger btn-sm" onClick={handleClear} disabled={clearMut.isPending} style={{ marginLeft:"auto" }}>
          <FontAwesomeIcon icon={faTrash} style={{ marginRight:5 }} />
          {severity ? t("errorLog.clearSeverity", { severity: sevLabel(severity) }) : t("errorLog.clearLog")}
        </button>
      </div>

      {isLoading ? (
        <div className="acp-card acp-empty">{t("errorLog.loading")}</div>
      ) : !data?.data.length ? (
        <div className="acp-card acp-empty">{t("errorLog.empty")}</div>
      ) : (
        <>
          <div className="acp-card" style={{ padding:0, overflow:"hidden" }}>
            {data.data.map((e, i) => {
              const color    = SEV_COLOR[e.severity] ?? "var(--c-fg-muted)";
              const isOpen   = expanded === e.id;
              const hasCtx   = e.context && Object.keys(e.context).length > 0;
              return (
                <div key={e.id}>
                  <div
                    onClick={() => setExpanded(isOpen ? null : e.id)}
                    style={{ display:"grid", gridTemplateColumns:"160px 1fr 80px 90px 80px", alignItems:"center", gap:12, padding:"13px 18px", borderBottom: i < data.data.length - 1 && !isOpen ? "1px solid var(--c-border)" : "none", cursor: hasCtx ? "pointer" : "default", transition:"background 0.12s" }}
                    onMouseEnter={(el) => { if (hasCtx) el.currentTarget.style.background = "var(--c-accent-soft)"; }}
                    onMouseLeave={(el) => el.currentTarget.style.background = "transparent"}
                  >
                    <div style={{ fontFamily:"monospace", fontSize:12, fontWeight:700, color:"var(--c-accent)" }}>{e.code}</div>
                    <div style={{ fontSize:13, color:"var(--c-fg-muted)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={e.message}>{e.message}</div>
                    <Badge label={sevLabel(e.severity)} color={color} />
                    <div style={{ fontSize:11, color:"var(--c-fg-muted)" }}>{timeAgo(e.createdAt)}</div>
                    <div style={{ fontSize:11, color:"var(--c-fg-muted)", fontFamily:"monospace" }}>
                      {e.requestId ? e.requestId.slice(0, 8) : "—"}
                    </div>
                  </div>
                  {isOpen && hasCtx && (
                    <div style={{ padding:"12px 18px", background:"var(--c-bg)", borderBottom: i < data.data.length - 1 ? "1px solid var(--c-border)" : "none" }}>
                      <pre style={{ margin:0, fontSize:12, color:"var(--c-fg-muted)", fontFamily:"monospace", whiteSpace:"pre-wrap", wordBreak:"break-all" }}>
                        {JSON.stringify(e.context, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ fontSize:12, color:"var(--c-fg-muted)", marginTop:10, textAlign:"right" }}>
            {t("errorLog.totalEntries", { count: data.meta.total })}
          </div>
        </>
      )}
    </div>
  );
}
