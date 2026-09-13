import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FontAwesomeIcon } from "../../../components/Icon";
import {
  faBagShopping, faCheck, faCloudArrowDown, faDownload, faArrowUp, faLock,
  faBan, faCircle, faSliders, faArrowUpRightFromSquare, faPuzzlePiece, faPalette,
} from "@fortawesome/free-solid-svg-icons";
import { runStreamedJob } from "../../../lib/streamProgress";
import { toast } from "../../../lib/toast";
import { themeInstallMessage } from "../hooks/themeInstallResult";

/**
 * What this site's marketplace account owns, and where each licence stands here.
 *
 * The distinction this component exists to draw: an ENTITLEMENT is what the
 * signed JWT currently grants this install, a LICENCE is what the account
 * bought. They are usually the same set, and the times they differ are the
 * times an admin needs to see — a plugin bought minutes ago, a seat spent on
 * another site, an updates window that ran out while the plugin kept running.
 *
 * Presentational: the query lives in LicensePage so the hero, this table and the
 * rail cannot disagree about whether the marketplace answered.
 */

export interface OwnedLicense {
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
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** A seat is only spent by a production install, so an unlimited licence
 *  (seats === null) never shows a ratio it cannot exceed. */
export const seatsFull = (l: OwnedLicense) =>
  l.seats !== null && l.seatsUsed >= l.seats && !l.activeHere;

/**
 * Granted here AND actually present here.
 *
 * `activeHere` alone is the marketplace's answer — "a seat is bound to this
 * install" — which is true the moment a licence activates, before any files
 * exist locally. Reading it as "Active" gave a row a green tick next to an
 * INSTALL button, and counted it in the rail's "active here" total. The
 * activation and the install are two different facts and the row has to state
 * both to be worth anything.
 *
 * An expired site licence locks every row regardless of what the row says.
 */
export const rowIsLive = (l: OwnedLicense, expired: boolean) =>
  !expired && l.activeHere && !!l.installedVersion;

const isThemeRow = (l: OwnedLicense) => l.product.kind === "theme";

const hasUpdate = (l: OwnedLicense) =>
  l.updateAvailable && !!l.installedVersion && l.installedVersion !== l.product.latestVersion;

export function OwnedLicenses({
  connected, licenses, isLoading, unreachable, expired, liveCount, onChanged,
}: {
  connected:   boolean;
  licenses:    OwnedLicense[];
  isLoading:   boolean;
  unreachable: boolean;
  expired:     boolean;
  liveCount:   number;
  onChanged:   () => void;
}) {
  const { t } = useTranslation("acp");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Which row is streaming, and how far along. Inline rather than the shared
  // progress dialog: the row IS the thing being installed, and the admin is
  // already looking at it.
  const [progress, setProgress] = useState<{ id: string; pct: number; phase: string } | null>(null);

  const installMut = useMutation({
    mutationFn: async (l: OwnedLicense) => {
      setProgress({ id: l.product.id, pct: 4, phase: t("marketplace.phase.starting") });
      const { ok, final } = await runStreamedJob(
        "/admin/marketplace/install",
        // ⚠ `kind` is not optional here in practice. The endpoint defaults it to
        // "plugin", so an owned THEME installed from this panel ran the plugin
        // intake over a `.xttheme` and failed on the manifest — the row is the one
        // place that knows which half of the catalogue it is looking at.
        { pluginId: l.product.id, version: l.product.latestVersion, kind: l.product.kind },
        {
          silent:       true,
          title:        t("owned.installTitle", { name: l.product.name }),
          startMessage: t("marketplace.phase.starting"),
          onProgress:   (e) => setProgress({
            id:    l.product.id,
            pct:   typeof e.percent === "number" ? e.percent : 4,
            phase: t(`marketplace.phase.${e.phase}`, { defaultValue: t("marketplace.phase.working") }),
          }),
          phaseLabel:   (phase, message) => {
            const label = t(`marketplace.phase.${phase}`, { defaultValue: t("marketplace.phase.working") });
            return message ? `${label} ${message}` : label;
          },
          successMessage: (f) => isThemeRow(l)
            ? themeInstallMessage(t, l.product.name, f)
            : t("marketplace.progressDone", { name: l.product.name }),
          failureMessage: (f, err) =>
            (f?.message as string) ?? (err instanceof Error ? err.message : t("marketplace.progressFailed")),
        },
      );
      // `silent` means nothing else reports the outcome — see StreamedJobOptions.
      if (!ok) {
        throw new Error((final?.message as string) ?? t("marketplace.progressFailed"));
      }
      // `silent` means the dialog reported nothing, so this toast IS the outcome —
      // including what the import had to leave out.
      toast.success(isThemeRow(l)
        ? themeInstallMessage(t, l.product.name, final)
        : t("marketplace.progressDone", { name: l.product.name }));
      return ok;
    },
    onSettled: () => setProgress(null),
    onSuccess: (_ok, l) => {
      onChanged();
      // A theme install is the appearance import, wherever it was started from —
      // the same set the Marketplace page and the Themes page invalidate. Without
      // this the panel says "installed" while the ACP still shows the old theme.
      if (isThemeRow(l)) {
        for (const key of [
          "acp-theme-installed", "acp-layout", "acp-layout-status",
          "acp-layout-templates", "acp-tokens",
        ]) void queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    onError:   (e: unknown) => toast.error(e instanceof Error ? e.message : t("marketplace.progressFailed")),
  });

  if (!connected) return null;

  const notice = unreachable ? {
    icon:  faCloudArrowDown,
    color: "var(--c-warn)",
    title: t("owned.unreachableTitle"),
    body:  t("owned.unreachable"),
    label: t("owned.retry"),
    run:   onChanged,
  } : licenses.length === 0 ? {
    icon:  faBagShopping,
    color: "var(--c-fg-subtle)",
    title: t("owned.emptyTitle"),
    body:  t("owned.empty"),
    label: t("owned.browse"),
    run:   () => navigate("/admin/marketplace"),
  } : null;

  return (
    <section className="lic-card">
      <div className="lic-sec__head">
        <div className="lic-sec__title">
          <FontAwesomeIcon icon={faBagShopping} />
          {t("owned.title")}
          {licenses.length > 0 && (
            <span className="lic-sec__count">
              {t("owned.countLive", { total: licenses.length, live: liveCount })}
            </span>
          )}
        </div>
        <div className="lic-sec__desc">{t("owned.desc")}</div>
      </div>

      {isLoading ? (
        <div className="lic-notice">{t("license.loading")}</div>
      ) : licenses.length > 0 && (
        <div className="lic-tablewrap">
          <div className="lic-row lic-row--head">
            <div>{t("owned.colProduct")}</div>
            <div>{t("owned.colSeats")}</div>
            <div>{t("owned.colUpdates")}</div>
            <div>{t("owned.colHere")}</div>
            <div />
          </div>

          {licenses.map((l) => {
            const updatesLapsed = !!l.updatesUntil && new Date(l.updatesUntil) < new Date();
            const noSeat = seatsFull(l);
            const installing = progress?.id === l.product.id;

            // Order matters: an expired site licence locks a row that would
            // otherwise read "Active", which is the whole point of showing it.
            const state =
              expired && l.installedVersion
                ? { label: t("owned.stateLocked"), icon: faLock, tone: "var(--c-danger)", bg: "color-mix(in srgb, var(--c-danger) 12%, transparent)" }
              : rowIsLive(l, expired) && hasUpdate(l)
                ? { label: t("owned.stateUpdate", { version: l.product.latestVersion }), icon: faArrowUp, tone: "var(--c-accent)", bg: "var(--c-accent-soft)" }
              : rowIsLive(l, expired)
                ? { label: t("owned.stateActive"), icon: faCheck, tone: "var(--c-success)", bg: "var(--c-success-soft)" }
              : noSeat
                ? { label: t("owned.stateNoSeat"), icon: faBan, tone: "var(--c-warn)", bg: "color-mix(in srgb, var(--c-warn) 14%, transparent)" }
                : { label: t("owned.stateInactive"), icon: faCircle, tone: "var(--c-fg-muted)", bg: "var(--c-bg)" };

            // A theme row used to fall through to "Themes" INSTEAD of installing,
            // because `installedVersion` was always null for a theme and the panel
            // had no way to fetch one. Now that the row knows what the site wears,
            // a theme installs and updates from here like anything else — and the
            // Themes link is what it was always meant to be: where you go once it
            // is already installed.
            const isTheme = l.product.kind === "theme";
            const action =
              hasUpdate(l)
                ? { label: t("owned.update"), icon: faArrowUp, primary: true,  run: () => installMut.mutate(l) }
              : l.installedVersion
                ? isTheme
                  ? { label: t("owned.themes"), icon: faPalette, primary: false, run: () => navigate("/admin/themes") }
                  : { label: t("owned.manage"), icon: faSliders, primary: false, run: () => navigate("/admin/installed") }
              : noSeat
                ? { label: t("owned.noSeat"), icon: faBan, primary: false, disabled: true, run: () => {} }
                : { label: t("owned.install"), icon: faDownload, primary: true, run: () => installMut.mutate(l) };

            return (
              <div className="lic-row lic-row--item" key={l.keyRef}>
                <div className="lic-row__product">
                  <FontAwesomeIcon
                    className="lic-row__kind"
                    icon={l.product.kind === "theme" ? faPalette : faPuzzlePiece}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div className="lic-row__name">{l.product.name}</div>
                    <div className="lic-row__key">{l.keyRef}</div>
                  </div>
                </div>

                <div className={`lic-row__cell${noSeat ? " is-warn" : ""}`}>
                  {l.seats === null
                    ? t("owned.seatsUnlimited")
                    : t("owned.seatsShort", { used: l.seatsUsed, total: l.seats })}
                </div>

                <div className={`lic-row__cell${updatesLapsed ? " is-warn" : ""}`}>
                  {updatesLapsed
                    ? t("owned.updatesLapsed")
                    : l.updatesUntil ? fmtDate(l.updatesUntil) : t("owned.updatesNone")}
                </div>

                <div className="lic-row__state">
                  <span className="lic-chip" style={{ background: state.bg, color: state.tone }}>
                    <FontAwesomeIcon icon={state.icon} />
                    {state.label}
                  </span>
                </div>

                <div className="lic-row__action">
                  {installing ? (
                    <div className="lic-progress">
                      <div className="lic-progress__track">
                        <div className="lic-progress__bar" style={{ width: `${Math.round(progress!.pct)}%` }} />
                      </div>
                      <div className="lic-progress__phase">{progress!.phase}</div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={`${action.primary ? "btn-primary" : "btn-ghost"} btn-sm`}
                      disabled={!!action.disabled || installMut.isPending || (action.primary && !l.product.latestVersion)}
                      onClick={action.run}
                    >
                      <FontAwesomeIcon icon={action.icon} style={{ marginRight: 6 }} />
                      {action.label}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {notice && !isLoading && (
        <div className="lic-notice">
          <FontAwesomeIcon icon={notice.icon} className="lic-notice__icon" style={{ color: notice.color }} />
          <div className="lic-notice__title">{notice.title}</div>
          <div className="lic-notice__body">{notice.body}</div>
          <button type="button" className="btn-ghost btn-sm" onClick={notice.run}>
            <FontAwesomeIcon icon={faArrowUpRightFromSquare} style={{ marginRight: 6 }} />
            {notice.label}
          </button>
        </div>
      )}
    </section>
  );
}
