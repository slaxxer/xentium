import { useEffect, useRef } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../hooks/useAuth";
import { api } from "../../lib/api";
import { openPanelDialog } from "../../lib/dialog";
import type { CoreUpdate } from "./components/CoreUpdateCard";
import { CoreUpdateDialogBody, isPrerelease } from "./components/coreUpdateParts";
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

// The ACP wears one of two navigation chromes, chosen per admin in the user
// menu and remembered in localStorage (nav/acpChrome.ts):
//
//   rail (default) — a 72px icon rail plus a 248px section panel down the left,
//                    with the top bar folded into them. One thin utility line
//                    survives for the notification bell and plugin header
//                    widgets; nav/AcpUtilityBar.tsx says why.
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

interface PluginUpdate {
  pluginId:          string;
  name?:             string;
  installedVersion?: string | null;
  latestVersion:     string;
  critical:          boolean;
  renewalRequired:   boolean;
}

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

  useEffect(() => {
    const licenseNeeds = !!status && (status.licenseExpiringSoon || status.licenseExpired) && !status.licenseAcknowledged;
    const list = updates?.updates ?? [];
    const updatesNeed = list.length > 0 && !updates?.acknowledged;

    // Core. A PATCH on the minor we are already on never opens a dialog: it is
    // the most common release there is, the card and the badge already say so,
    // and a dialog people meet weekly is a dialog people stop reading. Anything
    // else — a minor, a major, a security fix anywhere along the way, or a
    // PRERELEASE (every alpha is a "patch" on 1.0, and each one is a release
    // the team wants tested) — is worth one interruption per admin per release.
    const core = updates?.core ?? null;
    const coreUrgent = !!core && (core.highestSeverity === "security" || core.highestSeverity === "critical");
    const coreOnlyPatch = !!core && !!core.patch && core.patch.version === core.latest.version;
    const corePre = !!core && isPrerelease(core.latest.version);
    const coreNeeds = !!core && !core.acknowledged && (coreUrgent || corePre || !coreOnlyPatch);

    /** One dialog per ACP entry — a second openPanelDialog pre-empts the first. */
    const showCore = () => {
      const key = `core:${core!.latest.version}`;
      if (shownFor.current === key) return;
      shownFor.current = key;

      // The same shape as a broadcast from the team: everything an admin needs
      // is IN the dialog — the facts, the changelog, the command — so "Got it"
      // counts as read. "Later" does not; it returns on the next ACP entry.
      void openPanelDialog({
        icon:        coreUrgent ? "warning" : "update",
        title:       t("coreUpdate.dialogTitle", { version: core!.latest.version }),
        badge:       coreUrgent ? t(`coreUpdate.severity.${core!.highestSeverity}`)
                   : corePre    ? t("coreUpdate.prerelease") : undefined,
        badgeTone:   coreUrgent ? "danger" : "calm",
        large:       true,
        bodyNode:    <CoreUpdateDialogBody update={core!} />,
        confirmText: t("coreUpdate.dialogOk"),
        cancelText:  t("marketplace.updatesDialogLater"),
      }).then((ok) => {
        if (!ok) return;
        void api.post("/admin/marketplace/updates/core/acknowledge", {})
          .then(() => qc.invalidateQueries({ queryKey: ["acp-marketplace-updates"] }))
          .catch(() => { /* it comes back next entry */ });
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
          .then(() => qc.invalidateQueries({ queryKey: ["acp-announcements"] }))
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
  }, [status, updates, broadcasts, t, navigate, qc]);
}

function AcpShell() {
  const nav = useAcpNav();
  const layout = useAcpLayout();
  useAcpAlerts();

  const content = (
    <main className="acp-content">
      {/* A crashing ACP page must not take the nav with it — an admin needs
          a way to click somewhere else. Clears on navigation. */}
      <RouteErrorBoundary variant="inline">
        <Outlet />
      </RouteErrorBoundary>
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
