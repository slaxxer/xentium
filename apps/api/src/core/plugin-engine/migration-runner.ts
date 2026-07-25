import crypto from "node:crypto";
import AdmZip from "adm-zip";
import { prisma } from "../../infrastructure/db.js";
import { validateMigrationSql, splitSqlStatements } from "./sql-validator.js";
import type { PluginManifest } from "./manifest-validator.js";
import { NodevoError } from "../../shared/errors/NodevoError.js";
import { NEC } from "../../shared/errors/nec.js";

function checksum(sql: string): string {
  return crypto.createHash("sha256").update(sql).digest("hex");
}

function migrationId(pluginId: string, ver: string, name: string): string {
  return `${pluginId}_${ver}_${name}`;
}

/** Run all pending .up.sql migrations for a plugin from a ZIP buffer. */
export async function runUpMigrations(
  zip:      AdmZip,
  manifest: PluginManifest,
): Promise<void> {
  const { id: pluginId, version: pluginVer, migrations } = manifest;
  if (!migrations.length) return;

  for (const name of migrations) {
    const entryPath = `migrations/${name}.up.sql`;
    const entry     = zip.getEntry(entryPath);
    if (!entry) throw new NodevoError({ code: NEC.PLUGIN_MIGRATION_MISSING, httpStatus: 422, message: `Migration file not found in package: ${entryPath}` });

    const sql  = entry.getData().toString("utf8");
    const hash = checksum(sql);
    const mid  = migrationId(pluginId, pluginVer, name);

    // Skip if already applied
    const existing = await prisma.nodevoPluginMigration.findUnique({ where: { id: mid } });
    if (existing) {
      if (existing.checksum !== hash) {
        throw new NodevoError({ code: NEC.PLUGIN_MIGRATION_CHECKSUM, httpStatus: 409, message: `Migration ${name} has been modified since it was applied (checksum mismatch).` });
      }
      continue;
    }

    // Validate DDL-only + naming before executing
    validateMigrationSql(sql, entryPath, { tablePrefix: manifest.tablePrefix });

    // Run inside a transaction
    await prisma.$transaction(async (tx) => {
      // Split on top-level semicolons (dollar-quoted bodies kept intact)
      const stmts = splitSqlStatements(sql);
      for (const stmt of stmts) {
        await tx.$executeRawUnsafe(stmt);
      }
      await tx.nodevoPluginMigration.create({
        data: { id: mid, pluginId, pluginVer, name, checksum: hash, direction: "up" },
      });
    });
  }
}

/**
 * Run only migrations NOT yet applied for this plugin, matching by NAME across
 * every version. Used by the update path: the tracking id embeds the version
 * (`${pluginId}_${ver}_${name}`), so a plugin updated 1.0.0 → 1.0.1 whose manifest
 * still lists the historical `001_init` would otherwise recompute a 1.0.1-keyed id,
 * miss the 1.0.0-keyed tracking row, and RE-RUN the migration ("relation already
 * exists"). Migration names are a one-time schema change per plugin lifetime, so a
 * name already tracked (any version) is genuinely applied — skip it. New names run
 * and are tracked under the manifest's current version.
 */
export async function runNewUpMigrations(
  zip:      AdmZip,
  manifest: PluginManifest,
): Promise<void> {
  const { id: pluginId, version: pluginVer, migrations } = manifest;
  if (!migrations.length) return;

  const applied = await prisma.nodevoPluginMigration.findMany({
    where:  { pluginId },
    select: { name: true },
  });
  const appliedNames = new Set(applied.map((m) => m.name));

  for (const name of migrations) {
    if (appliedNames.has(name)) continue; // applied in this or a prior version

    const entryPath = `migrations/${name}.up.sql`;
    const entry     = zip.getEntry(entryPath);
    if (!entry) throw new NodevoError({ code: NEC.PLUGIN_MIGRATION_MISSING, httpStatus: 422, message: `Migration file not found in package: ${entryPath}` });

    const sql = entry.getData().toString("utf8");
    validateMigrationSql(sql, entryPath, { tablePrefix: manifest.tablePrefix });

    await prisma.$transaction(async (tx) => {
      const stmts = splitSqlStatements(sql);
      for (const stmt of stmts) {
        await tx.$executeRawUnsafe(stmt);
      }
      await tx.nodevoPluginMigration.create({
        data: { id: migrationId(pluginId, pluginVer, name), pluginId, pluginVer, name, checksum: checksum(sql), direction: "up" },
      });
    });
  }
}

