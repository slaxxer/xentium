import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBagShopping, faCheck, faCircleExclamation, faDownload,
  faArrowUpRightFromSquare, faPuzzlePiece, faPalette,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../../../lib/api";
import { runStreamedJob } from "../../../lib/streamProgress";

/**
 * What this site's marketplace account owns.
 *
 * The distinction this component exists to draw: an ENTITLEMENT is what the
 * signed JWT currently grants this install, a LICENCE is what the account
 * bought. They are usually the same set, and the times they differ are the
 * times an admin needs to see — a plugin bought minutes ago, a seat spent on
 * another site, an updates window that ran out while the plugin kept running.
 */

interface OwnedLicense {
  keyRef:           string;
  status:           string;
  seats:            number | null;
  seatsUsed:        number;
  activeHere:       boolean;
  updatesUntil:     string | null;
  purchasedAt:      string;
  installedVersion: string | null;
  installedStatus:  string | null;
  updateAvailable:  boolean;
  product: {
    id:            string;
    kind:          "plugin" | "theme";
    name:          string;
    vendor:        string;
    summary:       string | null;
    latestVersion: string | null;
  };
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function OwnedLicenses({ connected }: { connected: boolean }) {
  const { t } = useTranslation("acp");
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery<{ licenses: OwnedLicense[] }>({
    queryKey: ["acp-marketplace-owned"],
    queryFn:  () => api.get("/admin/marketplace/owned"),
    // Nothing to ask without an account, and asking anyway just renders the
    // "connect first" error under a card that already says so.
    enabled:  connected,
  });

  const installMut = useMutation({
    mutationFn: async (l: OwnedLicense) => {
      const { ok } = await runStreamedJob(
        "/admin/marketplace/install",
        { pluginId: l.product.id, version: l.product.latestVersion },
        {
          icon:         "update",
          title:        t("owned.installTitle", { name: l.product.name }),
          startMessage: t("marketplace.phase.starting"),
          phaseLabel:   (phase, message) => {
            const label = t(`marketplace.phase.${phase}`, { defaultValue: t("marketplace.phase.working") });
            return message ? `${label} ${message}` : label;
          },
          successMessage: () => t("marketplace.progressDone", { name: l.product.name }),
          failureMessage: (final, err) =>
            (final?.message as string) ?? (err instanceof Error ? err.message : t("marketplace.progressFailed")),
        },
      );
      if (!ok) throw new Error("install_failed");
      return ok;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["acp-marketplace-owned"] });
      void qc.invalidateQueries({ queryKey: ["acp-installed-plugins"] });
    },
    onError: () => {},
  });

  if (!connected) return null;

  const licenses = data?.licenses ?? [];

  return (
    <div className="acp-card" style={{ padding: 24, marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <FontAwesomeIcon icon={faBagShopping} style={{ color: "var(--c-accent)" }} />
        <div style={{ fontSize: 15, fontWeight: 800, color: "var(--c-fg)" }}>{t("owned.title")}</div>
        {licenses.length > 0 && (
          <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: "var(--c-fg-muted)" }}>
            {t("owned.count", { count: licenses.length })}
          </span>
        )}
      </div>
      <div style={{ fontSize: 13, color: "var(--c-fg-muted)", marginBottom: 16 }}>{t("owned.desc")}</div>

      {isLoading ? (
        <div className="acp-empty">{t("license.loading")}</div>
      ) : error ? (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "10px 14px", fontSize: 13, color: "var(--c-warn)", background: "color-mix(in srgb, var(--c-warn) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--c-warn) 30%, transparent)", borderRadius: "var(--radius-sm)" }}>
          <FontAwesomeIcon icon={faCircleExclamation} style={{ marginTop: 2, flexShrink: 0 }} />
          {t("owned.unreachable")}
        </div>
      ) : licenses.length === 0 ? (
        <div className="acp-empty" style={{ padding: "18px 0" }}>
          <div style={{ fontSize: 13, color: "var(--c-fg-muted)", marginBottom: 10 }}>{t("owned.empty")}</div>
          <button type="button" className="btn-ghost btn-sm" onClick={() => navigate("/admin/marketplace")}>
            <FontAwesomeIcon icon={faArrowUpRightFromSquare} style={{ marginRight: 5 }} />
            {t("owned.browse")}
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {licenses.map((l) => {
            const updatesLapsed = !!l.updatesUntil && new Date(l.updatesUntil) < new Date();
            // A seat is only spent by a production install, so an unlimited
            // licence (seats === null) never shows a ratio it can't exceed.
            const seatsFull = l.seats !== null && l.seatsUsed >= l.seats && !l.activeHere;

            return (
              <div
                key={l.keyRef}
                style={{
                  display: "flex", alignItems: "center", gap: 14,
                  background: "var(--c-surface)", border: "1px solid var(--c-border)",
                  borderRadius: "var(--radius-sm)", padding: "14px 16px",
                }}
              >
                <FontAwesomeIcon
                  icon={l.product.kind === "theme" ? faPalette : faPuzzlePiece}
                  style={{ fontSize: 16, color: "var(--c-fg-muted)", flexShrink: 0 }}
                />

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "var(--c-fg)" }}>{l.product.name}</span>
                    {l.activeHere && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 100, fontSize: 10, fontWeight: 700, background: "color-mix(in srgb, var(--c-success) 15%, transparent)", color: "var(--c-success)" }}>
                        <FontAwesomeIcon icon={faCheck} /> {t("owned.activeHere")}
                      </span>
                    )}
                    {updatesLapsed && (
                      <span style={{ padding: "2px 8px", borderRadius: 100, fontSize: 10, fontWeight: 700, background: "color-mix(in srgb, var(--c-warn) 15%, transparent)", color: "var(--c-warn)" }}>
                        {t("owned.updatesLapsed")}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--c-fg-muted)", display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <span>{l.keyRef}</span>
                    <span>
                      {l.seats === null
                        ? t("owned.seatsUnlimited")
                        : t("owned.seats", { used: l.seatsUsed, total: l.seats })}
                    </span>
                    {l.updatesUntil && <span>{t("owned.updatesUntil", { date: fmtDate(l.updatesUntil) })}</span>}
                    {l.installedVersion && (
                      <span>
                        {l.updateAvailable
                          ? t("owned.versionUpdate", { installed: l.installedVersion, latest: l.product.latestVersion })
                          : t("owned.version", { version: l.installedVersion })}
                      </span>
                    )}
                  </div>
                </div>

                {/* One action per row, and only the one that applies. "Owned but
                    not installed here" is the case this whole panel exists for. */}
                {l.installedVersion ? (
                  <button type="button" className="btn-ghost btn-sm" onClick={() => navigate("/admin/installed")}>
                    {t("owned.manage")}
                  </button>
                ) : seatsFull ? (
                  <span style={{ fontSize: 12, color: "var(--c-warn)", fontWeight: 600 }}>{t("owned.noSeat")}</span>
                ) : l.product.kind === "theme" ? (
                  <button type="button" className="btn-ghost btn-sm" onClick={() => navigate("/admin/themes")}>
                    {t("owned.themes")}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    style={{ color: "var(--c-accent)", borderColor: "var(--c-accent-glow)", background: "var(--c-accent-soft)" }}
                    disabled={installMut.isPending || !l.product.latestVersion}
                    onClick={() => installMut.mutate(l)}
                  >
                    <FontAwesomeIcon icon={faDownload} style={{ marginRight: 5 }} />
                    {installMut.isPending && installMut.variables?.product.id === l.product.id
                      ? t("marketplace.installing")
                      : t("owned.install")}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
