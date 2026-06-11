import type { PluginManifest } from "./manifest-validator.js";

export interface LoadedPlugin {
  manifest: PluginManifest;
  status:   "enabled" | "disabled" | "installed";
}

class PluginRegistry {
  private plugins = new Map<string, LoadedPlugin>();

  register(manifest: PluginManifest, status: LoadedPlugin["status"]): void {
    this.plugins.set(manifest.id, { manifest, status });
  }

  get(pluginId: string): LoadedPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  deregister(pluginId: string): void {
    this.plugins.delete(pluginId);
  }

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
