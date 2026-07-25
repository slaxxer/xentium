# Last Codebase Update — 2026-07-25

DB naming validator (the open "ncf_/plugin prefix enforcement" TODO). Plugin
migrations are now checked for object naming, not only for being DDL-only: they
can no longer touch core-reserved namespaces, and — when a plugin declares a
`tablePrefix` — every object they create must carry it.

## Plugin engine

- `plugin-engine/sql-validator.ts`
  - `validateMigrationSql(sql, filename, policy?)` gained an optional
    `MigrationSqlPolicy` (`{ tablePrefix? }`).
  - New `extractGovernedNames(stmt)` pulls the object names a DDL statement
    governs (CREATE/ALTER/DROP TABLE, CREATE INDEX + its ON-table, SEQUENCE,
    TYPE, FUNCTION, TRIGGER + its ON-table, and the DROP forms). Names are
    normalized (schema qualifier + quotes stripped, lowercased). `CREATE
    EXTENSION` and `COMMENT` govern nothing of the plugin's own → exempt.
  - Two guards run per statement after the existing DDL-only allowlist:
    **reserved** (`ncf_|nodevo_|_prisma|pg_|information_schema`, always on) and
    **prefix** (only when `tablePrefix` set). Both throw `NEC-PLUGIN-2013`.
- `plugin-engine/manifest-validator.ts` — `tablePrefix?` added to the Zod schema
  (`^[a-z][a-z0-9]*_$`).
- `plugin-engine/migration-runner.ts` — every `validateMigrationSql` call site
  (up / new-up / down / force-cleanup / pair-validate) now threads
  `{ tablePrefix: manifest.tablePrefix }`.

## Contracts / SDK / docs

- `packages/contracts/src/nec.ts` — `PLUGIN_TABLE_NAMING: "NEC-PLUGIN-2013"`.
- `packages/plugin-sdk/src/index.ts` — `tablePrefix?` on the `PluginManifest`
  authoring type.
- `README.md` — manifest example gains `tablePrefix`; new "Table naming"
  paragraph documents the rule + reserved namespaces + NEC-PLUGIN-2013.

## ACP Error Reference

- `ErrorReferencePage.tsx` — `META["NEC-PLUGIN-2013"]` (Error / Plugin Engine).
- `apps/web/public/locales/{en,de,es,fr,pt}/acp.json` — `errorRef.codes`
  gains a localized 2013 entry (msg/desc/cause/fix) in each language
  (single 6-line hunk per file, ordered right after 2012).

## Test

- New `plugin-engine/sql-validator.test.ts` (20 cases): DDL-only behaviour
  preserved, reserved-namespace rejection (create/alter/drop/index,
  schema-qualified, `_prisma`), prefix pass/fail (tables, index name, index
  ON-table, DEFAULT-literal false-positive guard), functions/triggers, and
  EXTENSION/COMMENT exemptions.

## Local-only (git-ignored, not committed)

- The four `plugins/official/*/manifest.json` gained their real prefixes
  (`forum_`, `pm_`, `amod_`, `sb_`) so dev-boot bootstrap exercises the guard.
  Verified via a throwaway script running the real validator over all 54
  official up/down migration files — 100% pass.

## Verification

- `pnpm backbone:check`: typecheck / lint / build green across the monorepo.
- `pnpm --filter @nodevo/api test`: 41/41 pass (with dev infra up), including the
  20 new sql-validator cases. (The 4 installer integration tests only fail when
  Postgres is down — environmental, not code.)
- Locale diffs confirmed as a single 6-line insertion each (no reflow).
