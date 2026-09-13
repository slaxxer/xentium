/**
 * Plugin-extensible search content sources. Core asks registered sources to run
 * the search and merges normalized results — it never queries plugin tables or
 * knows their schema. Mirrors home-feed-registry. A plugin registers via
 * `ctx.registerSearchSource(...)` in its onEnable, and is removed on disable.
 */
import type { SearchSource } from "@xentium/plugin-sdk";

export type { SearchResultItem, SearchSource } from "@xentium/plugin-sdk";

interface Entry { pluginId: string; source: SearchSource }

class SearchRegistry {
  private entries = new Map<string, Entry>(); // keyed by source id

  register(pluginId: string, source: SearchSource): void {
    this.entries.set(source.id, { pluginId, source });
  }

  /** Remove every source contributed by a plugin (called on disable/uninstall). */
  deregister(pluginId: string): void {
    for (const [id, e] of this.entries) if (e.pluginId === pluginId) this.entries.delete(id);
  }

  get(id: string): SearchSource | undefined {
    return this.entries.get(id)?.source;
  }

  getAll(): SearchSource[] {
    return [...this.entries.values()].map((e) => e.source);
  }
}

export const searchRegistry = new SearchRegistry();
