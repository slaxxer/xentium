import { Fragment, Suspense, useEffect, useRef } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../hooks/useAuth";
import { userCan } from "../../lib/authStore";
import { api } from "../../lib/api";
import { openPanelDialog, resolveDialog } from "../../lib/dialog";
import { CoreUpdateRunHost, openCoreUpdateRun, useCoreUpdateRun } from "./components/CoreUpdateRun";
import { CorePermissions } from "@xentium/contracts";
import { CoreUpdateDialogBody, isPrerelease, type CoreUpdate, type PluginUpdateRow } from "./components/coreUpdateParts";
import "./AcpLayout.scss";
import "./AcpAnnouncement.scss";
import "./nav/AcpNav.scss";
import "./nav/AcpChrome.scss";
import { RouteErrorBoundary } from "../errors/ErrorBoundary";
import { AcpTopbar } from "./AcpTopbar";
import { useAcpNav } from "./useAcpNav";
import { HorizontalNav } from "./nav/HorizontalNav";
import { AcpRailShell } from "./nav/AcpRailShell";
import { useAcpLayout } from "./nav/acpChrome";
import { IconScope } from "../../lib/iconScope";
import { AcpSaveBar } from "./AcpSaveBar";
import { useDraftEpoch } from "../../hooks/useDraft";
import { siteTime } from "../../lib/datetime";
import { Button } from "../../components/AcpControls";

// The ACP wears one of two navigation chromes, chosen per admin in the user
// menu and remembered in localStorage (nav/acpChrome.ts):
//
//   rail (default) — a 72px icon rail plus a 248px section panel down the left,
//                    with the top bar folded into them entirely. Collapsed,
//                    the palette becomes a search icon in the rail.
//   horizontal     — the previous chrome: topbar + two-tier HorizontalNav. Kept
//                    whole rather than deleted, because it is the layout every
//                    admin has been using and taste in this is not unanimous.
//
// Both chromes share the palette (nav/AcpSearch) and the user menu
// (nav/AcpUserMenu) — there is one of each, arranged twice.

