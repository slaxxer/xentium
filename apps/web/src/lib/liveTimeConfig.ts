/**
 * The site's time settings as last loaded, for code that formats dates outside a
 * component (`siteTime` in lib/datetime). Filled by the site config query, which
 * the app root runs on every page, the ACP included. Its own module so
 * `useSiteConfig` and `lib/datetime` do not import each other.
 */
import type { TimeConfig } from "./datetime";

let live: TimeConfig | null = null;

export function setLiveTimeConfig(cfg: TimeConfig | undefined): void {
  if (cfg) live = cfg;
}

export function liveTimeConfig(): TimeConfig | null {
  return live;
}
