import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPuzzlePiece, faUpload, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { swalToast, apiErrorMessage, swalConfirm } from "../../../lib/swal";
import { ExtensionsUpdateBanner } from "../components/ExtensionsUpdateBanner";
import { useUploadAllowed, UPLOAD_ALLOWED_KEY } from "../hooks/useUploadAllowed";

interface InstalledPlugin {
  id:               string;
  name:             string;
  vendor:           string;
  installedVersion: string;
  status:           string;
  licenseRequired:  boolean;
  installedAt:      string;
  loadError:        { hook: string; message: string; at: string } | null;
}

const STATUS_COLOR: Record<string, string> = {
  enabled:   "var(--c-success)",
  disabled:  "var(--c-fg-muted)",
  installed: "var(--c-accent)",
};

function Badge({ label, color = "var(--c-accent)" }: { label: string; color?: string }) {
  return (
    <span style={{ display:"inline-flex", alignItems:"center", padding:"3px 10px", borderRadius:100, fontSize:11, fontWeight:700, background:`${color}20`, color }}>
      {label}
    </span>
  );
}

export function InstalledPage() {
  const { t } = useTranslation("acp");
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: plugins = [], isLoading } = useQuery<InstalledPlugin[]>({
    queryKey: ["acp-installed-plugins"],
    queryFn:  () => api.get("/plugins"),
  });

  const { data: uploadAllowed } = useUploadAllowed();
  const toggleUploadMut = useMutation({
    mutationFn: (val: boolean) => api.put("/admin/settings/plugins.allow_upload", { value: val }),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: UPLOAD_ALLOWED_KEY }); },
    onError:    (e) => swalToast(apiErrorMessage(e)),
  });

  const enableMut = useMutation({
    mutationFn: (id: string) => api.post(`/plugins/${id}/enable`, {}),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ["acp-installed-plugins"] }); swalToast(t("installed.toastEnabled"), "success"); },
    onError:    (e) => swalToast(apiErrorMessage(e)),
  });

  const disableMut = useMutation({
    mutationFn: (id: string) => api.post(`/plugins/${id}/disable`, {}),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ["acp-installed-plugins"] }); swalToast(t("installed.toastDisabled"), "success"); },
    onError:    (e) => swalToast(apiErrorMessage(e)),
  });

  const removeMut = useMutation({
    mutationFn: ({ id, removeData }: { id: string; removeData: boolean }) =>
      api.delete(`/plugins/${id}?removeData=${removeData}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["acp-installed-plugins"] }); swalToast(t("installed.toastRemoved"), "success"); },
    onError:   (e) => swalToast(apiErrorMessage(e)),
  });

  const handleRemove = async (p: InstalledPlugin) => {
    const ok = await swalConfirm(
      t("installed.removeTitle", { name: p.name }),
      t("installed.removeText"),
      t("installed.remove"),
    );
    if (!ok) return;

    const removeData = await swalConfirm(
      t("installed.removeDataTitle"),
      t("installed.removeDataText"),
      t("installed.removeDataConfirm"),
    );
    removeMut.mutate({ id: p.id, removeData });
  };

  return (
    <div>
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">{t("nav.extensions")}</div>
          <h1 className="acp-page-title">{t("installed.title")}</h1>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          <label style={{ display:"flex", alignItems:"center", gap:7, fontSize:12.5, color:"var(--c-fg-muted)", cursor:"pointer" }} title={t("installed.allowUploadHint")}>
            <input
              type="checkbox"
              checked={uploadAllowed === true}
              onChange={(e) => toggleUploadMut.mutate(e.target.checked)}
              disabled={toggleUploadMut.isPending}
            />
            {t("installed.allowUpload")}
          </label>
          {uploadAllowed === true && (
            <button type="button" className="btn-ghost btn-sm" onClick={() => navigate("/admin/upload")}>
              <FontAwesomeIcon icon={faUpload} style={{ marginRight:5 }} /> {t("installed.uploadBtn")}
            </button>
          )}
        </div>
      </div>

      <ExtensionsUpdateBanner />

      {isLoading ? (
        <div className="acp-card acp-empty">{t("installed.loading")}</div>
      ) : plugins.length === 0 ? (
        <div className="acp-card" style={{ padding:40, textAlign:"center" }}>
          <FontAwesomeIcon icon={faPuzzlePiece} style={{ fontSize:32, color:"var(--c-fg-muted)", marginBottom:12 }} />
          <div style={{ fontSize:15, fontWeight:700, color:"var(--c-fg)", marginBottom:6 }}>{t("installed.emptyTitle")}</div>
          <div style={{ fontSize:13, color:"var(--c-fg-muted)", marginBottom:20 }}>
            {t("installed.emptyHint")}
          </div>
          {uploadAllowed === true ? (
            <button type="button" className="btn-primary btn-sm" onClick={() => navigate("/admin/upload")}>
              {t("installed.uploadBtn")}
            </button>
          ) : (
            <button type="button" className="btn-primary btn-sm" onClick={() => navigate("/admin/marketplace")}>
              {t("installed.emptyBrowseMarketplace")}
            </button>
          )}
        </div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          {plugins.map((p) => {
            const busy = enableMut.isPending || disableMut.isPending || removeMut.isPending;
            // Enabled in the DB but its onEnable/import threw → registered nothing.
            const failed = p.status === "enabled" && !!p.loadError;
            return (
              <div key={p.id} className="acp-card" style={{ padding:"20px 24px", display:"flex", alignItems:"center", gap:16, flexWrap:"wrap", border: failed ? "1px solid var(--c-danger)" : undefined }}>
                <div style={{ width:44, height:44, flexShrink:0, background: failed ? "var(--c-danger-soft, rgba(248,113,113,.14))" : "var(--c-accent-soft)", border: failed ? "1px solid var(--c-danger)" : "1px solid var(--c-accent-glow)", borderRadius:"var(--radius-md)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, color: failed ? "var(--c-danger)" : "var(--c-accent)" }}>
                  <FontAwesomeIcon icon={failed ? faTriangleExclamation : faPuzzlePiece} />
                </div>

                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4, flexWrap:"wrap" }}>
                    <span style={{ fontSize:15, fontWeight:800, color:"var(--c-fg)" }}>{p.name}</span>
                    <span style={{ fontSize:12, color:"var(--c-fg-muted)" }}>v{p.installedVersion}</span>
                    {p.licenseRequired && <Badge label={t("installed.licensed")} color="var(--c-warn)" />}
                  </div>
                  <div style={{ fontSize:12, color:"var(--c-fg-muted)" }}>
                    {t("installed.meta", { id: p.id, vendor: p.vendor, date: new Date(p.installedAt).toLocaleDateString() })}
                  </div>
                </div>

                <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
                  {failed && <Badge label={t("installed.loadFailed", { defaultValue: "Failed to load" })} color="var(--c-danger)" />}
                  <Badge label={t(`installed.status.${p.status}`, { defaultValue: p.status })} color={STATUS_COLOR[p.status] ?? "var(--c-fg-muted)"} />

                  {p.status === "enabled" ? (
                    <button type="button" className="btn-ghost btn-sm" onClick={() => disableMut.mutate(p.id)} disabled={busy}>
                      {t("installed.disable")}
                    </button>
                  ) : (
                    <button type="button" className="btn-ghost btn-sm" style={{ color:"var(--c-accent)", borderColor:"var(--c-accent-glow)", background:"var(--c-accent-soft)" }} onClick={() => enableMut.mutate(p.id)} disabled={busy}>
                      {t("installed.enable")}
                    </button>
                  )}

                  <button type="button" className="btn-danger btn-sm" onClick={() => handleRemove(p)} disabled={busy}>
                    {t("installed.remove")}
                  </button>
                </div>

                {failed && (
                  <div style={{ flexBasis:"100%", marginTop:4, padding:"10px 12px", borderRadius:"var(--radius-md)", background:"var(--c-danger-soft, rgba(248,113,113,.10))", border:"1px solid var(--c-danger)" }}>
                    <div style={{ fontSize:12.5, fontWeight:700, color:"var(--c-danger)", marginBottom:3 }}>
                      <FontAwesomeIcon icon={faTriangleExclamation} style={{ marginRight:6 }} />
                      {t("installed.loadFailedTitle", { defaultValue: "This plugin is enabled but failed to load — its routes and pages are not active." })}
                    </div>
                    <div style={{ fontSize:12, color:"var(--c-fg-muted)", fontFamily:"var(--ff-mono, monospace)", wordBreak:"break-word" }}>
                      {p.loadError!.message}
                    </div>
                    <div style={{ fontSize:11.5, color:"var(--c-fg-subtle)", marginTop:4 }}>
                      {t("installed.loadFailedHint", { defaultValue: "Disable then re-enable to retry, or re-upload a fixed build." })}
                    </div>
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
