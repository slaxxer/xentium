import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export type FeatureKey = "articles" | "home" | "members";

export interface SiteConfig {
  features: Record<FeatureKey, boolean>;
  landing: string;
  availableLandings: { value: string; label: string }[];
}

/** Public site config — feature flags + landing route. Cached; consumed by the
 *  root route, feature gates, and the ACP settings page. */
export function useSiteConfig() {
  return useQuery<SiteConfig>({
    queryKey: ["site-config"],
    queryFn: () => api.get("/site/config"),
    staleTime: 300_000,
  });
}
