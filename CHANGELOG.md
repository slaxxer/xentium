# Changelog

## Plugin table-naming validator

- **Migrations are now namespace-checked, not just DDL-checked.** Every plugin
  migration already had to be DDL-only; the runner now also inspects the object
  names each statement creates, alters, drops, or indexes.
- **Reserved core namespace is protected for every plugin** — a migration may no
  longer create, alter, or drop any object whose name begins `ncf_`, `nodevo_`,
  `_prisma`, `pg_`, or `information_schema`. This closes the door on a plugin
  reaching into core tables or Prisma/Postgres internals. Enforced whether or not
  the plugin declares a prefix.
- **Optional `tablePrefix` manifest field** — when a plugin declares one (short,
  snake_case, ending in `_`, e.g. `forum_`), the runner requires **every** table,
  index, sequence, type, function, and trigger its migrations create — and every
  object they alter/drop/index — to carry that prefix. Keeps a plugin's schema in
  its own namespace and unable to collide with core or another plugin.
- **New error code `NEC-PLUGIN-2013`** for both violation kinds, catalogued in the
  ACP Error Reference and translated across all five bundled languages
  (en/de/es/fr/pt).
- `CREATE EXTENSION` (global objects such as `pg_trgm`) and `COMMENT` are exempt
  from the naming rules. The check runs on the same quote-/dollar-aware statement
  tokenizer the executor uses, so validator and runner can't disagree on
  boundaries.
- The four official plugins declare their prefixes (`forum_`, `pm_`, `amod_`,
  `sb_`); all 54 of their existing up/down migration files pass strict
  enforcement unchanged.
