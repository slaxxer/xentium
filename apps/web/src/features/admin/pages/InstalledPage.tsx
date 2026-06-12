import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPuzzlePiece, faUpload } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { swalToast, apiErrorMessage, swalConfirm } from "../../../lib/swal";

interface InstalledPlugin {
  id:               string;
  name:             string;
  vendor:           string;
  installedVersion: string;
  status:           string;
  licenseRequired:  boolean;
  installedAt:      string;
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
        <button type="button" className="btn-ghost btn-sm" onClick={() => navigate("/admin/upload")}>
          <FontAwesomeIcon icon={faUpload} style={{ marginRight:5 }} /> {t("installed.uploadBtn")}
        </button>
      </div>

      {isLoading ? (
        <div className="acp-card acp-empty">{t("installed.loading")}</div>
      ) : plugins.length === 0 ? (
        <div className="acp-card" style={{ padding:40, textAlign:"center" }}>
          <FontAwesomeIcon icon={faPuzzlePiece} style={{ fontSize:32, color:"var(--c-fg-muted)", marginBottom:12 }} />
          <div style={{ fontSize:15, fontWeight:700, color:"var(--c-fg)", marginBottom:6 }}>{t("installed.emptyTitle")}</div>
          <div style={{ fontSize:13, color:"var(--c-fg-muted)", marginBottom:20 }}>
            {t("installed.emptyHint")}
          </div>
          <button type="button" className="btn-primary btn-sm" onClick={() => navigate("/admin/upload")}>
            {t("installed.uploadBtn")}
          </button>
        </div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          {plugins.map((p) => {
            const busy = enableMut.isPending || disableMut.isPending || removeMut.isPending;
            return (
              <div key={p.id} className="acp-card" style={{ padding:"20px 24px", display:"flex", alignItems:"center", gap:16 }}>
                <div style={{ width:44, height:44, flexShrink:0, background:"var(--c-accent-soft)", border:"1px solid var(--c-accent-glow)", borderRadius:"var(--radius-md)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, color:"var(--c-accent)" }}>
                  <FontAwesomeIcon icon={faPuzzlePiece} />
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
