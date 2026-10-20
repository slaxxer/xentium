import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import { prisma } from "../infrastructure/db.js";
import { validateManifest } from "../core/plugin-engine/manifest-validator.js";
import { validateMigrationPairs, runUpMigrations } from "../core/plugin-engine/migration-runner.js";
import { pluginRegistry } from "../core/plugin-engine/plugin-registry.js";
import { logger } from "../infrastructure/logging/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const OFFICIAL_PLUGINS_DIR = path.join(REPO_ROOT, "plugins/official");

/**
 * At development startup, auto-install and register first-party plugins
 * found in plugins/official/. Each plugin directory must have a manifest.json.
 * Migrations are run if not already applied.
 * The plugin is marked as installed/enabled in the DB.
 */
export async function bootstrapOfficialPlugins(): Promise<void> {
  const { env } = await import("../config/env.js");
  if (!env.BOOTSTRAP_OFFICIAL_PLUGINS) {
    logger.info("Official-plugin auto-bootstrap disabled — plugins install on demand (ACP → Extensions). Set BOOTSTRAP_OFFICIAL_PLUGINS=true for the old dev flow.");
    return;
  }

  let dirs: string[];
  try {
    const entries = await fs.readdir(OFFICIAL_PLUGINS_DIR, { withFileTypes: true });
    dirs = entries.filter((e) => e.isDirectory()).map((e) => path.join(OFFICIAL_PLUGINS_DIR, e.name));
  } catch {
    return; // no official plugins directory — skip
  }

  for (const pluginDir of dirs) {
    try {
      const manifestPath = path.join(pluginDir, "manifest.json");
      const manifestRaw  = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      const manifest     = validateManifest(manifestRaw);

      // Build a synthetic AdmZip from the migration files for the runner
      const migrationZip = new AdmZip();
      for (const name of manifest.migrations) {
        for (const dir of ["up", "down"] as const) {
          const filePath = path.join(pluginDir, "migrations", `${name}.${dir}.sql`);
          const sql      = await fs.readFile(filePath, "utf8").catch(() => "");
          migrationZip.addFile(`migrations/${name}.${dir}.sql`, Buffer.from(sql));
        }
      }
      // Add manifest.json to the zip
      migrationZip.addFile("manifest.json", Buffer.from(JSON.stringify(manifestRaw)));

      const existing = await prisma.installedPlugin.findUnique({ where: { id: manifest.id } });
      if (existing) {
        // Already installed — run any new migrations that haven't been applied yet
        await runUpMigrations(migrationZip, manifest);
        pluginRegistry.register(manifest, existing.status as "enabled" | "disabled" | "installed");
        logger.info({ pluginId: manifest.id }, "First-party plugin already installed — checked for new migrations");
        continue;
      }

      // Validate migration pairs
      await validateMigrationPairs(migrationZip, manifest);

      // Run up migrations
      await runUpMigrations(migrationZip, manifest);

      // Create DB record — packagePath points to the plugin directory (not a ZIP)
      // Entrypoints are package-relative (e.g. "server/dist/index.js"); resolve
      // against the plugin dir. Requires the plugin to be built first.
      const serverEntryAbs = manifest.entrypoints?.server
        ? path.join(pluginDir, manifest.entrypoints.server)
        : undefined;

      const manifestForDb = {
        ...manifest,
        entrypoints: serverEntryAbs
          ? { ...manifest.entrypoints, server: serverEntryAbs }
          : manifest.entrypoints,
      };

      await prisma.installedPlugin.create({
        data: {
          id:               manifest.id,
          name:             manifest.name,
          vendor:           manifest.vendor,
          installedVersion: manifest.version,
          status:           "enabled",
          licenseRequired:  manifest.licenseRequired,
          packagePath:      pluginDir,
          manifest:         manifestForDb as unknown as object,
        },
      });

      pluginRegistry.register(manifest, "enabled");
      logger.info({ pluginId: manifest.id }, "First-party plugin bootstrapped and enabled");
    } catch (err) {
      logger.warn({ pluginDir, err }, "Failed to bootstrap first-party plugin");
    }
  }
}
