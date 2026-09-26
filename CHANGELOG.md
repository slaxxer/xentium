# Changelog

## `xentium update` works on sites installed from npm

### Fixed

- **Updating a site installed from npm no longer fails before it starts.** npm installs the
  app's own packages inside `@xentium/server`, so the Prisma CLI is not at the top of the
  release folder where `xentium update` looked for it. The updater now looks inside the app
  first, then at the top, and says plainly when neither has it.
- **The updater no longer guesses that migrations ran.** When it could not read the migration
  status it assumed there was work pending, and on failure tried to restore the backup over a
  database that had never been touched. It now stops before taking your site down, and says
  that nothing was changed.
- **A restore can actually succeed.** Backups taken by `xentium backup` and `xentium update`
  now drop and recreate what they contain, so they restore over the database they came from,
  and the restore runs in one transaction: if it fails, your database stays as it was. It
  also runs while the site is stopped, before the old release starts again.

### Upgrading

Update the CLI first, then the site. The fix lives in the CLI, so an older one cannot pick
up this release by itself:

```bash
npm install xentium@1.0.0-alpha.6
npx xentium update 1.0.0-alpha.6
```

Prereleases are published under the `alpha` tag, so name the version (or `alpha`); a plain
`xentium update` reads `latest`.

Backups taken before this release were made without the drop statements, so restore one
into an empty database, not over the live one.
