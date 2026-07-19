import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import AdmZip from "adm-zip";
import { prisma } from "../../infrastructure/db.js";
import { env } from "../../config/env.js";
import { validateManifest, type PluginManifest } from "./manifest-validator.js";
import { validateMigrationPairs, runUpMigrations, runNewUpMigrations, runDownMigrations, forceCleanupSchema } from "./migration-runner.js";
import { pluginRegistry } from "./plugin-registry.js";
import { logger } from "../../infrastructure/logging/logger.js";
import { isPluginEntitled } from "../license-engine/license-engine.js";
import { PluginContextImpl } from "./plugin-context.js";
import { NodevoError } from "../../shared/errors/NodevoError.js";
import { NEC } from "../../shared/errors/nec.js";
import { acpPageRegistry } from "./acp-page-registry.js";
import { pluginRouter } from "./plugin-router.js";

const PLUGIN_STORE = path.join(env.UPLOAD_DIR, "plugins");

async function ensurePluginDir(): Promise<void> {
  await fs.mkdir(PLUGIN_STORE, { recursive: true });
}

function packagePath(pluginId: string, version: string): string {
  return path.join(PLUGIN_STORE, `${pluginId}-${version}.nvplugin`);
}

/** Directory a plugin's package is extracted to (server bundle + web assets). */
export function extractedDir(pluginId: string): string {
  return path.join(PLUGIN_STORE, pluginId);
}

/** Validate a .nvplugin ZIP buffer. Returns the parsed manifest. */
export async function validatePackage(buffer: Buffer): Promise<{ manifest: PluginManifest; zip: AdmZip }> {
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new NodevoError({ code: NEC.PLUGIN_PACKAGE_INVALID, httpStatus: 422, message: "Package is not a valid ZIP archive." });
  }

  // Zip-slip: reject any entry with a path traversal
  for (const entry of zip.getEntries()) {
    if (entry.entryName.includes("..")) {
      throw new NodevoError({ code: NEC.PLUGIN_PACKAGE_INVALID, httpStatus: 422, message: `Unsafe path in package: ${entry.entryName}` });
    }
  }

  const manifestEntry = zip.getEntry("manifest.json");
  if (!manifestEntry) {
    throw new NodevoError({ code: NEC.PLUGIN_PACKAGE_INVALID, httpStatus: 422, message: "Missing manifest.json in plugin package." });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(manifestEntry.getData().toString("utf8"));
  } catch {
    throw new NodevoError({ code: NEC.PLUGIN_PACKAGE_INVALID, httpStatus: 422, message: "manifest.json is not valid JSON." });
  }

  let manifest: PluginManifest;
  try {
    manifest = validateManifest(raw);
  } catch (err: any) {
    // validateManifest throws coded NodevoErrors (2001/2030) — pass them through
    // instead of flattening them into an uncoded 5000.
    if (err instanceof NodevoError) throw err;
    throw new NodevoError({ code: NEC.PLUGIN_INVALID_MANIFEST, httpStatus: 422, message: `Invalid manifest.json: ${err.message ?? err}` });
  }

  // Validate migration pairs before touching anything
  validateMigrationPairs(zip, manifest);

  return { manifest, zip };
}

