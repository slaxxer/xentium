import type { PluginManifest } from "./manifest-validator.js";

export interface LoadedPlugin {
  manifest: PluginManifest;
  status:   "enabled" | "disabled" | "installed";
}

/** Records why an enabled plugin failed to load (import or onEnable threw). The
 *  plugin engine swallows hook errors to keep the server up, so without this the
 *  failure is invisible — the DB still says "enabled" while nothing registered. */
export interface PluginLoadError {
  hook:    string;   // "onEnable"
  message: string;
  at:      string;   // ISO timestamp
}

class PluginRegistry {
  private plugins    = new Map<string, LoadedPlugin>();
  private loadErrors = new Map<string, PluginLoadError>();

  register(manifest: PluginManifest, status: LoadedPlugin["status"]): void {
    this.plugins.set(manifest.id, { manifest, status });
  }

  get(pluginId: string): LoadedPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  deregister(pluginId: string): void {
    this.plugins.delete(pluginId);
    this.loadErrors.delete(pluginId);
  }

  setLoadError(pluginId: string, err: PluginLoadError): void { this.loadErrors.set(pluginId, err); }
  clearLoadError(pluginId: string): void { this.loadErrors.delete(pluginId); }
  getLoadError(pluginId: string): PluginLoadError | undefined { return this.loadErrors.get(pluginId); }

  setStatus(pluginId: string, status: LoadedPlugin["status"]): void {
    const p = this.plugins.get(pluginId);
    if (p) p.status = status;
  }

  isEnabled(pluginId: string): boolean {
    return this.plugins.get(pluginId)?.status === "enabled";
  }

  getAll(): LoadedPlugin[] {
    return Array.from(this.plugins.values());
  }
}

export const pluginRegistry = new PluginRegistry();
