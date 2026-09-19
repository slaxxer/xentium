# Last codebase update

Step 3 of the core releases and updates plan: the installer and the CLI. Step 2 (the
`@xentium/server` package) and the shared system requirements are in the same unpushed
batch.

## New

| Path | Purpose |
|---|---|
| `packages/cli/src/checks.ts` | Every system check, in one place. Shared by the installer, `xentium doctor` and (through `SYSTEM_REQUIREMENTS`) the install wizard. Node builtins and `pg` only, so it loads on a machine with nothing of ours on it. |
| `packages/cli/src/site.ts` | The site layout: `xentium.json`, `releases/<v>`, the `current` symlink, `shared/`. Reading and merging `.env`. |
| `packages/cli/src/release.ts` | Installing a release with npm, provenance, migrations, `pg_dump` / restore, the health probe. |
| `packages/cli/src/service.ts` | systemd units (written, installed with sudo, enabled) and the foreground runner. |
| `packages/cli/src/update.ts` | `update` and `rollback`, including the plugin-compatibility gate and the roll-back-on-failure path. |
| `packages/cli/src/cli.ts` | Argument parsing and the commands. |
| `packages/cli/src/ui.ts` | Terminal output, including the ASCII wordmark from `xentium.sh` that heads the installer. No dependency. |
| `packages/cli/src/cli.test.ts` | 15 tests: version checks, `pgConnection`, `mergeEnv`, semver ordering, the unit files. |
| `packages/create-xentium/bin/create-xentium.js` | Old-Node-safe entry. Someone on Node 16 gets a sentence, not a syntax error. |
| `packages/create-xentium/src/index.ts` | The install flow: ask, check, set up the database, write `.env`, install, offer systemd, hand over to the wizard. |
| `packages/create-xentium/src/compose.ts` | The Compose file: PostgreSQL 17 and Redis 7 on 127.0.0.1 only, named volumes, `noeviction`. |
| `packages/create-xentium/src/prompt.ts` | Text, yes/no and pick-one, on `node:readline`. `--yes` and a pipe answer with the defaults. |
| `apps/docs/src/content/docs/admin/installing.md` | The wiki page for installing on a server. |

## Changed

| Path | Why |
|---|---|
| `apps/api/src/server.ts` | Load `.env` into the environment in setup mode, and when only secrets are missing generate them and boot instead of asking for the database a second time. |
| `apps/api/src/setup/setupServer.ts` | Serve the built SPA (there is no Vite in production), and print the address to open. |
| `apps/api/src/worker.ts` | Wait for the schema, not just for the config. |
| `apps/docs/src/content/docs/admin/production.md` | Points at the installer page; the clone is now the developer route. |
| `package.json` | Root package renamed to `xentium-monorepo` so `xentium` means the CLI. |

## Verified

A full install into a scratch directory with the Docker path: checks, Compose up on
127.0.0.1:5433/6380 (5432/6379 were taken, it picked the next free ports), release
installed, `.env` written, app booted, the wizard run to `installed: true`, the site
serving its configured name. Then `status`, `doctor`, `backup`, an `update` to a second
release with the symlink swap, and a `rollback`. `pnpm backbone:check` green.
