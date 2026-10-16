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

/** An IANA time zone the runtime knows, or null for "each visitor's own". */
function validZone(zone: unknown): string | null {
  if (typeof zone !== "string" || !zone || zone === "visitor") return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

const ALERT_TONES = ["info", "success", "warning", "danger"] as const;
const ALERT_AUDIENCES = ["everyone", "guests", "members"] as const;

/** The value when it is one of `allowed`, else the first (the default). */
function pick<T extends string>(allowed: readonly T[], v: unknown): T {
  return (allowed as readonly unknown[]).includes(v) ? (v as T) : allowed[0]!;
}

/**
 * The site alert: one bar at the very top of every public page, written by an
 * admin and shown as written. Normalised here because the settings endpoint
 * stores whatever it is sent — a link only to http(s) or a path on this site.
 * Off or empty = null, so nothing is drawn.
 */
function siteAlert(s: Record<string, unknown>) {
  const message = String(s["alert.message"] ?? "").trim().slice(0, 500);
  if (s["alert.enabled"] !== true || !message) return null;
  const url = String(s["alert.link_url"] ?? "").trim();
  const safeUrl = /^https?:\/\//i.test(url) || /^\/(?!\/)/.test(url) ? url : "";
  const label = String(s["alert.link_label"] ?? "").trim().slice(0, 80);
  return {
    message,
    tone:        pick(ALERT_TONES, s["alert.tone"]),
    audience:    pick(ALERT_AUDIENCES, s["alert.audience"]),
    dismissible: s["alert.dismissible"] !== false,
    link:        safeUrl ? { url: safeUrl, label: label || safeUrl } : null,
  };
}

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
      "site.timezone":              "visitor",
      "site.time_format":           "auto",
      "site.date_format":           "medium",
      "alert.enabled":              false,
      "alert.message":              "",
      "alert.tone":                 "info",
      "alert.link_label":           "",
      "alert.link_url":             "",
      "alert.audience":             "everyone",
      "alert.dismissible":          true,
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
      // How dates and times are written across the site (posts, articles, messages):
      // the admin's zone — or null, each visitor's own — and the formats. Normalised
      // here because the settings endpoint stores whatever it is sent.
      time: {
        zone: validZone(s["site.timezone"]),
        timeFormat: ["auto", "24h", "12h"].includes(s["site.time_format"]) ? s["site.time_format"] : "auto",
        dateFormat: ["medium", "long", "numeric", "iso"].includes(s["site.date_format"]) ? s["site.date_format"] : "medium",
      },
      alert: siteAlert(s),
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
