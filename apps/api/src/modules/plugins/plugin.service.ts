import { prisma } from "../../infrastructure/db.js";
import {
  installPlugin,
  enablePlugin,
  disablePlugin,
  uninstallPlugin,
  validatePackage,
} from "../../core/plugin-engine/plugin-engine.js";

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
    return prisma.installedPlugin.findMany({ orderBy: { installedAt: "desc" } });
  },
};
