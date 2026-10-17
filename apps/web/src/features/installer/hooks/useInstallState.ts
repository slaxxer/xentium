import { useQuery } from "@tanstack/react-query";
import { installerApi } from "../installer.api";

export function useInstallStatus() {
  return useQuery({
    queryKey:              ["install", "status"],
    queryFn:               installerApi.status,
    staleTime:             10_000,      // don't aggressively refetch during install
    refetchOnWindowFocus:  false,       // avoid mid-install refetches triggering guard errors
    retry:                 false,
    // ⚠ The app's outermost gate waits on this. Re-asking on every remount after a
    // failure loops (see useSiteConfig); retry on a timer instead.
    retryOnMount:          false,
    refetchInterval:       (query) => (query.state.status === "error" ? 15_000 : false),
  });
}