/** Reverse all applied .down.sql migrations for a plugin from a ZIP buffer. */
export async function runDownMigrations(
  zip:      AdmZip,
  manifest: PluginManifest,
): Promise<void> {
  const { id: pluginId, version: pluginVer, migrations } = manifest;
  if (!migrations.length) return;

  // Reverse order for down migrations
  const reversed = [...migrations].reverse();

  for (const name of reversed) {
    const mid = migrationId(pluginId, pluginVer, name);
    const applied = await prisma.nodevoPluginMigration.findUnique({ where: { id: mid } });
    if (!applied) continue;

    const entryPath = `migrations/${name}.down.sql`;
    const entry     = zip.getEntry(entryPath);
    if (!entry) throw new NodevoError({ code: NEC.PLUGIN_MIGRATION_MISSING, httpStatus: 422, message: `Down migration not found: ${entryPath}` });

    const sql = entry.getData().toString("utf8");
    validateMigrationSql(sql, entryPath, { tablePrefix: manifest.tablePrefix });

    await prisma.$transaction(async (tx) => {
      const stmts = splitSqlStatements(sql);
      for (const stmt of stmts) {
        await tx.$executeRawUnsafe(stmt);
      }
      await tx.nodevoPluginMigration.delete({ where: { id: mid } });
    });
  }
}

/**
 * Best-effort cleanup of any schema a plugin's migrations create, by running
 * EVERY .down.sql in reverse order regardless of tracking, swallowing per-statement
 * errors (objects may legitimately not exist).
 *
 * Used to recover from orphaned state — schema left behind by a prior messy
 * install/uninstall with no migration tracking — so a fresh install's up
 * migrations apply cleanly. Does NOT touch the tracking table; the caller is
 * responsible for ensuring no tracking rows exist (i.e. this is genuinely orphaned).
 * Because the shipped down migrations use `DROP ... IF EXISTS`, running this on a
 * clean database is a harmless no-op.
 */
export async function forceCleanupSchema(
  zip:      AdmZip,
  manifest: PluginManifest,
): Promise<void> {
  const { migrations } = manifest;
  if (!migrations.length) return;

  for (const name of [...migrations].reverse()) {
    const entry = zip.getEntry(`migrations/${name}.down.sql`);
    if (!entry) continue;

    const sql = entry.getData().toString("utf8");
    try {
      validateMigrationSql(sql, `migrations/${name}.down.sql`, { tablePrefix: manifest.tablePrefix });
    } catch {
      continue; // skip anything that isn't valid DDL — never run untrusted SQL
    }

    // Run each statement on its own so one failure doesn't abort the rest.
    for (const stmt of splitSqlStatements(sql)) {
      try {
        await prisma.$executeRawUnsafe(stmt);
      } catch {
        // Expected when the object doesn't exist — this is best-effort cleanup.
      }
    }
  }
}

/** Validate that every .up.sql listed in migrations has a matching .down.sql. */
export function validateMigrationPairs(zip: AdmZip, manifest: PluginManifest): void {
  for (const name of manifest.migrations) {
    if (!zip.getEntry(`migrations/${name}.up.sql`)) {
      throw new NodevoError({ code: NEC.PLUGIN_MIGRATION_MISSING, httpStatus: 422, message: `Missing migration file: migrations/${name}.up.sql` });
    }
    if (!zip.getEntry(`migrations/${name}.down.sql`)) {
      throw new NodevoError({ code: NEC.PLUGIN_MIGRATION_MISSING, httpStatus: 422, message: `Missing down migration: migrations/${name}.down.sql — every up migration must have a matching down migration.` });
    }
    // Pre-validate SQL (DDL-only + naming)
    const policy = { tablePrefix: manifest.tablePrefix };
    validateMigrationSql(zip.getEntry(`migrations/${name}.up.sql`)!.getData().toString(), `${name}.up.sql`, policy);
    validateMigrationSql(zip.getEntry(`migrations/${name}.down.sql`)!.getData().toString(), `${name}.down.sql`, policy);
  }
}
