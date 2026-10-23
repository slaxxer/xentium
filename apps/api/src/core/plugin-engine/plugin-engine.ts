import fs from "node:fs/promises";
import { seoRegistry } from "../../modules/seo/seo.registry.js";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import { prisma } from "../../infrastructure/db.js";
import { env } from "../../config/env.js";
import { validateManifest, type PluginManifest } from "./manifest-validator.js";
import { verifyPackageSignature, type PackageProvenance } from "./package-signature.js";
import { assertExtractionIntact } from "./extraction-integrity.js";
import { validateMigrationPairs, runUpMigrations, runNewUpMigrations, runDownMigrations, forceCleanupSchema } from "./migration-runner.js";
import { pluginRegistry } from "./plugin-registry.js";
import { logger } from "../../infrastructure/logging/logger.js";
import { assertPluginEnableAllowed } from "../license-engine/license-engine.js";
import { PluginContextImpl } from "./plugin-context.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { XEC } from "../../shared/errors/xec.js";
import { compareSemver } from "../../shared/utils/semver.js";
import { acpPageRegistry } from "./acp-page-registry.js";
import { authGuardRegistry } from "../auth-guard-registry/auth-guard-registry.js";
import { pluginRouter } from "./plugin-router.js";
import { deregisterEvents, emit } from "../events/events.js";

const PLUGIN_STORE = path.join(env.UPLOAD_DIR, "plugins");

/**
 * The api package's node_modules.
 *
 * Found by SEARCHING upward for the nearest node_modules rather than counting
 * `..` hops — the search is what makes it correct from both `src/` under tsx and
 * the bundled `dist/`, which sit at different depths.
 */
function hostNodeModules(): string | null {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = path.join(dir, "node_modules");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Plugin server bundles externalise the host's shared singletons (`express`
 * above all — a plugin Router must come from the SAME express instance), so
 * they carry bare imports resolved from wherever the bundle sits on disk.
 *
 * With the default UPLOAD_DIR that happens to work: uploads land under
 * `apps/api/`, and Node's upward walk reaches `apps/api/node_modules`. Point
 * UPLOAD_DIR anywhere else — which is a documented, supported thing to do — and
 * the walk instead reaches the workspace root, where pnpm's non-flat layout has
 * no `express`. Every plugin then fails to load with a bare "Cannot find
 * package 'express'", long after install appeared to succeed.
 *
 * A node_modules symlink at the plugin store makes the walk terminate correctly
 * regardless of where the store lives. Best-effort: a failure here is not worth
 * blocking startup over, and the default layout does not need it.
 */
async function ensureHostModulesLink(): Promise<void> {
  const link = path.join(PLUGIN_STORE, "node_modules");
  if (existsSync(link)) return;
  const target = hostNodeModules();
  if (!target) return;
  try {
    await fs.symlink(target, link, "junction");
    logger.info({ link, target }, "Linked host node_modules into the plugin store");
  } catch (err) {
    logger.warn(
      { err, link, target },
      "Could not link host node_modules into the plugin store — plugins may fail to resolve shared packages",
    );
  }
}

async function ensurePluginDir(): Promise<void> {
  await fs.mkdir(PLUGIN_STORE, { recursive: true });
  await ensureHostModulesLink();
}

function packagePath(pluginId: string, version: string): string {
  return path.join(PLUGIN_STORE, `${pluginId}-${version}.xtplugin`);
}

/** Directory a plugin's package is extracted to (server bundle + web assets). */
export function extractedDir(pluginId: string): string {
  return path.join(PLUGIN_STORE, pluginId);
}

