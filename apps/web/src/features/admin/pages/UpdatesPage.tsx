import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCloudArrowDown, faCircleCheck, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { api, apiStream } from "../../../lib/api";
import { openProgressDialog } from "../../../lib/dialog";

interface PluginUpdate {
  pluginId:          string;
  name?:             string;
  installedVersion?: string | null;
  latestVersion:     string;
  critical:          boolean;
  renewalRequired:   boolean;
  changelog?:        string;
}

interface ProgressEvent {
  phase?:   string;
  percent?: number;
  message?: string;
  done?:    boolean;
  ok?:      boolean;
  version?: string;
}

export function UpdatesPage() {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ checkedAt: string | null; updates: PluginUpdate[] }>({
    queryKey:  ["acp-marketplace-updates"],
    queryFn:   () => api.get("/admin/marketplace/updates"),
    staleTime: 5 * 60_000,
  });

  // Update-in-place (§16.2) with LIVE progress: the server streams ndjson step
  // events (authorize → download → verify → swap → migrate → enable) which drive
  // a progress dialog. The dialog is the whole feedback surface — no toast.
  async function runUpdate(u: PluginUpdate) {
    const name = u.name ?? u.pluginId;
    const dlg = openProgressDialog({
      icon:    u.critical ? "warning" : "update",
      title:   t("updates.progressTitle", { name }),
      message: t("updates.phase.starting"),
    });
    setUpdatingId(u.pluginId);
    try {
      const res = await apiStream("/admin/marketplace/update", { pluginId: u.pluginId, version: u.latestVersion });
      if (!res.ok || !res.body) throw new Error(`http_${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let final: ProgressEvent | null = null;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const evt = JSON.parse(line) as ProgressEvent;
          if (evt.done) { final = evt; continue; }
          let label = t(`updates.phase.${evt.phase}`, { defaultValue: t("updates.phase.working") });
          if (evt.message) label = `${label} ${evt.message}`; // e.g. downloaded-so-far when size is unknown
          dlg.update(evt.percent ?? 0, label);
        }
      }

      if (final?.ok) {
        dlg.succeed(t("updates.progressDone", { name, version: final.version ?? u.latestVersion }));
        void qc.invalidateQueries({ queryKey: ["acp-marketplace-updates"] });
        void qc.invalidateQueries({ queryKey: ["acp-installed-plugins"] });
        void qc.invalidateQueries({ queryKey: ["acp-status-summary"] });
      } else {
        dlg.fail(final?.message ?? t("updates.progressFailed"));
      }
    } catch (err) {
      dlg.fail(err instanceof Error ? err.message : t("updates.progressFailed"));
    } finally {
      setUpdatingId(null);
    }
  }

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
              const busy   = updatingId === u.pluginId;
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
                      disabled={busy || updatingId !== null || u.renewalRequired}
                      onClick={() => void runUpdate(u)}
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
