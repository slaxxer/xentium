import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useInstallStatus } from "../features/installer/hooks/useInstallState";

/**
 * Logs each page navigation to the beta activity log when beta mode is active.
 * Completely inert until the application is fully installed.
 * No-op when beta mode is off. Fire-and-forget — never blocks navigation.
 */
export function useBetaActivityLogger() {
  const location = useLocation();
  const lastPath = useRef<string | null>(null);

  const { data: installStatus } = useInstallStatus();
  const isInstalled = !!installStatus?.installed;

  const { data } = useQuery<{ enabled: boolean; hasAccess: boolean }>({
    queryKey: ["beta-status"],
    queryFn:  () => api.get("/beta/status"),
    staleTime: 60_000,
    retry:     false,
    enabled:   isInstalled,   // only query once the app actually exists
  });

  useEffect(() => {
    if (!isInstalled) return;
    const path = location.pathname;
    if (!data?.enabled || !data.hasAccess) return;
    if (path === lastPath.current) return;
    if (path.startsWith("/admin")) return;
    lastPath.current = path;

    api.post("/beta/log-visit", { url: path }).catch(() => {});
  }, [location.pathname, data?.enabled, data?.hasAccess, isInstalled]);
}