/** Validate a .xtplugin ZIP buffer. Returns the parsed manifest. */
export async function validatePackage(
  buffer: Buffer,
): Promise<{ manifest: PluginManifest; zip: AdmZip; provenance: PackageProvenance }> {
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new XentiumError({ code: XEC.PLUGIN_PACKAGE_INVALID, httpStatus: 422, message: "Package is not a valid ZIP archive." });
  }

  // Zip-slip: reject any entry with a path traversal
  for (const entry of zip.getEntries()) {
    if (entry.entryName.includes("..")) {
      throw new XentiumError({ code: XEC.PLUGIN_PACKAGE_INVALID, httpStatus: 422, message: `Unsafe path in package: ${entry.entryName}` });
    }
  }

  const manifestEntry = zip.getEntry("manifest.json");
  if (!manifestEntry) {
    throw new XentiumError({ code: XEC.PLUGIN_PACKAGE_INVALID, httpStatus: 422, message: "Missing manifest.json in plugin package." });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(manifestEntry.getData().toString("utf8"));
  } catch {
    throw new XentiumError({ code: XEC.PLUGIN_PACKAGE_INVALID, httpStatus: 422, message: "manifest.json is not valid JSON." });
  }

  let manifest: PluginManifest;
  try {
    manifest = validateManifest(raw);
  } catch (err: any) {
    // validateManifest throws coded XentiumErrors (2001/2030) — pass them through
    // instead of flattening them into an uncoded 5000.
    if (err instanceof XentiumError) throw err;
    throw new XentiumError({ code: XEC.PLUGIN_INVALID_MANIFEST, httpStatus: 422, message: `Invalid manifest.json: ${err.message ?? err}` });
  }

  // Validate migration pairs before touching anything
  await validateMigrationPairs(zip, manifest);

  // Provenance LAST, and before anything is written: a package carrying a
  // signature that does not verify is refused here, so neither install nor
  // update can reach the filesystem with it. An unsigned package passes — that
  // is a developer's own build, not an accusation.
  const provenance = await verifyPackageSignature(zip, manifest);

  return { manifest, zip, provenance };
}

