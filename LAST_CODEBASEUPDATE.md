# Last codebase update

Release 1.0.0-alpha.6: one fix to the `xentium` CLI, plus the version bump. No API, web,
schema or contract changes.

## fix(cli): find Prisma where npm puts it, and never restore on a guess

The first real `xentium update` from the registry (alpha.4 → alpha.5 on app.xentium.org)
failed: `spawn …/releases/1.0.0-alpha.5/node_modules/.bin/prisma ENOENT`. The published
npm-shrinkwrap makes npm install the app's tree UNDER `node_modules/@xentium/server`, so the
release root has no `.bin/prisma` (verified by installing the published package locally).
`create-xentium` never hit this: the install wizard migrates in-process.

- `packages/cli/src/release.ts`
  - `prismaBin` (now exported) looks in `appDir(version)/node_modules/.bin`, then the release
    root, and throws when neither exists instead of spawning a missing path.
  - `migrationsPending` returns true only on the "pending" text, false on exit 0, and throws
    otherwise. It used to treat ANY non-zero exit (including a spawn failure) as pending,
    which is what sent a restore into a live, untouched database.
  - `backup` dumps with `--clean --if-exists`; `restore` runs `--single-transaction`. A plain
    dump fails on its first CREATE when restored over its own database, so the automatic
    restore could never have succeeded.
- `packages/cli/src/update.ts` — the migration status is read in a try before the services
  stop (failure = "nothing was changed", exit 1); both rollback paths restore BEFORE
  `rollTo` restarts the previous release, not after.
- `packages/cli/src/cli.test.ts` — three tests pinning where `prismaBin` looks.

## chore(release): 1.0.0-alpha.6

- Every workspace `package.json` → `1.0.0-alpha.6` (`scripts/set-version.mjs`).
- `CHANGELOG.md` — the alpha.6 notes (also the release notes admins read).

## Verified

- `pnpm backbone:check` green, API suite 449/449, CLI 20/20.
- app.xentium.org confirmed healthy on alpha.4 after the failed update
  (`/api/install/status` → `installed: true`, `version: 1.0.0-alpha.4`).
