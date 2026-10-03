import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export type FeatureKey = "articles" | "home" | "members";

export interface SiteConfig {
  features: Record<FeatureKey, boolean>;
  landing: string;
  availableLandings: { value: string; label: string }[];
  /** Display name set during install (defaults to "Xentium"). */
  siteName: string;
  /** The site description from Settings; the header block can show it as a tagline. */
  siteTagline?: string;
  /** Canonical base URL set during install (e.g. "https://forum.example.com"); "" if unset. */
  siteUrl: string;
  /** Public auth-form config (login identifier + registration name collection). */
  auth: {
    loginMethod: "email" | "username" | "either";
    collectName: boolean;
    nameRequired: boolean;
  };
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
