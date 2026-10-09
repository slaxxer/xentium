/**
 * @xentium/plugin-engine — the parts of the plugin system that know nothing
 * about the application hosting them (ADR-0006).
 *
 * WHAT IS HERE: manifest parsing and compatibility, the DDL-only SQL guard that
 * vets a plugin's migrations, the in-memory registry of loaded plugins, and the
 * `/api/p/:pluginId` router with its enabled-check.
 *
 * WHAT IS NOT (yet): `plugin-engine.ts` itself and the migration runner. Both
 * are destructive — they extract archives, run DDL and delete files — and both
 * currently reach for three Prisma models and a license check. They want a
 * store abstraction and their own change, not a ride along with the pure
 * pieces. They stay in `apps/api` until then.
 *
 * WHAT NEVER WILL BE: `plugin-context.ts`. That is the host bridge — the CMS's
 * registries for search, home feed, progression, stats and layout templates. A
 * framework package owns the engine and the SHAPE of a context; each
 * application supplies its own bridge.
 */
export { manifestSchema, validateManifest, assertCompatible, createManifestValidator } from "./manifest.js";
export type { PluginManifest } from "./manifest.js";

export { baseVersion, compareBaseVersions, compareVersions, meetsMinimum, withinMaximum } from "./version.js";

export { pluginRegistry, PluginRegistry } from "./registry.js";
export type { LoadedPlugin, PluginLoadError } from "./registry.js";

export { pluginRouter, PluginRouter } from "./router.js";

export { SIGNATURE_ENTRY, computeContentDigest } from "./signature.js";
export type { PluginSignatureClaims, PackageEntry } from "./signature.js";

export { validateMigrationSql, splitSqlStatements } from "./sqlValidator.js";
export type { MigrationSqlPolicy } from "./sqlValidator.js";
