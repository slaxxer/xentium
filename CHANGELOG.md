# Changelog

## Installing Xentium is one command now

### Added

- **`npm create xentium@latest my-community`** installs a whole site: it checks the
  server, sets up PostgreSQL and Redis, installs the app from npm, offers to install
  systemd units, and hands you the address for the install wizard. About a minute, no
  clone and nothing to compile. `--check` runs only the checks and stops, `--json` for a
  script, `--package <tgz>` for a server with no registry access.
- **The `xentium` command** manages the site afterwards: `start`, `stop`, `restart`,
  `status`, `doctor`, `backup`, `update`, `rollback` and `install-service`. It is
  installed into the site, so `npx xentium status` works inside the directory.
- **`xentium update`** installs the new release *next to* the running one, checks every
  installed plugin's supported version window, dumps the database, migrates, and moves
  the `current` symlink. If the site does not answer afterwards it moves the symlink
  back, restarts, and restores the dump when a migration had already run. It refuses to
  go backwards; that is what `xentium rollback` is for.
- **`@xentium/server`**, the app as an npm package: the built API and web app, the Prisma
  schema, migrations and CLI, with an `npm-shrinkwrap.json` so every server installs the
  dependency tree we tested. Built with `pnpm pack:server`.
- **One list of system requirements** (`SYSTEM_REQUIREMENTS`), read by the installer, the
  install wizard, the setup-mode server and `xentium doctor`. There were two copies of
  the minimum Node version before, and they disagreed: the wizard accepted Node 20 while
  the app needs 22.12.
- Checks now say what to do about what they find, with the command for the system they
  are running on (apt, dnf, pacman, apk or brew).
- **Redis eviction policy** is checked. BullMQ keeps queued jobs in Redis, and every
  policy but `noeviction` is allowed to throw them away when memory runs out. The
  Compose file the installer writes sets it.
- **`XENTIUM_ENV_FILE`** says where `.env` lives, so an install can keep its config
  outside the app directory and updates never touch it.
- New wiki page: [Installing Xentium on a server](https://doc.xentium.org/admin/installing/).

### Fixed

- **A fresh install asked for the database twice.** The installer wrote and tested the
  connection, and then the wizard asked for the credentials again, because the app only
  knew how to start in setup mode when anything was missing. It now generates the
  secrets it can generate itself and boots straight into the wizard.
- **Setup mode ignored `PORT`.** It could not read `.env` (reading it is what setup mode
  exists to avoid doing through the config module), so an install on port 4411 was
  greeted by a wizard on 4000.
- **Setup mode served no web app.** In a production install there is no Vite, so the
  wizard an admin was told to open had nothing to serve it. It now serves the built SPA.
- **The worker booted into a database with no tables** and filled the admin's first
  screen with "table does not exist". It waits for the schema now, the way it already
  waited for the config.
- **`pg_dump` rejected our own connection URL.** Prisma's `?schema=` is not a libpq
  parameter, and backups failed on it. A non-default schema becomes `--schema` instead.

### Changed

- The monorepo's root package is `xentium-monorepo`. The published CLI is `xentium`, and
  two workspace packages with the same name make `--filter xentium` ambiguous.
