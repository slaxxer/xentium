import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";

export interface MaintenanceStatus {
  enabled: boolean;
  title: string;
  message: string;
  progress: { label: string; percent: number };
  eta: string | null;
  allowedGroup: string;
}

/** Public maintenance status. Polled so the gate reacts when an admin toggles
 *  it and the progress/ETA stay fresh. */
export function useMaintenance(enabled: boolean) {
  return useQuery<MaintenanceStatus>({
    queryKey: ["maintenance"],
    queryFn: () => api.get("/maintenance"),
    enabled,
    refetchInterval: 30_000,
    retry: false,
  });
}