/** Install a plugin from a buffer. Stores the package and creates the DB record. */
export async function installPlugin(buffer: Buffer, _installedById: string): Promise<PluginManifest> {
  const { manifest, zip } = await validatePackage(buffer);

  // Check if already installed
  const existing = await prisma.installedPlugin.findUnique({ where: { id: manifest.id } });
  if (existing) {
    throw new NodevoError({ code: NEC.PLUGIN_ALREADY_INSTALLED, httpStatus: 409, message: `Plugin "${manifest.name}" (${manifest.id}) is already installed.` });
  }

  await ensurePluginDir();
  const pkgPath = packagePath(manifest.id, manifest.version);

  // Save package file (retained for down-migrations on uninstall)
  await fs.writeFile(pkgPath, buffer);

  // Extract the package so the compiled server bundle can be imported and the
  // web bundle served at runtime. Clean any prior extraction first.
  const extractDir = extractedDir(manifest.id);
  await fs.rm(extractDir, { recursive: true, force: true });
  await fs.mkdir(extractDir, { recursive: true });
  zip.extractAllTo(extractDir, /* overwrite */ true);

  // Self-heal orphaned schema: if this plugin has NO migration tracking yet a
  // prior messy install/uninstall left its tables behind, the up migrations would
  // collide ("relation already exists"). With zero tracked migrations the engine
  // owns no live data for this plugin, so it's safe to clear any leftovers first.
  // On a clean DB this is a harmless no-op (down migrations use DROP ... IF EXISTS).
  if (manifest.migrations.length) {
    const tracked = await prisma.nodevoPluginMigration.count({ where: { pluginId: manifest.id } });
    if (tracked === 0) {
      await forceCleanupSchema(zip, manifest);
    }
  }

  // Run up migrations
  await runUpMigrations(zip, manifest);

  // Create DB record
  await prisma.installedPlugin.create({
    data: {
      id:               manifest.id,
      name:             manifest.name,
      vendor:           manifest.vendor,
      installedVersion: manifest.version,
      status:           "installed",
      licenseRequired:  manifest.licenseRequired,
      packagePath:      pkgPath,
      manifest:         manifest as unknown as object,
    },
  });

  pluginRegistry.register(manifest, "installed");
  logger.info({ pluginId: manifest.id }, "Plugin installed");

  return manifest;
}

/** Compare two semver strings. Returns >0 if a>b, <0 if a<b, 0 if equal (numeric core only). */
function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

/**
 * Update an installed plugin in place from a new package buffer (§16.2).
 * Forward-only. Preserves the enabled/disabled state and the plugin's data:
 * an enabled plugin is disabled first (old bundle's onDisable + deregistration),
 * its files swapped, only its NEW migrations run, then re-enabled against the new
 * bundle. Migrations are never rolled back — updates only add schema.
 */
export async function updatePlugin(
  buffer: Buffer,
  _updatedById: string,
  onProgress?: (p: { phase: string; percent: number }) => void,
): Promise<PluginManifest> {
  const { manifest, zip } = await validatePackage(buffer);

  const existing = await prisma.installedPlugin.findUnique({ where: { id: manifest.id } });
  if (!existing) {
    throw new NodevoError({ code: NEC.PLUGIN_NOT_FOUND, httpStatus: 404, message: `Plugin "${manifest.id}" is not installed — nothing to update.` });
  }
  if (compareSemver(manifest.version, existing.installedVersion) <= 0) {
    throw new NodevoError({ code: NEC.PLUGIN_VERSION_NOT_NEWER, httpStatus: 409, message: `Package version ${manifest.version} is not newer than the installed ${existing.installedVersion}. Updates are forward-only.` });
  }

  const wasEnabled = existing.status === "enabled";
  // Tear down the OLD bundle first — its onDisable runs against the still-in-place
  // extracted dir/manifest, deregistering old routes/ACP pages/registries.
  if (wasEnabled) {
    onProgress?.({ phase: "disabling", percent: 80 });
    await disablePlugin(manifest.id);
  }

  onProgress?.({ phase: "applying", percent: 85 });
  await ensurePluginDir();
  const pkgPath = packagePath(manifest.id, manifest.version);
  await fs.writeFile(pkgPath, buffer);

  // Swap the extracted dir to the new bundle.
  const extractDir = extractedDir(manifest.id);
  await fs.rm(extractDir, { recursive: true, force: true });
  await fs.mkdir(extractDir, { recursive: true });
  zip.extractAllTo(extractDir, /* overwrite */ true);

  // Run only migrations this plugin has never applied (by name, any version).
  onProgress?.({ phase: "migrating", percent: 90 });
  await runNewUpMigrations(zip, manifest);

  // Update the DB record. Status stays "disabled" here; re-enabled below if it was.
  await prisma.installedPlugin.update({
    where: { id: manifest.id },
    data: {
      name:             manifest.name,
      vendor:           manifest.vendor,
      installedVersion: manifest.version,
      licenseRequired:  manifest.licenseRequired,
      packagePath:      pkgPath,
      manifest:         manifest as unknown as object,
    },
  });
  pluginRegistry.register(manifest, "disabled");

  // Remove the previous package file (its name embeds the old version).
  if (existing.packagePath && existing.packagePath !== pkgPath) {
    await fs.unlink(existing.packagePath).catch(() => null);
  }

  // Restore the enabled state against the NEW bundle (re-runs onEnable, re-registers).
  if (wasEnabled) {
    onProgress?.({ phase: "enabling", percent: 95 });
    await enablePlugin(manifest.id);
  }

  logger.info({ pluginId: manifest.id, from: existing.installedVersion, to: manifest.version }, "Plugin updated");
  return manifest;
}

