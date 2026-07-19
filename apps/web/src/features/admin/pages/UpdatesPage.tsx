import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCloudArrowDown, faCircleCheck, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { apiErrorMessage, swalToast } from "../../../lib/swal";

interface PluginUpdate {
  pluginId:          string;
  name?:             string;
  installedVersion?: string | null;
  latestVersion:     string;
  critical:          boolean;
  renewalRequired:   boolean;
  changelog?:        string;
}

export function UpdatesPage() {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<{ checkedAt: string | null; updates: PluginUpdate[] }>({
    queryKey:  ["acp-marketplace-updates"],
    queryFn:   () => api.get("/admin/marketplace/updates"),
    staleTime: 5 * 60_000,
  });

  // Update-in-place (§16.2): the server re-authorizes at the chokepoint, fetches +
  // sha256-verifies the newer artifact, and swaps it in — preserving enabled state.
  const updateMut = useMutation({
    mutationFn: (u: PluginUpdate) =>
      api.post("/admin/marketplace/update", { pluginId: u.pluginId, version: u.latestVersion }),
    onSuccess: (_res, u) => {
      void swalToast(t("updates.toastUpdated", { name: u.name ?? u.pluginId, version: u.latestVersion }), "success");
      // Refresh both the update list (the applied one drops off) and the installed
      // list (new version). The next daily check-in also reconciles the cache.
      void qc.invalidateQueries({ queryKey: ["acp-marketplace-updates"] });
      void qc.invalidateQueries({ queryKey: ["acp-installed-plugins"] });
    },
    onError: (err: unknown) => {
      void swalToast(t("updates.toastFailed", { message: apiErrorMessage(err) }), "error");
    },
  });

  const updates = data?.updates ?? [];

  return (
    <div>
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">{t("nav.extensions")}</div>
          <h1 className="acp-page-title">{t("updates.title")}</h1>
        </div>
      </div>

      {isLoading ? (
        <div className="acp-card acp-empty">{t("updates.loading")}</div>
      ) : updates.length === 0 ? (
        <div className="acp-card" style={{ padding: 40, textAlign: "center" }}>
          <FontAwesomeIcon icon={faCircleCheck} style={{ fontSize: 32, color: "var(--c-success)", marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--c-fg)", marginBottom: 6 }}>{t("updates.emptyTitle")}</div>
          <div style={{ fontSize: 13, color: "var(--c-fg-muted)" }}>
            {data?.checkedAt
              ? t("updates.emptyCheckedAt", { date: new Date(data.checkedAt).toLocaleString() })
              : t("updates.emptyHint")}
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[...updates].sort((a, b) => Number(b.critical) - Number(a.critical)).map((u) => {
              const busy   = updateMut.isPending && updateMut.variables?.pluginId === u.pluginId;
              const accent = u.critical ? "var(--c-danger)" : "var(--c-update, var(--c-accent))";
              return (
                <div key={u.pluginId} className="acp-card" style={{ padding: "20px 24px", display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap", border: u.critical ? `1px solid color-mix(in srgb, ${accent} 40%, transparent)` : undefined }}>
                  <div style={{ width: 44, height: 44, flexShrink: 0, background: `color-mix(in srgb, ${accent} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${accent} 34%, transparent)`, borderRadius: "var(--radius-md)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, color: accent }}>
                    <FontAwesomeIcon icon={u.critical ? faTriangleExclamation : faCloudArrowDown} />
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 15, fontWeight: 800, color: "var(--c-fg)" }}>{u.name ?? u.pluginId}</span>
                      <span style={{ fontSize: 12.5, color: "var(--c-fg-muted)", fontFamily: "var(--ff-mono, monospace)" }}>
                        {u.installedVersion ?? "?"} → {u.latestVersion}
                      </span>
                      {u.critical && (
                        <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 700, background: `color-mix(in srgb, ${accent} 18%, transparent)`, color: accent }}>
                          {t("updates.critical")}
                        </span>
                      )}
                    </div>
                    {u.changelog && (
                      <div style={{ fontSize: 13, color: "var(--c-fg-muted)", lineHeight: 1.6 }}>{u.changelog}</div>
                    )}
                    {u.renewalRequired && (
                      <div style={{ fontSize: 12.5, color: "var(--c-warn)", marginTop: 6, fontWeight: 600 }}>
                        <FontAwesomeIcon icon={faTriangleExclamation} style={{ marginRight: 6 }} />
                        {t("updates.renewalRequired")}
                      </div>
                    )}
                  </div>

                  <div style={{ flexShrink: 0 }}>
                    <button
                      type="button"
                      className="btn-primary btn-sm"
                      style={u.critical ? { background: accent, borderColor: accent } : undefined}
                      disabled={busy || u.renewalRequired}
                      onClick={() => updateMut.mutate(u)}
                    >
                      {busy ? t("updates.updating") : t("updates.update")}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
