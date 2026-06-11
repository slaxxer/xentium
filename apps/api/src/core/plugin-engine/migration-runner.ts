import crypto from "node:crypto";
import AdmZip from "adm-zip";
import { prisma } from "../../infrastructure/db.js";
import { validateMigrationSql, splitSqlStatements } from "./sql-validator.js";
import type { PluginManifest } from "./manifest-validator.js";

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
    if (!entry) throw new Error(`Migration file not found in package: ${entryPath}`);

    const sql  = entry.getData().toString("utf8");
    const hash = checksum(sql);
    const mid  = migrationId(pluginId, pluginVer, name);

    // Skip if already applied
    const existing = await prisma.nodevoPluginMigration.findUnique({ where: { id: mid } });
    if (existing) {
      if (existing.checksum !== hash) {
        throw new Error(`Migration ${name} has been modified since it was applied (checksum mismatch).`);
      }
      continue;
    }

    // Validate DDL-only before executing
    validateMigrationSql(sql, entryPath);

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
    if (!entry) throw new Error(`Down migration not found: ${entryPath}`);

    const sql = entry.getData().toString("utf8");
    validateMigrationSql(sql, entryPath);

    await prisma.$transaction(async (tx) => {
      const stmts = splitSqlStatements(sql);
      for (const stmt of stmts) {
        await tx.$executeRawUnsafe(stmt);
      }
      await tx.nodevoPluginMigration.delete({ where: { id: mid } });
    });
  }
}

/** Validate that every .up.sql listed in migrations has a matching .down.sql. */
export function validateMigrationPairs(zip: AdmZip, manifest: PluginManifest): void {
  for (const name of manifest.migrations) {
    if (!zip.getEntry(`migrations/${name}.up.sql`)) {
      throw new Error(`Missing migration file: migrations/${name}.up.sql`);
    }
    if (!zip.getEntry(`migrations/${name}.down.sql`)) {
      throw new Error(`Missing down migration: migrations/${name}.down.sql — every up migration must have a matching down migration.`);
    }
    // Pre-validate SQL
    validateMigrationSql(zip.getEntry(`migrations/${name}.up.sql`)!.getData().toString(), `${name}.up.sql`);
    validateMigrationSql(zip.getEntry(`migrations/${name}.down.sql`)!.getData().toString(), `${name}.down.sql`);
  }
}