/** Enable an installed plugin. */
export async function enablePlugin(pluginId: string): Promise<void> {
  const record = await prisma.installedPlugin.findUniqueOrThrow({ where: { id: pluginId } });
  if (record.status === "enabled") return;

  // License check — licenseRequired plugins need a valid entitlement
  if (record.licenseRequired) {
    const entitled = await isPluginEntitled(pluginId);
    if (!entitled) {
      throw new NodevoError({
        code:       NEC.LICENSE_NOT_FOUND,
        httpStatus: 402,
        message:    `Plugin "${record.name}" requires an active license entitlement. Activate a license in ACP → Extensions → License.`,
      });
    }
  }

  await prisma.installedPlugin.update({
    where: { id: pluginId },
    data:  { status: "enabled", enabledAt: new Date() },
  });

  pluginRegistry.setStatus(pluginId, "enabled");

  // Re-activate plugin-owned nav items
  await prisma.navItem.updateMany({
    where: { pluginId },
    data:  { isActive: true },
  });

  // Call plugin's onEnable hook if it has a server entry
  await callPluginHook(record, "onEnable");

  logger.info({ pluginId }, "Plugin enabled");
}

/** Disable an enabled plugin. */
export async function disablePlugin(pluginId: string): Promise<void> {
  const record = await prisma.installedPlugin.findUniqueOrThrow({ where: { id: pluginId } });
  if (record.status === "disabled" || record.status === "installed") return;

  await prisma.installedPlugin.update({
    where: { id: pluginId },
    data:  { status: "disabled", disabledAt: new Date() },
  });

  // Clean up plugin registrations
  acpPageRegistry.deregister(pluginId);
  pluginRouter.deregister(pluginId);

  const { homeFeedRegistry } = await import("../home-feed-registry/home-feed-registry.js");
  homeFeedRegistry.deregister(pluginId);

  const { searchRegistry } = await import("../search-registry/search-registry.js");
  searchRegistry.deregister(pluginId);

  const { statRegistry } = await import("../stat-registry/stat-registry.js");
  statRegistry.deregister(pluginId);

  // Deregister NEC codes
  const { necRegistry } = await import("../nec-registry/nec-registry.js");
  necRegistry.deregister(pluginId);

  // Deregister any plugin security scans
  const { securityScanRegistry } = await import("../security/security-scan-registry.js");
  securityScanRegistry.deregister(pluginId);

  // Deactivate plugin-owned nav items
  await prisma.navItem.updateMany({
    where: { pluginId },
    data:  { isActive: false },
  });

  // Call plugin's onDisable hook so it can clean up workers/listeners/connections
  await callPluginHook(record, "onDisable");

  pluginRegistry.setStatus(pluginId, "disabled");
  logger.info({ pluginId }, "Plugin disabled");
}

