import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";

export type MaintenanceProgressMode = "steps" | "bar" | "hidden";
export type MaintenanceBackground = "aurora" | "solid";
export type MaintenanceServiceStatus = "offline" | "degraded" | "operational";
export type MaintenanceLinkIcon =
  | "link" | "discord" | "x" | "github" | "mastodon"
  | "telegram" | "youtube" | "status" | "email";

export interface MaintenanceService { name: string; status: MaintenanceServiceStatus }
export interface MaintenanceLink { icon: MaintenanceLinkIcon; label: string; url: string }

export interface MaintenanceStatus {
  enabled: boolean;
  title: string;
  message: string;
  progress: {
    mode: MaintenanceProgressMode;
    label: string;
    percent: number;
    steps: string[];
    /** 1-based index of the step in progress; 0 when there are no steps. */
    currentStep: number;
  };
  eta: string | null;
  countdown: boolean;
  autoRefresh: boolean;
  background: MaintenanceBackground;
  services: MaintenanceService[];
  links: MaintenanceLink[];
  staffLink: boolean;
  allowedGroups: string[];
}

/** Public maintenance status. Polled so the gate reacts when an admin toggles
 *  it and the progress/ETA stay fresh.
 *
 *  While the site is *up* the poll only has to notice maintenance starting, so
 *  it stays lazy. While the screen is showing, "auto-refresh when back" is the
 *  promise that visitors land on the site the moment it ends — that is this
 *  poll, tightened; with the toggle off the poll stops and the visitor reloads
 *  when they choose to. */
export function useMaintenance(enabled: boolean) {
  return useQuery<MaintenanceStatus>({
    queryKey: ["maintenance"],
    queryFn: () => api.get("/maintenance"),
    enabled,
    refetchInterval: (query) => {
      const s = query.state.data;
      if (!s?.enabled) return 30_000;
      return s.autoRefresh ? 10_000 : false;
    },
    retry: false,
  });
}
