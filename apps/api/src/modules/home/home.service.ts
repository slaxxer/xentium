import { prisma } from "../../infrastructure/db.js";
import { homeFeedRegistry } from "../../core/home-feed-registry/home-feed-registry.js";

const GUEST_DEFAULTS = {
  badge:        "builders online now",
  title:        "Where people who build with xentium hang out.",
  subtitle:     "Ask questions, show what you made, shape the roadmap, and learn from {members} makers. Reading is open to everyone.",
  ctaPrimary:   "Join the conversation",
  ctaSecondary: "Browse as guest",
};

// The built-in core source. Plugins (e.g. forum) add more via homeFeedRegistry.
const CORE_SOURCE = { id: "articles", label: "Articles" };

export const homeService = {
  /** Public guest-home configuration (hero text + section toggles + feed sources).
   *  Edited in ACP → Appearance → Guest Home via the generic settings endpoints.
   *  Available feed sources are core "articles" + whatever plugins have registered —
   *  core has no knowledge of any specific plugin here. */
  async getGuestConfig() {
    const keys = [
      "guesthome.hero_badge", "guesthome.hero_title", "guesthome.hero_subtitle",
      "guesthome.cta_primary", "guesthome.cta_secondary", "guesthome.feed_sources",
      "guesthome.show_stats", "guesthome.show_presence", "guesthome.show_categories",
      "guesthome.show_online", "guesthome.show_tags",
    ];
    const rows = await prisma.setting.findMany({ where: { key: { in: keys } } });
    const m = new Map(rows.map((r) => [r.key, r.value as unknown]));
    const str  = (k: string, d: string) => { const v = m.get(k); return typeof v === "string" && v.trim() ? v : d; };
    const bool = (k: string, d: boolean) => { const v = m.get(k); return typeof v === "boolean" ? v : d; };

    const availableSources = [CORE_SOURCE, ...homeFeedRegistry.getAll().map((s) => ({ id: s.id, label: s.label }))];
    const availableIds = new Set(availableSources.map((s) => s.id));

    // Selected source ids — keep only the ones that are currently available.
    const rawSel = m.get("guesthome.feed_sources");
    let sources = Array.isArray(rawSel) ? rawSel.filter((id): id is string => typeof id === "string" && availableIds.has(id)) : [];
    if (sources.length === 0) sources = ["articles"];

    return {
      hero: {
        badge:        str("guesthome.hero_badge", GUEST_DEFAULTS.badge),
        title:        str("guesthome.hero_title", GUEST_DEFAULTS.title),
        subtitle:     str("guesthome.hero_subtitle", GUEST_DEFAULTS.subtitle),
        ctaPrimary:   str("guesthome.cta_primary", GUEST_DEFAULTS.ctaPrimary),
        ctaSecondary: str("guesthome.cta_secondary", GUEST_DEFAULTS.ctaSecondary),
      },
      sections: {
        stats:      bool("guesthome.show_stats", true),
        presence:   bool("guesthome.show_presence", true),
        categories: bool("guesthome.show_categories", true),
        online:     bool("guesthome.show_online", true),
        tags:       bool("guesthome.show_tags", true),
      },
      sources,
      availableSources,
    };
  },

  /** Recent items from a registered (plugin) feed source. Core "articles" is
   *  served by the articles module directly, not here. Returns [] for unknown
   *  / unregistered ids (e.g. plugin disabled). */
  async getFeedSourceItems(id: string, limit = 10) {
    const source = homeFeedRegistry.get(id);
    if (!source) return [];
    try {
      return await source.recent(limit);
    } catch {
      return [];
    }
  },

  /** Public headline counts for the guest landing hero + site footer. */
  async getStats() {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [members, articles, today, newest] = await Promise.all([
      prisma.user.count({ where: { isActive: true } }),
      prisma.article.count({ where: { status: "published", deletedAt: null } }),
      prisma.article.count({ where: { status: "published", deletedAt: null, publishedAt: { gte: dayAgo } } }),
      prisma.user.findFirst({
        where: { isActive: true },
        orderBy: { createdAt: "desc" },
        select: { username: true },
      }),
    ]);
    return { members, articles, today, newestMember: newest?.username ?? null };
  },

  /**
   * Hot items for the home right rail, sourced from the first registered feed
   * source that provides a "hot" list (the forum plugin). Returns
   * { enabled:false } when the ACP toggle is off or no such source is registered.
   * Core never queries plugin tables here.
   */
  async getHotThreads() {
    const off = { enabled: false as const, items: [] };

    const toggle = await prisma.setting.findUnique({ where: { key: "home.hot_threads_enabled" } });
    if (toggle?.value === false) return off;

    const source = homeFeedRegistry.withHot();
    if (!source?.hot) return off;

    try {
      return { enabled: true as const, items: await source.hot(5) };
    } catch {
      return off;
    }
  },
};
