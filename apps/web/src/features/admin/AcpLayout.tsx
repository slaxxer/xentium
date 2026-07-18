import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../hooks/useAuth";
import { api } from "../../lib/api";
import { toast } from "../../lib/toast";
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
 * One informational toast when plugin updates are waiting (cache written by the
 * daily update-check job). Never forcing: fires once per UPDATE SET — the seen
 * set is remembered in localStorage, so ignoring it stays silent until a NEW
 * update appears. Critical updates upgrade the toast to the warning category.
 */
const UPDATES_SEEN_KEY = "nv-acp-updates-seen";

function useUpdateToast() {
  const { t } = useTranslation("acp");
  const navigate = useNavigate();
  const { data } = useQuery<{ checkedAt: string | null; updates: { pluginId: string; latestVersion: string; critical: boolean }[] }>({
    queryKey:  ["acp-marketplace-updates"],
    queryFn:   () => api.get("/admin/marketplace/updates"),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    const updates = data?.updates ?? [];
    if (!updates.length) return;
    const setHash = updates.map((u) => `${u.pluginId}@${u.latestVersion}`).sort().join(",");
    if (localStorage.getItem(UPDATES_SEEN_KEY) === setHash) return;
    localStorage.setItem(UPDATES_SEEN_KEY, setHash);

    const critical = updates.some((u) => u.critical);
    const message = updates.length === 1
      ? t("marketplace.updatesToast_one", { name: updates[0]!.pluginId, version: updates[0]!.latestVersion })
      : t("marketplace.updatesToast_other", { count: updates.length });
    toast.emit(critical ? "warning" : "update", message, {
      action: { label: t("marketplace.updatesToastView"), onClick: () => navigate("/admin/marketplace") },
    });
  }, [data, t, navigate]);
}

function AcpShell() {
  const nav = useAcpNav();
  useUpdateToast();

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
  return (
    <AcpAuthGate>
      <AcpShell />
    </AcpAuthGate>
  );
}
