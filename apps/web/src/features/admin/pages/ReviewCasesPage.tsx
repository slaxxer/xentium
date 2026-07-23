import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTriangleExclamation, faBan, faUserCheck, faRotateLeft, faShield, faNetworkWired } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { timeAgo } from "../../../lib/time";
import { swalToast, apiErrorMessage, swalConfirm } from "../../../lib/swal";
import { Username } from "../../../components/Username";

// ACP → Moderation → Review Cases. Core surface for §15 review cases — the
// baseline patterns (core) and any plugin scans (e.g. advanced-moderation)
// both open cases here via the shared /admin/cases endpoints.

type T = (key: string, opts?: Record<string, unknown>) => string;

interface ModerationCase {
  id: string; type: string; severity: string; status: string;
  signals: string[]; linkedUserIds: string[];
  linkedUsers:  { id: string; username: string; badgeColor: string | null }[];
  ipAddresses:  string[];
  notes:        string | null;
  createdAt: string;
}
interface CasesResponse { data: ModerationCase[]; meta: { total: number; totalPages: number } }
interface BanResult { userId: string; username: string; skipped: boolean; reason?: string }

const STATUS_TABS = [
  { value: "open",     key: "tabOpen"     },
  { value: "reviewed", key: "tabReviewed" },
] as const;

const TYPE_FILTERS = [
  { value: "multi_account_suspicion", key: "typeMulti"      },
  { value: "rapid_login_attempts",    key: "typeRapidLogin" },
  { value: "ban_evasion_suspicion",   key: "typeBanEvasion" },
  { value: "registration_burst",      key: "typeRegBurst"   },
] as const;

