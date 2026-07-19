import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../hooks/useAuth";
import { api } from "../../lib/api";
import { openPanelDialog } from "../../lib/dialog";
import "./AcpLayout.scss";
import "./nav/AcpNav.scss";
import { AcpTopbar } from "./AcpTopbar";
import { useAcpNav } from "./useAcpNav";
import { HorizontalNav } from "./nav/HorizontalNav";

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
 * One announcement dialog (openPanelDialog — the app-wide alert surface) when
 * plugin updates are waiting (cache written by the daily update-check job).
 * Never forcing: fires once per UPDATE SET — the seen set is remembered in
 * localStorage, so dismissing stays silent until a NEW update appears.
 * Critical updates get the danger badge and per-row markers.
 */
const UPDATES_SEEN_KEY = "nv-acp-updates-seen";
const MAX_DIALOG_ROWS = 5;

interface PluginUpdate {
  pluginId:          string;
  name?:             string;
  installedVersion?: string | null;
  latestVersion:     string;
  critical:          boolean;
  renewalRequired:   boolean;
}

function useUpdateAlert() {
  const { t } = useTranslation("acp");
  const navigate = useNavigate();
  const { data } = useQuery<{ checkedAt: string | null; updates: PluginUpdate[] }>({
    queryKey:  ["acp-marketplace-updates"],
    queryFn:   () => api.get("/admin/marketplace/updates"),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    const updates = data?.updates ?? [];
    if (!updates.length) return;
    const setHash = updates.map((u) => `${u.pluginId}@${u.latestVersion}`).sort().join(",");
    // Only stays silent once the admin has ACTED on this exact update set. A bare
    // reload must NOT count as acknowledgement — the dialog reappears on every ACP
    // entry until the admin clicks View or Later (matches the Extensions banner,
    // which also persists until the update is applied).
    if (localStorage.getItem(UPDATES_SEEN_KEY) === setHash) return;

    // Critical rows first, then cap the list for the dialog.
    const ordered = [...updates].sort((a, b) => Number(b.critical) - Number(a.critical));
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
      title:       t("marketplace.updatesDialogTitle", { count: updates.length }),
      badge:       updates.some((u) => u.critical) ? t("marketplace.updatesDialogBadge") : undefined,
      rows,
      note:        updates.some((u) => u.renewalRequired) ? t("marketplace.updatesRenewal") : undefined,
      confirmText: t("marketplace.updatesDialogView"),
      cancelText:  t("marketplace.updatesDialogLater"),
    }).then((view) => {
      // Acknowledged → remember this set so it stays quiet until a NEW update set
      // appears. Until then it re-fires on every fresh ACP entry (this effect runs
      // per AcpShell mount). The Extensions-section banner remains the persistent
      // reminder that survives until the update is actually applied.
      localStorage.setItem(UPDATES_SEEN_KEY, setHash);
      if (view) navigate("/admin/updates");
    });
  }, [data, t, navigate]);
}

function AcpShell() {
  const nav = useAcpNav();
  useUpdateAlert();

  return (
    <div className="acp-layout" data-layout="horizontal">
      <div className="acp-main">
        <AcpTopbar />
        <HorizontalNav nav={nav} />
        <main className="acp-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function AcpLayout() {
  // The ACP is ALWAYS Poppins — site/user font choices style the public site
  // only. Body-level class so app-root overlays (dialogs, toasts) follow while
  // an ACP route is mounted (rule in AcpLayout.scss).
  useEffect(() => {
    document.body.classList.add("nv-acp");
    return () => document.body.classList.remove("nv-acp");
  }, []);

  return (
    <AcpAuthGate>
      <AcpShell />
    </AcpAuthGate>
  );
}
