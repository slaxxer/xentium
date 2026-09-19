import { useEffect, useRef } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../hooks/useAuth";
import { api } from "../../lib/api";
import { openPanelDialog } from "../../lib/dialog";
import type { CoreUpdate } from "./components/CoreUpdateCard";
import "./AcpLayout.scss";
import "./nav/AcpNav.scss";
import { RouteErrorBoundary } from "../errors/ErrorBoundary";
import { AcpTopbar } from "./AcpTopbar";
import { useAcpNav } from "./useAcpNav";
import { HorizontalNav } from "./nav/HorizontalNav";
import { IconScope } from "../../lib/iconScope";

// The ACP uses the horizontal navbar layout. A runtime layout/density/accent
// switcher (with sidebar + icon-rail chromes and a Tweaks panel) was prototyped
// but removed for now — it'll return in a future update.

function AcpAuthGate({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation("acp");
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();

  if (isLoading) {
    return <div className="acp-loading">{t("sidebar.loading")}</div>;
  }

  const hasAdminAccess = user?.groups?.some((g) => g.key === "admin");

  if (!user || !hasAdminAccess) {
    return (
      <div className="acp-forbidden">
        <h2>{t("sidebar.accessDeniedTitle")}</h2>
        <p>{t("sidebar.accessDeniedBody")}</p>
        <button type="button" className="btn-primary" onClick={() => navigate("/")}>
          {t("sidebar.goToSite")}
        </button>
      </div>
    );
  }

  return <>{children}</>;
}

/**
 * ACP-entry announcement dialogs (openPanelDialog — the app-wide alert surface),
 * shown PER ADMIN and persistent until this admin has actually LOOKED at the
 * matching page (server-tracked via the ACP movement log — dismissing never
 * counts, only visiting does):
 *   - license about to expire / expired → until they visit /admin/license
 *   - plugin updates waiting             → until they visit /admin/updates
 * At most ONE fires per ACP entry (a second openPanelDialog would pre-empt the
 * first); the license takes priority since it threatens service continuity, and
 * the badge + banners carry whatever isn't shown. Both re-fire when their anchor
 * moves (a renewed license / a new update set).
 */
const MAX_DIALOG_ROWS = 5;

interface PluginUpdate {
  pluginId:          string;
  name?:             string;
  installedVersion?: string | null;
  latestVersion:     string;
  critical:          boolean;
  renewalRequired:   boolean;
}

interface StatusSummary {
  licenseExpiringSoon: boolean;
  licenseExpired:      boolean;
  licenseDaysLeft:     number | null;
  licenseExpiresAt:    string | null;
  licenseDomain:       string | null;
  licenseAcknowledged: boolean;
}

function useAcpAlerts() {
  const { t } = useTranslation("acp");
  const navigate = useNavigate();
  const shownFor = useRef<string | null>(null);

  const { data: updates } = useQuery<{ checkedAt: string | null; updates: PluginUpdate[]; acknowledged: boolean; core: CoreUpdate | null }>({
    queryKey:  ["acp-marketplace-updates"],
    queryFn:   () => api.get("/admin/marketplace/updates"),
    staleTime: 5 * 60_000,
  });
  const { data: status } = useQuery<StatusSummary>({
    queryKey:  ["acp-status-summary"],
    queryFn:   () => api.get("/admin/status-summary"),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    const licenseNeeds = !!status && (status.licenseExpiringSoon || status.licenseExpired) && !status.licenseAcknowledged;
    const list = updates?.updates ?? [];
    const updatesNeed = list.length > 0 && !updates?.acknowledged;

    // Core. A PATCH on the minor we are already on never opens a dialog: it is
    // the most common release there is, the card and the badge already say so,
    // and a dialog people meet weekly is a dialog people stop reading. Anything
    // else — a minor, a major, or a security fix anywhere along the way — is
    // worth one interruption per admin per release.
    const core = updates?.core ?? null;
    const coreUrgent = !!core && (core.highestSeverity === "security" || core.highestSeverity === "critical");
    const coreOnlyPatch = !!core && !!core.patch && core.patch.version === core.latest.version;
    const coreNeeds = !!core && !core.acknowledged && (coreUrgent || !coreOnlyPatch);

    /** One dialog per ACP entry — a second openPanelDialog pre-empts the first. */
    const showCore = () => {
      const key = `core:${core!.latest.version}`;
      if (shownFor.current === key) return;
      shownFor.current = key;

      // No severity marker on the version row: the panel already carries the
      // badge, and with a single row the marker is the same word twice.
      const rows = [
        { label: t("coreUpdate.dialogVersion"), value: `${core!.current} → ${core!.latest.version}`,
          marker: undefined as string | undefined },
      ];
      if (core!.releaseCount > 1) {
        rows.push({ label: t("coreUpdate.dialogBehind"), value: String(core!.releaseCount), marker: undefined });
      }
      // ⚠ A short label: the label column ellipsises, so the card's full
      // sentence ("Plugins that don't support this version yet:") would arrive
      // here as two characters.
      if (core!.blockedBy.length > 0) {
        rows.push({
          label:  t("coreUpdate.dialogBlocked"),
          value:  core!.blockedBy.map((p) => p.name).join(", "),
          marker: undefined,
        });
      }

      // Prose goes in the note, never in a row: a row's value is monospace and
      // does not shrink, so a sentence there runs off the edge of the dialog.
      // Where the urgency comes from outranks the upgrade notes — the dialog
      // must not say SECURITY about a version whose notes are features.
      const onTheWay = core!.urgentRelease
        ? [
            t(`coreUpdate.onTheWay.${core!.urgentRelease.severity}`, { version: core!.urgentRelease.version }),
            core!.urgentRelease.notes,
          ].filter(Boolean).join(" ")
        : null;

      void openPanelDialog({
        icon:        coreUrgent ? "warning" : "update",
        title:       t("coreUpdate.dialogTitle", { version: core!.latest.version }),
        badge:       coreUrgent ? t(`coreUpdate.severity.${core!.highestSeverity}`) : undefined,
        rows,
        note:        onTheWay ?? core!.latest.upgradeNotes ?? undefined,
        confirmText: t("marketplace.updatesDialogView"),
        cancelText:  t("marketplace.updatesDialogLater"),
      }).then((view) => { if (view) navigate("/admin/updates"); });
    };

    // License first (service continuity), one dialog per entry.
    if (licenseNeeds) {
      const key = `license:${status!.licenseExpiresAt}`;
      if (shownFor.current === key) return;
      shownFor.current = key;

      const expired = status!.licenseExpired;
      const rows = [] as { label: string; value: string; marker?: string }[];
      if (status!.licenseDomain) rows.push({ label: t("license.expiryDialogDomain"), value: status!.licenseDomain });
      rows.push({
        label:  t("license.expiryDialogExpires"),
        value:  status!.licenseExpiresAt ? new Date(status!.licenseExpiresAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "—",
        marker: expired ? t("license.expiryDialogExpiredMarker") : t("license.expiryDialogInDays", { count: Math.max(status!.licenseDaysLeft ?? 0, 0) }),
      });

      void openPanelDialog({
        icon:        "warning",
        title:       expired ? t("license.expiryDialogTitleExpired") : t("license.expiryDialogTitle"),
        badge:       expired ? t("license.expiryDialogExpiredMarker") : undefined,
        rows,
        note:        t("license.expiryDialogNote"),
        confirmText: t("license.expiryDialogView"),
        cancelText:  t("marketplace.updatesDialogLater"),
      }).then((view) => { if (view) navigate("/admin/license"); });
      return;
    }

    // A security release in core outranks any number of plugin updates: it is
    // the thing every plugin runs on.
    if (coreNeeds && coreUrgent) { showCore(); return; }

    if (!updatesNeed) {
      if (coreNeeds) showCore();
      return;
    }
    const setHash = `updates:${list.map((u) => `${u.pluginId}@${u.latestVersion}`).sort().join(",")}`;
    if (shownFor.current === setHash) return;
    shownFor.current = setHash;

    // Critical rows first, then cap the list for the dialog.
    const ordered = [...list].sort((a, b) => Number(b.critical) - Number(a.critical));
    const rows = ordered.slice(0, MAX_DIALOG_ROWS).map((u) => ({
      label:  u.name ?? u.pluginId,
      value:  `${u.installedVersion ?? "?"} → ${u.latestVersion}`,
      marker: u.critical ? t("marketplace.updatesDialogCritical") : undefined,
    }));
    if (ordered.length > MAX_DIALOG_ROWS) {
      rows.push({ label: t("marketplace.updatesDialogMore", { count: ordered.length - MAX_DIALOG_ROWS }), value: "", marker: undefined });
    }

    void openPanelDialog({
      icon:        "update",
      title:       t("marketplace.updatesDialogTitle", { count: list.length }),
      badge:       ordered.some((u) => u.critical) ? t("marketplace.updatesDialogBadge") : undefined,
      rows,
      note:        ordered.some((u) => u.renewalRequired) ? t("marketplace.updatesRenewal") : undefined,
      confirmText: t("marketplace.updatesDialogView"),
      cancelText:  t("marketplace.updatesDialogLater"),
    }).then((view) => {
      // Acknowledgement is the Updates-page VISIT (server-tracked); Later/Escape
      // don't count, so the dialog returns on the next ACP entry.
      if (view) navigate("/admin/updates");
    });
  }, [status, updates, t, navigate]);
}

function AcpShell() {
  const nav = useAcpNav();
  useAcpAlerts();

  return (
    // ⚠ The ACP draws with the BUNDLED free icons, never the site's chosen style —
    // the same separation that pins its font and its token layer. An admin restyling
    // their community must not restyle the tool they are doing it with, and a Pro+
    // family with partial coverage would leave holes in the panel's own chrome.
    // Previews inside here opt back in with <IconScope value="site">.
    <IconScope value="acp">
      <div className="acp-layout" data-layout="horizontal">
        <div className="acp-main">
          <AcpTopbar />
          <HorizontalNav nav={nav} />
          <main className="acp-content">
            {/* A crashing ACP page must not take the nav with it — an admin needs
                a way to click somewhere else. Clears on navigation. */}
            <RouteErrorBoundary variant="inline">
              <Outlet />
            </RouteErrorBoundary>
          </main>
        </div>
      </div>
    </IconScope>
  );
}

export function AcpLayout() {
  // The ACP is ALWAYS Poppins — site/user font choices style the public site
  // only. Body-level class so app-root overlays (dialogs, toasts) follow while
  // an ACP route is mounted (rule in AcpLayout.scss).
  useEffect(() => {
    document.body.classList.add("xt-acp");
    return () => document.body.classList.remove("xt-acp");
  }, []);

  return (
    <AcpAuthGate>
      <AcpShell />
    </AcpAuthGate>
  );
}
