import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "../../../components/Icon";
import { faCloudArrowDown, faCircleCheck, faTriangleExclamation, faShieldHalved } from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { runStreamedJob } from "../../../lib/streamProgress";
import "./UpdatesPage.scss";
import { siteTime } from "../../../lib/datetime";

interface PluginUpdate {
  pluginId:          string;
  name?:             string;
  installedVersion?: string | null;
  latestVersion:     string;
  critical:          boolean;
  renewalRequired:   boolean;
  changelog?:        string;
}

/** A published security advisory against a version this site runs. */
interface Advisory {
  id: string; pluginId: string; name: string;
  severity: "low" | "medium" | "high" | "critical" | string;
  affects: string; fixedIn: string | null; summary: string | null;
}

export function UpdatesPage() {
  const { t } = useTranslation("acp");
  const qc = useQueryClient();
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ checkedAt: string | null; updates: PluginUpdate[]; advisories?: Advisory[] }>({
    queryKey:  ["acp-marketplace-updates"],
    queryFn:   () => api.get("/admin/marketplace/updates"),
    staleTime: 5 * 60_000,
  });

  // Update-in-place (§16.2) with LIVE progress: the server streams ndjson step
  // events (authorize → download → verify → swap → migrate → enable) which drive
  // a progress dialog. The dialog is the whole feedback surface — no toast.
  // Update-in-place (§16.2) with LIVE progress: the server streams ndjson step
  // events (authorize → download → verify → swap → migrate → enable) which drive
  // a progress dialog. The dialog is the whole feedback surface — no toast.
  async function runUpdate(u: PluginUpdate) {
    const name = u.name ?? u.pluginId;
    setUpdatingId(u.pluginId);
    try {
      const { ok } = await runStreamedJob(
        "/admin/marketplace/update",
        { pluginId: u.pluginId, version: u.latestVersion },
        {
          icon:         u.critical ? "warning" : "update",
          title:        t("updates.progressTitle", { name }),
          startMessage: t("updates.phase.starting"),
          phaseLabel:   (phase, message) => {
            const label = t(`updates.phase.${phase}`, { defaultValue: t("updates.phase.working") });
            // e.g. downloaded-so-far when the artifact size is unknown
            return message ? `${label} ${message}` : label;
          },
          successMessage: (final) =>
            t("updates.progressDone", { name, version: (final.version as string) ?? u.latestVersion }),
          failureMessage: (final, err) =>
            (final?.message as string) ??
            (err instanceof Error ? err.message : t("updates.progressFailed")),
        },
      );
      if (ok) {
        void qc.invalidateQueries({ queryKey: ["acp-marketplace-updates"] });
        void qc.invalidateQueries({ queryKey: ["acp-installed-plugins"] });
        void qc.invalidateQueries({ queryKey: ["acp-status-summary"] });
      }
    } finally {
      setUpdatingId(null);
    }
  }

  const updates = data?.updates ?? [];
  const advisories = data?.advisories ?? [];

  return (
    <div>
      <div className="acp-page-header">
        <div className="acp-page-header__left">
          <div className="acp-page-sub">{t("nav.extensions")}</div>
          <h1 className="acp-page-title">{t("updates.title")}</h1>
        </div>
      </div>

      {advisories.length > 0 && <Advisories items={advisories} />}

      {isLoading ? (
        <div className="acp-card acp-empty">{t("updates.loading")}</div>
      ) : updates.length === 0 ? (
        <div className="acp-card" style={{ padding: 40, textAlign: "center" }}>
          <FontAwesomeIcon icon={faCircleCheck} style={{ fontSize: "2rem", color: "var(--c-success)", marginBottom: 12 }} />
          <div style={{ fontSize: "var(--fs-base)", fontWeight: 700, color: "var(--c-fg)", marginBottom: 6 }}>{t("updates.emptyTitle")}</div>
          <div style={{ fontSize: "var(--fs-sm)", color: "var(--c-fg-muted)" }}>
            {data?.checkedAt
              ? t("updates.emptyCheckedAt", { date: siteTime.stamp(data.checkedAt) })
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
                  <div style={{ width: 44, height: 44, flexShrink: 0, background: `color-mix(in srgb, ${accent} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${accent} 34%, transparent)`, borderRadius: "var(--radius-md)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "var(--fs-xl)", color: accent }}>
                    <FontAwesomeIcon icon={u.critical ? faTriangleExclamation : faCloudArrowDown} />
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                      <span style={{ fontSize: "var(--fs-base)", fontWeight: 800, color: "var(--c-fg)" }}>{u.name ?? u.pluginId}</span>
                      <span style={{ fontSize: "var(--fs-sm)", color: "var(--c-fg-muted)", fontFamily: "var(--ff-mono, monospace)" }}>
                        {u.installedVersion ?? "?"} → {u.latestVersion}
                      </span>
                      {u.critical && (
                        <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 100, fontSize: "var(--fs-2xs)", fontWeight: 700, background: `color-mix(in srgb, ${accent} 18%, transparent)`, color: accent }}>
                          {t("updates.critical")}
                        </span>
                      )}
                    </div>
                    {u.changelog && (
                      <div style={{ fontSize: "var(--fs-sm)", color: "var(--c-fg-muted)", lineHeight: 1.6 }}>{u.changelog}</div>
                    )}
                    {u.renewalRequired && (
                      <div style={{ fontSize: "var(--fs-sm)", color: "var(--c-warn)", marginTop: 6, fontWeight: 600 }}>
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

const SEVERITY_ORDER = ["critical", "high", "medium", "low"];

/**
 * Security advisories against what this site runs — what is wrong, which versions,
 * and the version that fixes it. Shown even when no update exists yet, because
 * "there is no fix, here is what to do meanwhile" is exactly when an admin needs it.
 */
function Advisories({ items }: { items: Advisory[] }) {
  const { t } = useTranslation("acp");
  const sorted = [...items].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  return (
    <div className="acp-card upd-adv">
      <div className="upd-adv__head">
        <FontAwesomeIcon icon={faShieldHalved} />
        <span>{t("updates.advisories.title", { count: items.length })}</span>
      </div>
      {sorted.map((a) => (
        <div key={a.id} className={`upd-adv__row upd-adv__row--${a.severity}`}>
          <div className="upd-adv__line">
            <strong>{a.name}</strong>
            <span className="upd-adv__sev">{t(`updates.advisories.severity.${a.severity}`, { defaultValue: a.severity })}</span>
            <code>{a.id}</code>
          </div>
          <div className="upd-adv__meta">
            {t("updates.advisories.affects", { range: a.affects })}
            {" · "}
            {a.fixedIn ? t("updates.advisories.fixedIn", { version: a.fixedIn }) : t("updates.advisories.noFix")}
          </div>
          {a.summary && <p className="upd-adv__text">{a.summary}</p>}
        </div>
      ))}
    </div>
  );
}
