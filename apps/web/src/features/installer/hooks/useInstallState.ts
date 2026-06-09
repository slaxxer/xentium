import { useQuery } from "@tanstack/react-query";
import { installerApi } from "../installer.api";

export function useInstallStatus() {
  return useQuery({
    queryKey:              ["install", "status"],
    queryFn:               installerApi.status,
    staleTime:             10_000,      // don't aggressively refetch during install
    refetchOnWindowFocus:  false,       // avoid mid-install refetches triggering guard errors
    retry:                 false,
  });
}
