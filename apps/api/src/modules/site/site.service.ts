import { prisma } from "../../infrastructure/db.js";
import { getSetting, getSettings } from "../../shared/utils/settings.js";
import { memoTtl } from "../../shared/utils/memoTtl.js";
import { statRegistry } from "../../core/stat-registry/stat-registry.js";

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
    // One batched settings read for everything the SPA needs at boot.
    const s = await getSettings({
      "features.articles.enabled":  true,
      "features.home.enabled":      true,
      "features.members.enabled":   true,
      "site.landing":               "home",
      "site.name":                  "Xentium",
      "site.description":           "",
      "site.url":                   "",
      "auth.login_method":          "email",
      "registration.collect_name":  false,
      "registration.name_required": false,
    });
    const features = Object.fromEntries(
      FEATURE_KEYS.map((f) => [f, !!s[`features.${f}.enabled`]]),
    ) as Record<FeatureKey, boolean>;

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

    const stored = s["site.landing"];
    const landing = landings.some((l) => l.value === stored) ? stored : (landings[0]?.value ?? "home");

    // Site identity (set during install) — the canonical base URL + display name
    // the SPA uses for canonical/og:url tags and SEO previews.
    const siteName     = s["site.name"];
    const siteUrl      = s["site.url"];
    const loginMethod  = s["auth.login_method"];
    const collectName  = s["registration.collect_name"];
    const nameRequired = s["registration.name_required"];

    return {
      features, landing, availableLandings: landings, siteName, siteUrl,
      siteTagline: s["site.description"],
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
    const siteName = await getSetting<string>("site.name", "Xentium");
    const stats = await getCachedFooterStats();
    return {
      siteName,
      uptimeSeconds: Math.floor(process.uptime()),
      stats,
    };
  },
};

const getCachedFooterStats = memoTtl(() => statRegistry.collect(), 30_000);
