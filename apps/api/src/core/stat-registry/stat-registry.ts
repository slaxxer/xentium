/**
 * Plugin-extensible site-stats sources (footer counters). Core asks registered
 * sources for their counts — it never queries plugin tables. Mirrors
 * home-feed-registry / search-registry. A plugin registers via
 * `ctx.registerStatSource(...)` in its onEnable, and is removed on disable.
 */
import type { StatSource, FooterStat } from "@nodevo/plugin-sdk";

export type { StatSource, FooterStat } from "@nodevo/plugin-sdk";

interface Entry { pluginId: string; source: StatSource }

class StatRegistry {
  private entries = new Map<string, Entry>(); // keyed by source id

  register(pluginId: string, source: StatSource): void {
    this.entries.set(source.id, { pluginId, source });
  }

  /** Remove every source contributed by a plugin (called on disable/uninstall). */
  deregister(pluginId: string): void {
    for (const [id, e] of this.entries) if (e.pluginId === pluginId) this.entries.delete(id);
  }

  getAll(): StatSource[] {
    return [...this.entries.values()].map((e) => e.source);
  }

  /** Collect every registered source's counters, flattened. A source that throws
   *  is skipped (one bad plugin never breaks the footer). */
  async collect(): Promise<FooterStat[]> {
    const out: FooterStat[] = [];
    await Promise.all(
      this.getAll().map(async (s) => {
        try {
          const stats = await s.collect();
          for (const st of stats) out.push(st);
        } catch {
          /* skip a failing source */
        }
      }),
    );
    return out;
  }
}

export const statRegistry = new StatRegistry();
