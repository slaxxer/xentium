/**
 * Plugin-extensible home / guest feed content sources. Core asks registered
 * sources for items — it never queries plugin tables. Mirrors search-registry.
 * Forum (and any future content plugin) registers via
 * `ctx.registerHomeFeedSource(...)` in its onEnable, and is removed on disable.
 */
import type { HomeFeedSource } from "@xentium/plugin-sdk";

export type { HomeFeedItem, HomeFeedSource } from "@xentium/plugin-sdk";

interface Entry { pluginId: string; source: HomeFeedSource }

class HomeFeedRegistry {
  private entries = new Map<string, Entry>(); // keyed by source id

  register(pluginId: string, source: HomeFeedSource): void {
    this.entries.set(source.id, { pluginId, source });
  }

  /** Remove every source contributed by a plugin (called on disable/uninstall). */
  deregister(pluginId: string): void {
    for (const [id, e] of this.entries) if (e.pluginId === pluginId) this.entries.delete(id);
  }

  get(id: string): HomeFeedSource | undefined {
    return this.entries.get(id)?.source;
  }

  getAll(): HomeFeedSource[] {
    return [...this.entries.values()].map((e) => e.source);
  }

  /** First registered source that supports a "hot" list (powers the home rail). */
  withHot(): HomeFeedSource | undefined {
    return this.getAll().find((s) => typeof s.hot === "function");
  }
}

export const homeFeedRegistry = new HomeFeedRegistry();
