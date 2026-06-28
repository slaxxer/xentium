import { prisma } from "../../infrastructure/db.js";
import {
  installPlugin,
  enablePlugin,
  disablePlugin,
  uninstallPlugin,
  validatePackage,
} from "../../core/plugin-engine/plugin-engine.js";
import { pluginRegistry } from "../../core/plugin-engine/plugin-registry.js";

export const pluginService = {
  /** Validate a package buffer and return manifest info without installing. */
  async validateOnly(buffer: Buffer) {
    const { manifest } = await validatePackage(buffer);
    const existing = await prisma.installedPlugin.findUnique({ where: { id: manifest.id } });
    return {
      id:               manifest.id,
      name:             manifest.name,
      version:          manifest.version,
      vendor:           manifest.vendor,
      licenseRequired:  manifest.licenseRequired,
      permissions:      manifest.permissions,
      migrations:       manifest.migrations,
      alreadyInstalled: !!existing,
    };
  },

  async install(buffer: Buffer, userId: string) {
    return installPlugin(buffer, userId);
  },

  async enable(pluginId: string) {
    return enablePlugin(pluginId);
  },

  async disable(pluginId: string) {
    return disablePlugin(pluginId);
  },

  async uninstall(pluginId: string, removeData: boolean) {
    return uninstallPlugin(pluginId, removeData);
  },

  async list() {
    const rows = await prisma.installedPlugin.findMany({ orderBy: { installedAt: "desc" } });
    // Attach the in-memory load error (if the plugin's onEnable/import failed) so the
    // ACP can show "enabled in DB but failed to load" instead of a silent failure.
    return rows.map((r) => ({ ...r, loadError: pluginRegistry.getLoadError(r.id) ?? null }));
  },
};