function AcpAuthGate({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation("acp");
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();

  if (isLoading) {
    return <div className="acp-loading">{t("sidebar.loading")}</div>;
  }

  // The same key every /api/admin route requires — ACP → Permissions decides.
  const hasAdminAccess = userCan(user, "admin.access");

  if (!user || !hasAdminAccess) {
    return (
      <div className="acp-forbidden">
        <h2>{t("sidebar.accessDeniedTitle")}</h2>
        <p>{t("sidebar.accessDeniedBody")}</p>
        <Button onClick={() => navigate("/")}>
          {t("sidebar.goToSite")}
        </Button>
      </div>
    );
  }

  return <>{children}</>;
}

/**
 * ACP-entry dialogs (openPanelDialog — the app-wide alert surface),
 * shown PER ADMIN and persistent until this admin has actually LOOKED at the
 * matching page (server-tracked via the ACP movement log — dismissing never
 * counts, only visiting does):
 *   - license about to expire / expired → until they visit /admin/license
 *   - plugin updates waiting             → until they visit /admin/updates
 * At most ONE fires per ACP entry (a second openPanelDialog would pre-empt the
 * first); the license takes priority since it threatens service continuity, and
 * the badge + banners carry whatever isn't shown. Both re-fire when their anchor
 * moves (a renewed license / a new update set).
 *
 * A BROADCAST from the Xentium team outranks all of them, and is answered
 * differently: OK is the whole answer, and it removes the announcement from
 * this SITE — for every admin, with no record of who read it and no page to
 * find it on again. The visit-the-page rule exists because a licence or an
 * update has something to be DONE about, and dismissing without looking would
 * be a lie; an announcement is finished when it has been read. It goes first
 * because it is rare and one click makes it go away for good, so everything
 * behind it waits at most one ACP entry.
 */
const MAX_DIALOG_ROWS = 5;

type PluginUpdate = PluginUpdateRow;

interface AnnouncementView {
  id:          string;
  severity:    "info" | "important" | "critical";
  publishedAt: string;
  link:        string | null;
  title:       string;
  body:        string;
}

/** Loudest first, then newest — one dialog per entry, so the order decides
 *  which of several unread broadcasts an admin meets first. */
const ANNOUNCEMENT_RANK: Record<AnnouncementView["severity"], number> = {
  critical: 2, important: 1, info: 0,
};

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
  const qc = useQueryClient();
  const shownFor = useRef<string | null>(null);
  /** The plugin set the core dialog already listed: its own dialog must not
   *  follow straight after, in the same visit, saying the same thing. */
  const pluginsShownWithCore = useRef<string | null>(null);

  const { data: broadcasts } = useQuery<{ checkedAt: string | null; announcements: AnnouncementView[] }>({
    queryKey:  ["acp-announcements"],
    queryFn:   () => api.get("/admin/announcements"),
    staleTime: 5 * 60_000,
  });

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

  // One-click: offered in the core dialog where the updater runs and this admin may update.
  const { user } = useAuth();
  const canUpdate = userCan(user, CorePermissions.SYSTEM_UPDATE);
  const updateRun = useCoreUpdateRun(!!user && canUpdate);
  const oneClick = canUpdate && !!updateRun.data?.available && !!updateRun.data.offered;

  useEffect(() => {
    const licenseNeeds = !!status && (status.licenseExpiringSoon || status.licenseExpired) && !status.licenseAcknowledged;
    const list = updates?.updates ?? [];
    const updatesNeed = list.length > 0 && !updates?.acknowledged;
    const setHash = `updates:${list.map((u) => `${u.pluginId}@${u.latestVersion}`).sort().join(",")}`;

    // Core. A new Xentium lives ONLY in this dialog — not on the Updates page,
    // not in the badge — so every release opens it, once per admin: any way of
    // closing it counts as seen. Plugin updates waiting at the same time ride
    // along, so an admin meets one dialog about updates, not two in a row.
    const core = updates?.core ?? null;
    const coreUrgent = !!core && (core.highestSeverity === "security" || core.highestSeverity === "critical");
    const corePre = !!core && isPrerelease(core.latest.version);
    const coreNeeds = !!core && !core.acknowledged;

    /** One dialog per ACP entry — a second openPanelDialog pre-empts the first. */
    const showCore = () => {
      const key = `core:${core!.latest.version}`;
      if (shownFor.current === key) return;
      shownFor.current = key;

      const withPlugins = list.length > 0;
      if (withPlugins) pluginsShownWithCore.current = setHash;
      void openPanelDialog({
        kind:        withPlugins ? "confirm" : "alert",
        icon:        coreUrgent ? "warning" : "update",
        title:       t("coreUpdate.dialogTitle", { version: core!.latest.version }),
        badge:       coreUrgent ? t(`coreUpdate.severity.${core!.highestSeverity}`)
                   : corePre    ? t("coreUpdate.prerelease") : undefined,
        badgeTone:   coreUrgent ? "danger" : "calm",
        large:       true,
        bodyNode:    <CoreUpdateDialogBody update={core!} plugins={list}
                       onUpdateNow={oneClick ? () => { resolveDialog(true); openCoreUpdateRun(); } : undefined} />,
        confirmText: withPlugins ? t("coreUpdate.dialogPlugins") : t("coreUpdate.dialogOk"),
        cancelText:  withPlugins ? t("coreUpdate.dialogClose") : undefined,
      }).then((ok) => {
        // One-time: every way out acknowledges. A failed write only means the
        // dialog shows once more, the safe direction.
        void api.post("/admin/marketplace/updates/core/acknowledge", {})
          .then(() => qc.invalidateQueries({ queryKey: ["acp-marketplace-updates"] }))
          .catch(() => { /* it comes back next entry */ });
        if (ok && withPlugins) navigate("/admin/updates");
      });
    };

    // A broadcast from the Xentium team goes first. Everything the endpoint
    // returns is unread — a read one no longer exists here.
    const unread = [...(broadcasts?.announcements ?? [])].sort((a, b) =>
      ANNOUNCEMENT_RANK[b.severity] - ANNOUNCEMENT_RANK[a.severity]
      || b.publishedAt.localeCompare(a.publishedAt));

    if (unread.length > 0) {
      const post = unread[0]!;
      const key = `announcement:${post.id}`;
      if (shownFor.current === key) return;
      shownFor.current = key;

      const urgent = post.severity !== "info";

      void openPanelDialog({
        // `alert`, not `confirm`: there is one button and it means "read".
        kind:        "alert",
        icon:        urgent ? "warning" : "info",
        title:       post.title,
        badge:       urgent ? t(`announcements.severity.${post.severity}`) : undefined,
        // The team's own prose, newlines and all. The link is shown in full and
        // never opened for the admin — they click it or they do not.
        bodyNode: (
          <>
            <p className="acp-announcement__body">{post.body}</p>
            {post.link && (
              <a className="acp-announcement__link" href={post.link} target="_blank" rel="noopener noreferrer">
                {post.link}
              </a>
            )}
          </>
        ),
        note:        t("announcements.dialogNote"),
        confirmText: t("announcements.dialogOk"),
      }).then(() => {
        // OK removes it from the site. A failed write is swallowed: the notice
        // simply returns next entry, which is the safe direction.
        void api.post(`/admin/announcements/${post.id}/dismiss`, {})
          .then(() => {
            void qc.invalidateQueries({ queryKey: ["acp-announcements"] });
            // The gear's dot counts an unread announcement: put it out now, not in five minutes.
            return qc.invalidateQueries({ queryKey: ["acp-status-summary"] });
          })
          .catch(() => { /* it comes back next entry */ });
      });
      return;
    }

    // License next (service continuity), one dialog per entry.
    if (licenseNeeds) {
      const key = `license:${status!.licenseExpiresAt}`;
      if (shownFor.current === key) return;
      shownFor.current = key;

      const expired = status!.licenseExpired;
      const rows = [] as { label: string; value: string; marker?: string }[];
      if (status!.licenseDomain) rows.push({ label: t("license.expiryDialogDomain"), value: status!.licenseDomain });
      rows.push({
        label:  t("license.expiryDialogExpires"),
        value:  status!.licenseExpiresAt ? siteTime.date(status!.licenseExpiresAt) : "—",
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

    // A new core carries the plugin list with it.
    if (coreNeeds) { showCore(); return; }

    if (!updatesNeed) return;
    if (shownFor.current === setHash || pluginsShownWithCore.current === setHash) return;
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
  }, [status, updates, broadcasts, t, navigate, qc, oneClick]);
}

function AcpShell() {
  const nav = useAcpNav();
  const layout = useAcpLayout();
  useAcpAlerts();
  // A discard that some surface could not reset itself remounts the page, which
  // re-seeds every form from the server (see `useDraft`).
  const draftEpoch = useDraftEpoch();

  const content = (
    <main className="acp-content">
      {/* A crashing ACP page must not take the nav with it — an admin needs
          a way to click somewhere else. Clears on navigation. */}
      <RouteErrorBoundary variant="inline">
        {/* ACP pages are loaded on demand (app/App.tsx): the shell stays put while
            a page's chunk arrives. */}
        <Fragment key={draftEpoch}><Suspense fallback={<div className="acp-page-loading" aria-busy="true" />}><Outlet /></Suspense></Fragment>
      </RouteErrorBoundary>
      {/* ONE save bar for every settings surface on every ACP page. */}
      <AcpSaveBar />
    </main>
  );

  return (
    // ⚠ The ACP draws with the BUNDLED free icons, never the site's chosen style —
    // the same separation that pins its font and its token layer. An admin restyling
    // their community must not restyle the tool they are doing it with, and a Pro+
    // family with partial coverage would leave holes in the panel's own chrome.
    // Previews inside here opt back in with <IconScope value="site">.
    <IconScope value="acp">
      <div className="acp-layout" data-layout={layout}>
        <CoreUpdateRunHost />
        {layout === "rail" ? (
          <AcpRailShell nav={nav}>{content}</AcpRailShell>
        ) : (
          <div className="acp-main">
            <AcpTopbar />
            <HorizontalNav nav={nav} />
            {content}
          </div>
        )}
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
