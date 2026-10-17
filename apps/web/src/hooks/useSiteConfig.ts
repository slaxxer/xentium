import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { TimeConfig } from "../lib/datetime";
import { setLiveTimeConfig } from "../lib/liveTimeConfig";

export type FeatureKey = "articles" | "home" | "members";

export interface SiteAlert {
  message: string;
  tone: "info" | "success" | "warning" | "danger";
  audience: "everyone" | "guests" | "members";
  dismissible: boolean;
  link: { url: string; label: string } | null;
}

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
  /** How dates and times are written (ACP → System Settings → General). */
  time?: TimeConfig;
  /** The admin's site alert (Settings → Site alert); null when off or empty. */
  alert?: SiteAlert | null;
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
    // The time settings are also kept outside React, for formatters that are not
    // components (`siteTime` in lib/datetime).
    queryFn: () => api.get<SiteConfig>("/site/config").then((c) => { setLiveTimeConfig(c.time); return c; }),
    staleTime: 300_000,
    /**
     * ⚠ No retry when a component mounts. Most of the app waits on this query; while
     * it has no data they show "Loading…" and remount what is under them, and every
     * remount re-asked. When the request failed (a burst of 429s) that loop sent
     * hundreds of requests a second from one tab and kept the limiter shut. A failure
     * is retried calmly on a timer instead, so the page recovers on its own.
     */
    retryOnMount: false,
    refetchInterval: (query) => (query.state.status === "error" ? 15_000 : false),
  });
}
