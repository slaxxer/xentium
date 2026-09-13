/**
 * Plugin-extensible progression promotion criteria (§38). Core's checkPromotion
 * job asks registered criteria whether a user meets a target ladder group's
 * plugin-configured thresholds (e.g. the forum's min posts / min threads). Core
 * never queries the plugin's tables or knows its schema — mirrors
 * stat-registry / search-registry. A plugin registers via
 * `ctx.registerProgressionCriteria(...)` in onEnable; removed on disable, so
 * criteria from a disabled/uninstalled plugin simply stop counting.
 */
import type { ProgressionCriteria, ProgressionMetric } from "@xentium/plugin-sdk";

export type { ProgressionCriteria, ProgressionMetric } from "@xentium/plugin-sdk";

interface Entry { pluginId: string; criteria: ProgressionCriteria }

class ProgressionCriteriaRegistry {
  private entries = new Map<string, Entry>(); // keyed by criteria id

  register(pluginId: string, criteria: ProgressionCriteria): void {
    this.entries.set(criteria.id, { pluginId, criteria });
  }

  deregister(pluginId: string): void {
    for (const [id, e] of this.entries) if (e.pluginId === pluginId) this.entries.delete(id);
  }

  getAll(): ProgressionCriteria[] {
    return [...this.entries.values()].map((e) => e.criteria);
  }

  /**
   * Every registered plugin's threshold checks for `userId` against target
   * ladder group `groupId`, flattened into a single boolean list. A plugin that
   * has no thresholds configured for the group contributes nothing; one that
   * throws is skipped (a bad plugin never blocks or breaks promotion).
   */
  async evaluate(userId: string, groupId: string): Promise<boolean[]> {
    const out: boolean[] = [];
    await Promise.all(
      this.getAll().map(async (c) => {
        try {
          const checks = await c.evaluate(userId, groupId);
          for (const b of checks) out.push(b);
        } catch {
          /* skip a failing criteria source */
        }
      }),
    );
    return out;
  }

  /**
   * Display-only counterpart to `evaluate` — every registered plugin's
   * have/need pairs for the target rung, for the progression UI. Same
   * fault-tolerance: a criteria source that throws or omits `metrics` simply
   * contributes nothing.
   */
  async describe(userId: string, groupId: string): Promise<ProgressionMetric[]> {
    const out: ProgressionMetric[] = [];
    await Promise.all(
      this.getAll().map(async (c) => {
        if (!c.metrics) return;
        try {
          for (const m of await c.metrics(userId, groupId)) out.push(m);
        } catch {
          /* skip a failing criteria source */
        }
      }),
    );
    return out;
  }
}

export const progressionCriteriaRegistry = new ProgressionCriteriaRegistry();