function Av({ name }: { name: string }) {
  return (
    <div style={{ width:22,height:22,borderRadius:"50%",flexShrink:0,background:"linear-gradient(135deg,var(--c-accent),var(--c-accent2))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,fontWeight:700,color:"#fff" }}>
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}

function humanizeSignal(s: string, t: T): string {
  const l = s.toLowerCase();
  if (l.includes("device cookie") || l.includes("shared by"))               return t("modCases.sig.sharedDevice");
  if (l.includes("failed login"))                                            return t("modCases.sig.rapidFailed");
  if ((l.includes("within") && l.includes("ban")) || l.includes("evasion"))  return t("modCases.sig.banEvasion");
  if (l.includes("registration") || l.includes("registrations"))            return t("modCases.sig.regBurst");
  if (l.includes("same ip") || l.includes("from ip") || (l.includes("from ") && l.includes(" ip"))) return t("modCases.sig.sameIp");
  return s;
}

function NoteInput({ initialNote, onSave }: { caseId: string; initialNote: string; onSave: (notes: string) => void }) {
  const { t } = useTranslation("acp");
  const [value, setValue] = useState(initialNote);
  const savedRef = useRef(initialNote);
  const handleBlur = () => {
    if (value !== savedRef.current) { savedRef.current = value; onSave(value); }
  };
  return (
    <div>
      <div style={{ fontSize:10, fontWeight:700, color:"var(--c-fg-muted)", letterSpacing:"0.09em", textTransform:"uppercase", marginBottom:5 }}>
        {t("modCases.modNote")}
      </div>
      <textarea
        value={value} onChange={(e) => setValue(e.target.value)} onBlur={handleBlur}
        placeholder={t("modCases.notePlaceholder")} rows={2}
        style={{ width:"100%", background:"var(--c-surface)", border:"1px solid var(--c-border)", borderRadius:"var(--radius-sm)", color:"var(--c-fg)", fontFamily:"inherit", fontSize:12, padding:"7px 10px", resize:"vertical", outline:"none", boxSizing:"border-box", transition:"border-color 0.15s" }}
        onFocus={(e) => (e.target.style.borderColor = "var(--c-accent)")}
      />
    </div>
  );
}

export function ReviewCasesPage() {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const [activeStatus, setActiveStatus] = useState<string>("open");
  const [activeType,   setActiveType]   = useState<string>("");

  const qs = new URLSearchParams({ limit: "20" });
  if (activeStatus) qs.set("status", activeStatus);
  if (activeType)   qs.set("type",   activeType);

  const { data, isLoading } = useQuery<CasesResponse>({
    queryKey: ["acp-cases", activeStatus, activeType],
    queryFn:  () => api.get(`/admin/cases?${qs.toString()}`),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/admin/cases/${id}`, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["acp-cases"] }); swalToast(t("modCases.toastReviewed"), "success"); },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });
  const banAllMut = useMutation({
    mutationFn: (caseId: string) => api.post<BanResult[]>(`/admin/cases/${caseId}/ban-all`, {}),
    onSuccess: (results) => {
      qc.invalidateQueries({ queryKey: ["acp-cases"] });
      const banned = results.filter((r) => !r.skipped).length;
      const skipped = results.filter((r) => r.skipped).length;
      swalToast(skipped ? t("modCases.toastBannedSkipped", { banned, skipped }) : t("modCases.toastBanned", { banned }), "success");
    },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });
  const notesMut = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes: string }) => api.patch(`/admin/cases/${id}/notes`, { notes }),
    onError: (e) => swalToast(apiErrorMessage(e)),
  });
  const revokeMut = useMutation({
    mutationFn: (caseId: string) => api.post(`/admin/cases/${caseId}/revoke-exception`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["acp-cases"] }); swalToast(t("modCases.toastExceptionRevoked"), "success"); },
    onError: (e) => swalToast(apiErrorMessage(e)),
  });

  const handleUpdate = async (id: string) => {
    if (await swalConfirm(t("modCases.grantTitle"), t("modCases.grantBody"), t("modCases.grantBtn"))) updateMut.mutate({ id, status: "reviewed" });
  };
  const handleRevoke = async (id: string) => {
    if (await swalConfirm(t("modCases.revokeTitle"), t("modCases.revokeBody"), t("modCases.revokeBtn"))) revokeMut.mutate(id);
  };
  const handleBanAll = async (c: ModerationCase) => {
    const names = (c.linkedUsers ?? []).map((u) => u.username).join(", ");
    if (await swalConfirm(t("modCases.banAllTitle"), t("modCases.banAllBody", { names: names || c.linkedUserIds.join(", ") }), t("modCases.banAllBtn"), t("common:actions.cancel"))) banAllMut.mutate(c.id);
  };

  return (
    <div>
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">{t("modCases.sub")}</div>
          <h1 className="acp-page-title">{t("modCases.title")}</h1>
        </div>
      </div>

      <div className="acp-tab-bar" style={{ marginBottom: 0 }}>
        {STATUS_TABS.map((tab) => (
          <button key={tab.value} type="button" className={`acp-tab${activeStatus === tab.value ? " acp-tab--active" : ""}`} onClick={() => setActiveStatus(tab.value)}>
            {t(`modCases.${tab.key}`)}
          </button>
        ))}
      </div>

      <div style={{ display:"flex",gap:6,flexWrap:"wrap",padding:"12px 0 16px" }}>
        {TYPE_FILTERS.map((tf) => {
          const active = activeType === tf.value;
          return (
            <button key={tf.value} type="button" onClick={() => setActiveType(active ? "" : tf.value)}
              style={{ background: active ? "var(--c-accent-soft)" : "transparent", color: active ? "var(--c-accent)" : "var(--c-fg-muted)", border:`1px solid ${active ? "var(--c-accent-glow)" : "var(--c-border)"}`, padding:"4px 12px", borderRadius:100, fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"inherit", transition:"all 0.15s" }}>
              {t(`modCases.${tf.key}`)}
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="acp-card acp-empty">{t("modCases.loading")}</div>
      ) : !data?.data.length ? (
        <div className="acp-card acp-empty">{t("modCases.empty")}</div>
      ) : (
        <>
          <div style={{ fontSize:12,color:"var(--c-fg-muted)",marginBottom:12 }}>{t("modCases.caseCount", { count: data.meta.total })}</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:12, maxWidth:1000 }}>
            {data.data.map((c) => {
              const signals = Array.isArray(c.signals) ? c.signals as string[] : [];
              const users   = c.linkedUsers ?? c.linkedUserIds.map((id) => ({ id, username: id, badgeColor: null }));
              const isOpen = c.status === "open";
              const isException = c.status === "reviewed";
              const busy = updateMut.isPending || banAllMut.isPending || revokeMut.isPending;
              const sevColor = c.severity === "high" ? "var(--c-danger)" : c.severity === "medium" ? "var(--c-warn)" : "var(--c-fg-muted)";
              const sevBg = c.severity === "high" ? "color-mix(in srgb, var(--c-danger) 10%, transparent)" : c.severity === "medium" ? "color-mix(in srgb, var(--c-warn) 10%, transparent)" : "transparent";
              const typeKey = TYPE_FILTERS.find((f) => f.value === c.type)?.key;
              const typeLabel = typeKey ? t(`modCases.${typeKey}`) : c.type.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
              return (
                <div key={c.id} style={{ borderRadius:"var(--radius-md)", border:"1px solid var(--c-border)", background:"var(--c-card)", padding:"14px 16px", display:"flex", flexDirection:"column", gap:10 }}>
                  <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:6 }}>
                    <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                      <span style={{ fontSize:13, fontWeight:700, color:"var(--c-fg)", lineHeight:1.2 }}>{typeLabel}</span>
                      <span style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"2px 7px", borderRadius:100, fontSize:10, fontWeight:800, width:"fit-content", background:sevBg, color:sevColor, border:`1px solid ${sevColor}30`, letterSpacing:"0.05em", textTransform:"uppercase" }}>
                        <FontAwesomeIcon icon={faShield} style={{ fontSize:8 }} />
                        {c.severity}
                        {isException && <span style={{ marginLeft:4, opacity:0.7 }}>· {t("modCases.exception")}</span>}
                      </span>
                    </div>
                    <span style={{ fontSize:10, color:"var(--c-fg-muted)", whiteSpace:"nowrap", marginTop:2 }}>{timeAgo(c.createdAt)}</span>
                  </div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                    {users.map((u) => (
                      <Link key={u.id} to={`/admin/users/${u.id}`} style={{ textDecoration:"none" }}>
                        <span style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"3px 8px 3px 3px", borderRadius:100, background:"var(--c-surface)", border:"1px solid var(--c-border)", fontSize:11, fontWeight:600, color:"var(--c-fg)" }}>
                          <Av name={u.username} />
                          <Username username={u.username} badgeColor={u.badgeColor} />
                        </span>
                      </Link>
                    ))}
                  </div>
                  {(signals.length > 0 || (c.ipAddresses ?? []).length > 0) && (
                    <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                      {signals.map((s, i) => (
                        <span key={i} style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"3px 8px", borderRadius:5, fontSize:10, fontWeight:600, background:"color-mix(in srgb, var(--c-warn) 10%, transparent)", color:"var(--c-warn)", border:"1px solid color-mix(in srgb, var(--c-warn) 22%, transparent)" }}>
                          <FontAwesomeIcon icon={faTriangleExclamation} style={{ fontSize:9 }} />
                          {humanizeSignal(s, t)}
                        </span>
                      ))}
                      {(c.ipAddresses ?? []).map((ip) => (
                        <span key={ip} style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"3px 8px", borderRadius:5, fontSize:10, fontWeight:600, fontFamily:"monospace", background:"color-mix(in srgb, var(--c-info) 10%, transparent)", color:"var(--c-info)", border:"1px solid color-mix(in srgb, var(--c-info) 22%, transparent)" }}>
                          <FontAwesomeIcon icon={faNetworkWired} style={{ fontSize:9, fontFamily:"inherit" }} />
                          {ip}
                        </span>
                      ))}
                    </div>
                  )}
                  <NoteInput caseId={c.id} initialNote={c.notes ?? ""} onSave={(notes) => notesMut.mutate({ id: c.id, notes })} />
                  {(isOpen || isException) && (
                    <div style={{ display:"flex", justifyContent:"flex-end", gap:6, paddingTop:8, borderTop:"1px solid var(--c-border)", marginTop:"auto" }}>
                      {isOpen && (
                        <>
                          <button type="button" className="btn-ghost btn-sm" style={{ color:"var(--c-success)", borderColor:"color-mix(in srgb, var(--c-success) 35%, transparent)", background:"var(--c-success-soft)", fontSize:11 }} disabled={busy} onClick={() => handleUpdate(c.id)}>
                            <FontAwesomeIcon icon={faUserCheck} /> {t("modCases.allow")}
                          </button>
                          <button type="button" className="btn-ghost btn-sm" style={{ color:"var(--c-danger)", borderColor:"color-mix(in srgb, var(--c-danger) 35%, transparent)", fontSize:11 }} disabled={busy} onClick={() => handleBanAll(c)}>
                            <FontAwesomeIcon icon={faBan} /> {t("modCases.banAll")}
                          </button>
                        </>
                      )}
                      {isException && (
                        <button type="button" className="btn-ghost btn-sm" style={{ color:"var(--c-warn)", borderColor:"color-mix(in srgb, var(--c-warn) 35%, transparent)", fontSize:11 }} disabled={busy} onClick={() => handleRevoke(c.id)}>
                          <FontAwesomeIcon icon={faRotateLeft} /> {t("modCases.revoke")}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
