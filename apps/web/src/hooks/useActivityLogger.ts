import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../lib/api";
import { authStore } from "../lib/authStore";
import { useInstallStatus } from "../features/installer/hooks/useInstallState";

/**
 * Logs each public page navigation for signed-in users to the activity log.
 * ACP (/admin) movements are recorded server-side, so they're skipped here.
 * Inert until installed; fire-and-forget — never blocks navigation.
 */
export function useActivityLogger() {
  const location = useLocation();
  const lastPath = useRef<string | null>(null);
  const { data: installStatus } = useInstallStatus();
  const isInstalled = !!installStatus?.installed;

  useEffect(() => {
    if (!isInstalled) return;
    if (!authStore.token) return; // only track signed-in users
    const path = location.pathname;
    if (path.startsWith("/admin")) return;
    if (path === lastPath.current) return;
    lastPath.current = path;
    api.post("/activity/visit", { url: path }).catch(() => {});
  }, [location.pathname, isInstalled]);
}
