/**
 * Plugin-contributed report targets. A plugin's reported content arrives as
 * `targetType: "plugin-content"` with `targetId: "<pluginId>:<kind>:<id>"`; the
 * plugin registers a handler per kind (`ctx.registerReportTarget`) that describes the
 * item and, optionally, removes it. Core never reads plugin tables. Mirrors the
 * search and home-feed registries; removed on disable.
 */
import type { ReportTargetHandler } from "@xentium/plugin-sdk";

interface Entry { pluginId: string; handler: ReportTargetHandler }

class ReportTargetRegistry {
  private entries = new Map<string, Entry>(); // keyed by "<pluginId>:<kind>"

  register(pluginId: string, handler: ReportTargetHandler): void {
    this.entries.set(`${pluginId}:${handler.kind}`, { pluginId, handler });
  }

  deregister(pluginId: string): void {
    for (const [key, e] of this.entries) if (e.pluginId === pluginId) this.entries.delete(key);
  }

  /** The handler for a plugin-content target id, and the plugin's own item id. */
  resolve(targetId: string): { handler: ReportTargetHandler; id: string } | null {
    const [pluginId, kind, ...rest] = targetId.split(":");
    const id = rest.join(":");
    if (!pluginId || !kind || !id) return null;
    const entry = this.entries.get(`${pluginId}:${kind}`);
    return entry ? { handler: entry.handler, id } : null;
  }
}

export const reportTargetRegistry = new ReportTargetRegistry();
