import { prisma } from "../../infrastructure/db.js";
import { getSetting } from "../../shared/utils/settings.js";
import { statRegistry, type FooterStat } from "../../core/stat-registry/stat-registry.js";

export type FeatureKey = "articles" | "home" | "members";

const FEATURE_KEYS: FeatureKey[] = ["articles", "home", "members"];

/** A feature is on unless explicitly disabled in settings (default-on). */
export async function isFeatureEnabled(feature: FeatureKey): Promise<boolean> {
  return getSetting<boolean>(`features.${feature}.enabled`, true);
}

interface LandingOption { value: string; label: string }

export const siteService = {
  /** Public site config: feature flags + the resolved landing route + the set of
   *  landing destinations that actually exist right now (enabled core sections +
   *  active plugin nav items — so e.g. Forum only appears when its plugin is on). */
  async getConfig() {
    const flags = await Promise.all(FEATURE_KEYS.map((f) => isFeatureEnabled(f)));
    const features = Object.fromEntries(FEATURE_KEYS.map((f, i) => [f, flags[i]])) as Record<FeatureKey, boolean>;

    const landings: LandingOption[] = [];
    if (features.home) landings.push({ value: "home", label: "Home" });
    if (features.articles) landings.push({ value: "/articles", label: "Articles" });
    if (features.members) landings.push({ value: "/members", label: "Members" });

    // Plugin destinations: active plugin-registered nav items (forum deactivates
    // its item on disable, so it drops out automatically).
    const pluginNav = await prisma.navItem.findMany({
      where: { pluginId: { not: null }, isActive: true },
      orderBy: { position: "asc" },
      select: { label: true, url: true },
    });
    for (const n of pluginNav) {
      if (!landings.some((l) => l.value === n.url)) landings.push({ value: n.url, label: n.label });
    }

    const stored = await getSetting<string>("site.landing", "home");
    const landing = landings.some((l) => l.value === stored) ? stored : (landings[0]?.value ?? "home");

    // Site identity (set during install) — the canonical base URL + display name
    // the SPA uses for canonical/og:url tags and SEO previews.
    const [siteName, siteUrl, loginMethod, collectName, nameRequired] = await Promise.all([
      getSetting<string>("site.name", "Nodevo"),
      getSetting<string>("site.url", ""),
      getSetting<string>("auth.login_method", "email"),
      getSetting<boolean>("registration.collect_name", false),
      getSetting<boolean>("registration.name_required", false),
    ]);

    return {
      features, landing, availableLandings: landings, siteName, siteUrl,
      // Public auth-form config the SPA reads at boot (login + register forms).
      auth: {
        loginMethod: ["email", "username", "either"].includes(loginMethod) ? loginMethod : "email",
        collectName,
        nameRequired: collectName && nameRequired,
      },
    };
  },

  /** Footer meta: site name (copyright), process uptime, and plugin-contributed
   *  counters (e.g. forum threads/posts). The plugin stat aggregation is cached
   *  briefly since the footer renders on every page; uptime is always fresh (the
   *  client re-syncs and ticks it locally between fetches). */
  async getFooter() {
    const siteName = await getSetting<string>("site.name", "Nodevo");
    const stats = await getCachedFooterStats();
    return {
      siteName,
      uptimeSeconds: Math.floor(process.uptime()),
      stats,
    };
  },
};

let footerStatsCache: { at: number; stats: FooterStat[] } | null = null;
const FOOTER_STATS_TTL = 30_000;

async function getCachedFooterStats(): Promise<FooterStat[]> {
  if (footerStatsCache && Date.now() - footerStatsCache.at < FOOTER_STATS_TTL) {
    return footerStatsCache.stats;
  }
  const stats = await statRegistry.collect();
  footerStatsCache = { at: Date.now(), stats };
  return stats;
}
