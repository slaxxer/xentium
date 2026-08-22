/** Moved to `@nodevo/plugin-engine` (ADR-0006) — the DDL-only guard every
 *  plugin migration is held to. Re-exported from the original path so existing
 *  imports keep working. */
export { validateMigrationSql, splitSqlStatements } from "@nodevo/plugin-engine";
export type { MigrationSqlPolicy } from "@nodevo/plugin-engine";