/** Uninstall a plugin — run down migrations and delete everything. */
export async function uninstallPlugin(pluginId: string, removeData: boolean): Promise<void> {
  const record = await prisma.installedPlugin.findUniqueOrThrow({ where: { id: pluginId } });

  if (record.status === "enabled") {
    await disablePlugin(pluginId);
  }

  if (removeData) {
    const pkgBuffer = await fs.readFile(record.packagePath).catch(() => null);
    if (pkgBuffer) {
      try {
        const zip      = new AdmZip(pkgBuffer);
        const manifest = validateManifest(record.manifest) as PluginManifest;
        await runDownMigrations(zip, manifest);
        // Belt-and-suspenders: best-effort drop anything a partial/failed down
        // migration may have left behind, so no orphaned schema survives.
        await forceCleanupSchema(zip, manifest);
      } catch (err) {
        logger.warn({ pluginId, err }, "Down migration failed during uninstall — continuing");
      }
    }
    // Always purge residual migration tracking so a future reinstall starts clean
    // even if a down migration above failed mid-way.
    await prisma.nodevoPluginMigration.deleteMany({ where: { pluginId } });
  }

  // Delete package file + extracted dir
  await fs.unlink(record.packagePath).catch(() => null);
  await fs.rm(extractedDir(pluginId), { recursive: true, force: true }).catch(() => null);

  // Delete DB record
  await prisma.installedPlugin.delete({ where: { id: pluginId } });

  pluginRegistry.deregister(pluginId);
  logger.info({ pluginId, removeData }, "Plugin uninstalled");
}

/** Dynamically import a plugin's server entry and call a lifecycle hook. */
async function callPluginHook(
  record: { id: string; manifest: unknown; packagePath: string },
  hook:   "onEnable" | "onDisable",
): Promise<void> {
  const manifest = validateManifest(record.manifest) as PluginManifest;
  const serverEntry = manifest.entrypoints?.server;
  if (!serverEntry) return;

  // Absolute path → first-party plugin loaded from source (dev bootstrap).
  // Otherwise → package-relative path inside the extracted plugin dir.
  const entryPath = path.isAbsolute(serverEntry)
    ? serverEntry
    : path.join(extractedDir(record.id), serverEntry);

  try {
    // Cache-bust the import URL: Node's ESM loader keys modules by URL and the
    // extract path is fixed per plugin id (no version), so re-uploading/updating
    // a plugin to a running process would otherwise re-run the stale cached
    // module — its onEnable would register old routes/ACP pages. A per-call query
    // string forces a fresh module load. Enable/disable is infrequent, so the
    // extra module instances are not a concern.
    const mod = await import(pathToFileURL(entryPath).href + `?v=${Date.now()}`);
    const def = mod.default as { id: string; onEnable?: (ctx: unknown) => Promise<void>; onDisable?: (ctx: unknown) => Promise<void> };
    const ctx = new PluginContextImpl(record.id);
    if (hook === "onEnable" && typeof def.onEnable === "function") {
      await def.onEnable(ctx);
    } else if (hook === "onDisable" && typeof def.onDisable === "function") {
      await def.onDisable(ctx);
    }
    // onEnable completed cleanly → clear any prior load failure.
    if (hook === "onEnable") pluginRegistry.clearLoadError(record.id);
  } catch (err) {
    logger.warn({ pluginId: record.id, hook, err }, "Plugin hook failed");
    // Surface enable failures: the DB still says "enabled" but nothing registered.
    // The ACP Installed list reads this so the admin sees "Failed to load" + reason
    // instead of a silently broken plugin.
    if (hook === "onEnable") {
      pluginRegistry.setLoadError(record.id, {
        hook,
        message: err instanceof Error ? err.message : String(err),
        at:      new Date().toISOString(),
      });
    }
  }
}

/** Called once at server startup — re-registers all enabled plugins in the registry. */
export async function initializeEnabledPlugins(): Promise<void> {
  const records = await prisma.installedPlugin.findMany({
    where: { status: { in: ["enabled", "installed", "disabled"] } },
  });

  for (const record of records) {
    try {
      const manifest = validateManifest(record.manifest) as PluginManifest;
      pluginRegistry.register(manifest, record.status as "enabled" | "disabled" | "installed");
      logger.info({ pluginId: record.id, status: record.status }, "Plugin loaded into registry");

      // Call onEnable for enabled plugins to restore routes/permissions/etc.
      if (record.status === "enabled") {
        await callPluginHook(record, "onEnable");
      }
    } catch (err) {
      logger.warn({ pluginId: record.id, err }, "Failed to initialize plugin on startup");
    }
  }
}
