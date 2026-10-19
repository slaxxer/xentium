import { prisma } from "../../infrastructure/db.js";
import {
  installPlugin,
  updatePlugin,
  enablePlugin,
  disablePlugin,
  uninstallPlugin,
  validatePackage,
} from "../../core/plugin-engine/plugin-engine.js";
import { pluginRegistry } from "../../core/plugin-engine/plugin-registry.js";
import { marketplaceWebUrl } from "../../core/license-engine/protocol-client.js";

// Plugin lifecycle mutations (install/update/enable/disable/uninstall) touch the
// filesystem, shared registries and the plugin router — two admins racing e.g. an
// update's disable→swap→re-enable sequence would corrupt the extracted dir. All
// mutations are serialized through one promise chain; the engine's internals stay
// lock-free (updatePlugin calls disable/enable directly), so only these service
// entry points take the lock. Losers of a race fail cleanly afterwards (e.g.
// XEC-PLUGIN-2005 version-not-newer on a duplicate update).
let lifecycleChain: Promise<unknown> = Promise.resolve();
function withLifecycleLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = lifecycleChain.then(fn); // chain never rejects (see below)
  lifecycleChain = run.catch(() => {});
  return run;
}

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
    return withLifecycleLock(() => installPlugin(buffer, userId));
  },

  async update(buffer: Buffer, userId: string, onProgress?: (p: { phase: string; percent: number }) => void) {
    return withLifecycleLock(() => updatePlugin(buffer, userId, onProgress));
  },

  async enable(pluginId: string) {
    return withLifecycleLock(() => enablePlugin(pluginId));
  },

  async disable(pluginId: string) {
    return withLifecycleLock(() => disablePlugin(pluginId));
  },

  async uninstall(pluginId: string, removeData: boolean) {
    return withLifecycleLock(() => uninstallPlugin(pluginId, removeData));
  },

  async list() {
    const rows = await prisma.installedPlugin.findMany({ orderBy: { installedAt: "desc" } });
    // Attach the in-memory load error (if the plugin's onEnable/import failed) so the
    // ACP can show "enabled in DB but failed to load" instead of a silent failure.
    //
    // `storeUrl`: its listing on the marketplace storefront, for the ACP's "Marketplace
    // page" link. Only a package the marketplace signed came from there; a developer's
    // own build (no signature) has no listing to link to.
    return rows.map((r) => ({
      ...r,
      loadError: pluginRegistry.getLoadError(r.id) ?? null,
      storeUrl:  r.signatureTier ? marketplaceWebUrl(`/plugins/${encodeURIComponent(r.id)}`) : null,
    }));
  },
};
