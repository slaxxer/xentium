import { useEffect, useRef } from "react";
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
 * plugin updates are waiting (cache written by the update-check job). Never
 * forcing, but persistent PER ADMIN: it shows on every ACP entry until this
 * admin has actually VISITED the Updates page (server-tracked via the ACP
 * movement log — see getMarketplaceUpdates `acknowledged`). Dismissing the
 * dialog (Later/Escape) never counts; only going to look does. A new update set
 * resets the anchor and it fires again. Critical updates get the danger badge.
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

function useUpdateAlert() {
  const { t } = useTranslation("acp");
  const navigate = useNavigate();
  const shownFor = useRef<string | null>(null);
  const { data } = useQuery<{ checkedAt: string | null; updates: PluginUpdate[]; acknowledged: boolean }>({
    queryKey:  ["acp-marketplace-updates"],
    queryFn:   () => api.get("/admin/marketplace/updates"),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    const updates = data?.updates ?? [];
    if (!updates.length) return;
    // Server says this admin has already been to the Updates page for this set.
    if (data?.acknowledged) return;
    // Guard against a re-render firing a second dialog for the same set within
    // one ACP session (the effect can re-run when `data` refetches).
    const setHash = updates.map((u) => `${u.pluginId}@${u.latestVersion}`).sort().join(",");
    if (shownFor.current === setHash) return;
    shownFor.current = setHash;

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
      // Nothing is persisted here — acknowledgement is the Updates-page VISIT,
      // recorded server-side. View navigates there (and logs the visit); Later /
      // Escape just close, so the dialog returns on the next ACP entry.
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
