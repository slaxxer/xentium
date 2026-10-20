# Changelog

## Security fixes

This release fixes security problems we found while reviewing the codebase. Please update
soon. Older alphas don't get these fixes.

### Fixed

- **Sign-in sessions.** Two refreshes sent with the same refresh token at the same moment
  could both succeed and leave two live sessions behind. Now a token can be used to refresh
  only once. If a token that has already been replaced turns up again more than 30 seconds
  later, someone holds a copy of it, so every session of that sign-in is signed out. Several
  tabs refreshing at once still keep you signed in.
- **Plugin migrations.** The check that limits plugin migrations to schema changes on the
  plugin's own tables could be bypassed. A migration could delete or copy core data, rename
  core indexes, change core types or drop the `pg_trgm` extension. We now read every
  migration with PostgreSQL's own parser and run exactly the statements that passed.
- **Installer.** Steps can no longer run out of order, so an install can't be finished
  without an administrator. Two requests at the same time can't create a second install
  record with a second site id, and preparing the database no longer drops the connection
  the rest of the app is using.

### Breaking for plugin authors

- A plugin with migrations must declare a `tablePrefix` in its manifest.
- Migrations can no longer use foreign keys to core tables, `CREATE TABLE … AS`, views,
  `DROP EXTENSION`, `SECURITY DEFINER` functions, languages other than `plpgsql` and `sql`,
  or `DEFAULT` and `CHECK` expressions that call the plugin's own functions.
  `CREATE EXTENSION IF NOT EXISTS` works for a short list of extensions. The plugin guide
  has the full rules.
- Every official plugin passes the new rules unchanged.

### For developers

- `pnpm e2e` now runs on its own database (yours with `_e2e` appended) and its own ports
  (5175 and 4300), and refuses any database whose name doesn't end in `_e2e` or `_test`.
  It used to reset the database named in your `.env`.

### Upgrading

- Two database migrations run with the update. `xentium update` takes a backup first, as
  always.