/** Install a plugin from a buffer. Stores the package and creates the DB record. */
export async function installPlugin(buffer: Buffer, _installedById: string): Promise<PluginManifest> {
  const { manifest, zip, provenance } = await validatePackage(buffer);

  // Check if already installed
  const existing = await prisma.installedPlugin.findUnique({ where: { id: manifest.id } });
  if (existing) {
    throw new XentiumError({ code: XEC.PLUGIN_ALREADY_INSTALLED, httpStatus: 409, message: `Plugin "${manifest.name}" (${manifest.id}) is already installed.` });
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
    const tracked = await prisma.xentiumPluginMigration.count({ where: { pluginId: manifest.id } });
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
      signatureTier:    provenance.tier,
      reviewedAt:       provenance.reviewedAt ? new Date(provenance.reviewedAt) : null,
      contentDigest:    provenance.digest,
    },
  });

  pluginRegistry.register(manifest, "installed");
  logger.info({ pluginId: manifest.id }, "Plugin installed");

  return manifest;
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
  const { manifest, zip, provenance } = await validatePackage(buffer);

  const existing = await prisma.installedPlugin.findUnique({ where: { id: manifest.id } });
  if (!existing) {
    throw new XentiumError({ code: XEC.PLUGIN_NOT_FOUND, httpStatus: 404, message: `Plugin "${manifest.id}" is not installed — nothing to update.` });
  }
  if (compareSemver(manifest.version, existing.installedVersion) <= 0) {
    throw new XentiumError({ code: XEC.PLUGIN_VERSION_NOT_NEWER, httpStatus: 409, message: `Package version ${manifest.version} is not newer than the installed ${existing.installedVersion}. Updates are forward-only.` });
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
      // Re-recorded, never carried over: the new bytes have their own
      // provenance, and an update from a signed build to an unsigned one must
      // show as unsigned rather than inherit the old build's review.
      signatureTier:    provenance.tier,
      reviewedAt:       provenance.reviewedAt ? new Date(provenance.reviewedAt) : null,
      contentDigest:    provenance.digest,
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

  // Do the files still match the package they came from? The signature was
  // checked once, at install; this is every time the code is about to run.
  // Before the licence gate deliberately — that one makes a network call, and
  // there is no point asking the marketplace about a plugin we are not going to
  // load.
  const tampered = await assertExtractionIntact(pluginId, record.packagePath, extractedDir(pluginId));
  if (tampered) {
    throw new XentiumError({ code: XEC.PLUGIN_PACKAGE_INVALID, httpStatus: 422, message: tampered });
  }

  // License check — authoritative BY ID: a plugin needs an entitlement iff the
  // marketplace sells THIS id as paid, regardless of what its (uploadable) manifest
  // `licenseRequired` flag claims. Closes the "repackage a paid plugin as free" hole.
  //
  // The gate re-syncs what it reads and asks the marketplace before refusing, so
  // a plugin bought a minute ago enables now rather than after the next daily
  // heartbeat, and a refusal names the actual reason. It throws its own coded
  // errors — see assertPluginEnableAllowed.
  await assertPluginEnableAllowed(pluginId, record.name);

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

  /**
   * If the hook registered layout templates, documents stored for them were being
   * skipped while the plugin was off (`loadScope` ignores an unregistered key) and
   * the memoized map still reflects that. Busting is cheap and unconditional here
   * because the alternative is a page that renders its code default for up to 30
   * seconds after the plugin comes back — reported as "my layout was lost".
   */
  const { layoutService } = await import("../../modules/layouts/layout.service.js");
  layoutService.bustCache();

  emit("plugin.enabled", { pluginId });
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
  seoRegistry.dropOwner(pluginId);

  const { reportTargetRegistry } = await import("../report-target-registry/report-target-registry.js");
  reportTargetRegistry.deregister(pluginId);

  // Embeds stop syncing and the plugin's content kinds stop answering, so its
  // embeds inside other content — and other plugins' embeds inside its content —
  // fail closed until it is back.
  const { embedRegistry } = await import("../embed-registry/embed-registry.js");
  embedRegistry.deregister(pluginId);
  const { contentRegistry } = await import("../content-registry/content-registry.js");
  contentRegistry.deregister(pluginId);

  const { statRegistry } = await import("../stat-registry/stat-registry.js");
  statRegistry.deregister(pluginId);

  const { progressionCriteriaRegistry } = await import("../progression-registry/progression-criteria-registry.js");
  progressionCriteriaRegistry.deregister(pluginId);

  // ⚠ Its badge metrics stop being offered and stop being evaluated — but a threshold
  // already stored against one stays in the badge, and counts again on re-enable.
  const { badgeCriteriaRegistry } = await import("../badge-registry/badge-criteria-registry.js");
  badgeCriteriaRegistry.deregister(pluginId);

  // Deregister XEC codes
  const { necRegistry } = await import("../xec-registry/xec-registry.js");
  necRegistry.deregister(pluginId);

  // Deregister any plugin security scans
  const { securityScanRegistry } = await import("../security/security-scan-registry.js");
  securityScanRegistry.deregister(pluginId);

  // Auth guards go with the plugin. A disabled beta plugin must not keep gating
  // logins — that would lock everyone out of a site whose admin just turned the
  // gate off by disabling it.
  authGuardRegistry.deregister(pluginId);

  /**
   * Layout templates the plugin declared (ADR-0005 Amendment 3).
   *
   * The stored documents are deliberately left in place — an admin's arrangement of
   * a forum page must survive the forum being turned off and on, exactly as an
   * unknown block survives in a document. The cache has to be busted because the
   * published map is memoized per template key, and a disabled plugin's template
   * must stop being served immediately rather than up to 30 seconds later.
   */
  const { deregisterTemplatesFor } = await import("@xentium/contracts");
  const droppedTemplates = deregisterTemplatesFor(pluginId);
  if (droppedTemplates.length) {
    const { layoutService } = await import("../../modules/layouts/layout.service.js");
    layoutService.bustCache();
    logger.info({ pluginId, templates: droppedTemplates }, "Plugin layout templates deregistered");
  }

  // Its listeners and filters stop at once: a disabled plugin must not keep
  // refusing sign-ups or reacting to members.
  deregisterEvents(pluginId);

  // Deactivate plugin-owned nav items
  await prisma.navItem.updateMany({
    where: { pluginId },
    data:  { isActive: false },
  });

  // Call plugin's onDisable hook so it can clean up workers/listeners/connections
  await callPluginHook(record, "onDisable");

  pluginRegistry.setStatus(pluginId, "disabled");
  emit("plugin.disabled", { pluginId });
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
    await prisma.xentiumPluginMigration.deleteMany({ where: { pluginId } });
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
  // Also on boot, not just on install: an instance whose UPLOAD_DIR moved (or
  // that installed plugins before this link existed) otherwise stays broken
  // until the next install, with every plugin failing to resolve `express`.
  await ensurePluginDir();

  const records = await prisma.installedPlugin.findMany({
    where: { status: { in: ["enabled", "installed", "disabled"] } },
  });

  for (const record of records) {
    try {
      const manifest = validateManifest(record.manifest) as PluginManifest;

      // Every boot, for anything that is about to execute: do the extracted
      // files still match the package they were installed from? A signature
      // verified once at install and never looked at again is trust on first
      // use, and the interesting moment is every boot after it.
      //
      // A failure does NOT stop the server. The plugin is left unregistered and
      // the reason is recorded where the ACP already shows load failures, so
      // the site comes up without the suspect code and the admin is told which
      // files moved. Taking a forum offline over one bad plugin would be a
      // denial of service dressed as a security feature.
      if (record.status === "enabled") {
        const tampered = await assertExtractionIntact(record.id, record.packagePath, extractedDir(record.id));
        if (tampered) {
          pluginRegistry.setLoadError(record.id, {
            hook: "integrity", message: tampered, at: new Date().toISOString(),
          });
          continue;
        }
      }

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
