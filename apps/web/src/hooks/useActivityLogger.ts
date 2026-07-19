import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../lib/api";
import { authStore } from "../lib/authStore";
import { useInstallStatus } from "../features/installer/hooks/useInstallState";

/**
 * Logs each page navigation for signed-in users to the activity log, INCLUDING
 * ACP (/admin) movements — the admin movement trail drives the per-admin update
 * dialog (shown until the admin has actually visited /admin/updates) and is a
 * useful audit record in its own right. Server-side, only ACP *actions*
 * (mutations) are logged, so page views must come from here.
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
    if (path === lastPath.current) return;
    lastPath.current = path;
    api.post("/activity/visit", { url: path }).catch(() => {});
  }, [location.pathname, isInstalled]);
}
