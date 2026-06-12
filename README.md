<div align="center">

# Nodevo

**An open-source, extensible CMS & community platform.**

Modular-monolith core · TypeScript end-to-end · plugin-first architecture.

`Node.js 24` · `Express 5` · `React 19` · `PostgreSQL 17` · `Prisma 7` · `Redis 7` · `pnpm + Turborepo`

</div>

---

## Table of contents

- [What is Nodevo](#what-is-nodevo)
- [Tech stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [Environment configuration](#environment-configuration)
- [First run — the installer](#first-run--the-installer)
- [Everyday commands](#everyday-commands)
- [Project structure](#project-structure)
- [Architecture in a nutshell](#architecture-in-a-nutshell)
- [Plugin development guide](#plugin-development-guide)
- [Migrating from another platform](#migrating-from-another-platform)
- [Contributing](#contributing)
- [License](#license)

---

## What is Nodevo

Nodevo is a **production-shaped, open-source community platform** you can run out of the box as an article/CMS site and extend with plugins. The core is fully usable on its own — premium official add-ons (forum, messaging, …) live in **plugins**, never in core.

**Core features**

- 🔐 **Auth & RBAC** — email/password, rotating refresh sessions, flat permission groups, Redis-cached permission resolution.
- 📝 **Articles / CMS** — TipTap editor, nested categories with access control, revisions, comments, likes, tags, full-text search.
- 👤 **Users & social** — profiles, custom profile fields, follow/block, profile walls, a group-based progression ("levels are groups") engine.
- 🛡️ **Moderation** — reports, warnings, bans, review cases, immutable log, threshold engine, and a floating ModCanvas tool.
- 🎨 **Appearance** — three-tier CSS token system, live style editor, `.nvstyle` packs, font system, dynamic nav manager.
- 🔔 **Notifications** — core service every module dispatches through (in-app + queued email).
- 🧩 **Plugin engine** — install/enable/disable lifecycle, sandboxed migrations, dynamic routes/permissions/ACP pages, and registry-based extension points.
- 🛒 **Marketplace & licensing** — per-domain entitlement for official premium plugins (the core never gets bricked).
- 🌍 **i18n** — multilingual from day one (en/de/es/fr/pt bundled), locale-agnostic API.

---

## Tech stack

| Layer | Choices |
|---|---|
| **Backend** | Node.js 24, Express 5, Prisma 7, PostgreSQL 17, Redis 7 + BullMQ, Zod, Pino, argon2, jose |
| **Frontend** | React 19, Vite, React Router 7, TanStack Query, React Hook Form + Zod, SCSS, TipTap |
| **Tooling** | pnpm workspaces, Turborepo, ESLint + Prettier, Vitest + Supertest, Playwright, Docker Compose |

---

## Prerequisites

- **Node.js 24** (see `.nvmrc` — `nvm use` picks it up)
- **pnpm 10** (`corepack enable` provisions the version pinned in `package.json`)
- **Docker** + Docker Compose (for PostgreSQL + Redis), or your own Postgres 17 / Redis 7 instances

That's it — no config files to write. The install wizard collects your database credentials, generates all secrets and writes `.env` for you.

---

## Quick start

```bash
# 1. Clone and install
git clone https://github.com/slaxxer/nodevo.git
cd nodevo
corepack enable          # ensures the pinned pnpm version
pnpm install

# 2. Launch everything (Postgres + Redis containers, Prisma client, api + worker + web)
./nodevo.sh
```

Then open **http://localhost:5173** — you'll be redirected to the **install wizard**, which handles everything else in the browser: it collects your database credentials, **generates all secrets and writes the `.env` file itself**, applies the schema and creates your admin account. No hand-edited config, no restart.

> Using the bundled Docker infra? The wizard's database step wants: host `localhost`, port `5432`, database `nodevo`, user `nodevo`, password `nodevo`.

> Already have a `.env` (an existing install, CI, or a restored config)? The wizard detects it and the database step becomes a plain connection test — nothing is overwritten.

> `./nodevo.sh` brings the infra containers up (waiting for healthchecks), then runs the API, the BullMQ worker, and the web app together. `Ctrl+C` stops the app processes; the containers stay up for fast restarts. Run `./nodevo.sh down` to stop them.

**Default ports:** API → `http://localhost:4000`, web → `http://localhost:5173`, Postgres → `5432`, Redis → `6379`.

---

## Environment configuration

Nodevo reads a single **`.env` at the repo root** — but you normally never write it by hand: **the install wizard creates it on first run** (database URL + all generated secrets, written with mode `0600`). This section is the reference for advanced setups — CI, prebuilt containers, or restoring an existing config.

**How boot decides:** if the required variables below are missing, the API starts in **setup mode** — a minimal server that serves only the install wizard. Once the wizard writes the config, the full application boots in the same process on the same port (no restart). If the variables are present, Nodevo boots normally; the config is validated by Zod at startup (`apps/api/src/config/env.ts`) and the app refuses to run with an invalid one.

### Required

| Variable | Notes |
|---|---|
| `DATABASE_URL` | e.g. `postgresql://nodevo:nodevo@localhost:5432/nodevo` (matches the Docker defaults) |
| `COOKIE_SECRET` | ≥ 16 chars — signs cookies |
| `JWT_SECRET` | ≥ 32 chars — signs HS256 access tokens |
| `DUMMY_ARGON2_HASH` | a throwaway argon2 hash used to equalize login timing (prevents account enumeration) |

### Optional (sensible defaults)

| Variable | Default |
|---|---|
| `NODE_ENV` | `development` |
| `PORT` | `4000` |
| `APP_URL` | `http://localhost:5173` |
| `REDIS_URL` | `redis://localhost:6379` |
| `REDIS_KEY_PREFIX` | `nodevo:` |
| `REFRESH_TOKEN_HMAC_SECRET` | falls back to `JWT_SECRET` when unset (the wizard generates a dedicated one) |
| `UPLOAD_DIR` | `./var/uploads` (resolved from the API process CWD) |
| `BOOTSTRAP_OFFICIAL_PLUGINS` | `false` — when `true`, auto-installs first-party plugins from `plugins/official/` at startup; otherwise install them on demand in the ACP |
| `LICENSE_SERVER_URL`, `LICENSE_*_KEY` | only needed for marketplace/licensing flows |

### Manual setup (optional)

If you'd rather skip the wizard's setup step, copy `.env.example` to `.env` and generate the secrets yourself:

```bash
# COOKIE_SECRET (>=16) and JWT_SECRET (>=32)
echo "COOKIE_SECRET=$(openssl rand -hex 16)"
echo "JWT_SECRET=$(openssl rand -hex 32)"

# DUMMY_ARGON2_HASH (any valid argon2 hash works)
pnpm --filter @nodevo/api exec node --input-type=commonjs \
  -e "require('argon2').hash('nodevo-dummy').then(h=>console.log('DUMMY_ARGON2_HASH='+h))"
```

A complete dev `.env`:

```dotenv
DATABASE_URL="postgresql://nodevo:nodevo@localhost:5432/nodevo"
REDIS_URL="redis://localhost:6379"
APP_URL="http://localhost:5173"
COOKIE_SECRET="<openssl rand -hex 16>"
JWT_SECRET="<openssl rand -hex 32>"
DUMMY_ARGON2_HASH="<argon2 hash from the command above>"
```

---

## First run — the installer

On first launch an **install guard** blocks every route except the installer and the web app redirects you to `/install`. The wizard runs server-side steps in order:

1. **Welcome**
2. **Environment check** — on a fresh clone: Node version, `.env` writability, data directory. With a preconfigured `.env`: Node / PostgreSQL / Redis / disk / config.
3. **Database** — on a fresh clone you enter your PostgreSQL credentials (host, port, database, user, password — plus an optional Redis URL under *Advanced*). Nodevo verifies the connection, **generates `COOKIE_SECRET`, `JWT_SECRET`, `REFRESH_TOKEN_HMAC_SECRET` and `DUMMY_ARGON2_HASH`, writes `.env`** and switches to the full application in place — no restart. With a preconfigured `.env` this step is just a connection test.
4. **Site config** — site name, URL, default language, timezone
5. **Admin account** — create the first administrator
6. **Finalize** — `prisma migrate deploy` applies the schema, core groups/permissions/system profile fields are seeded, and a `site.id` is written to settings
7. **Complete** — links to the ACP and the public site

Once complete, the installer **locks itself out** — the guard lifts and the wizard disappears from navigation. Log in with your admin account and head to the **ACP** (Admin Control Panel) at `/admin`.

> Entered wrong credentials? Nothing is written until the connection check passes — fix the values and hit *Connect & save* again. An existing `.env` is never clobbered: the wizard only fills in missing keys and preserves everything else in the file.

> Migrations are applied by the installer. If you prefer to run them yourself during development, use `pnpm db:migrate`.

---

## Everyday commands

```bash
# Dev
./nodevo.sh                 # infra (Postgres+Redis) + api + worker + web
./nodevo.sh down            # stop infra containers
pnpm dev:apps            # api + worker + web only (infra already up)
pnpm backbone:up         # start just the infra containers
pnpm backbone:down       # stop them

# Database (Prisma)
pnpm db:generate         # regenerate the Prisma client after schema changes
pnpm db:migrate          # create/apply a dev migration
pnpm db:reset            # drop + re-apply (DESTRUCTIVE)
pnpm db:studio           # open Prisma Studio

# Quality gates (run all before opening a PR)
pnpm backbone:check      # typecheck + lint + test + build
pnpm typecheck
pnpm lint
pnpm test
pnpm build

# End-to-end (Playwright)
pnpm e2e                 # reset DB, run the suite
pnpm e2e:ui              # interactive runner

# Plugins
pnpm plugin:package      # build + package a plugin into a .nvplugin
```

Run a single API test file:

```bash
pnpm --filter @nodevo/api exec vitest run src/modules/auth/auth.test.ts
```

---

## Project structure

```
nodevo/
├─ apps/
│  ├─ api/                  Express API + BullMQ worker
│  │  └─ src/
│  │     ├─ app/            App wiring, route registration
│  │     ├─ config/         Zod env, rate-limits, upload-limits
│  │     ├─ core/           Platform engines: plugin / license / installer +
│  │     │                  extension registries (search, home-feed, nec, acp-page)
│  │     ├─ infrastructure/ db, redis, queue, storage, email, logging
│  │     ├─ modules/        Feature modules (auth, users, articles, moderation, …)
│  │     ├─ shared/         errors (NEC), middleware, http, utils
│  │     ├─ jobs/           BullMQ job handlers
│  │     ├─ server.ts       HTTP entry point
│  │     └─ worker.ts       BullMQ worker entry point
│  └─ web/                  Vite + React frontend
│     └─ src/               app, pages, features, components, layouts, hooks,
│                           lib, plugins (slot/theme registries), styles
├─ packages/
│  ├─ contracts/            Shared types/DTOs/enums (permissions, pagination, NEC, …)
│  ├─ sdk/                  Shared runtime helpers (slug, access) + license public key
│  ├─ plugin-sdk/           Public plugin authoring contract
│  ├─ ui/                   Shared React components (GroupAccessPicker)
│  └─ config/              Shared tsconfig base
├─ plugins/
│  ├─ official/             First-party plugins (own repos / licensed)
│  └─ community-examples/   Reference plugins for local dev
├─ prisma/                  Schema + migrations (client → apps/api/src/generated/prisma)
├─ docker/                  Compose for Postgres 17 + Redis 7
├─ scripts/                 Tooling (plugin packaging, …)
├─ e2e/                     Playwright suites
└─ docs/                    API reference + ADRs
```

**Module convention** — every feature module under `apps/api/src/modules/<name>/` keeps the same shape:
`*.routes.ts → *.controller.ts → *.service.ts → *.repository.ts`, plus `*.validation.ts`, `*.types.ts`, `*.test.ts`.

---

## Architecture in a nutshell

- **Modular monolith, not microservices.** Two processes in production: `server.ts` (HTTP) and `worker.ts` (BullMQ).
- **REST-first**, Zod-validated on every endpoint. Errors use typed **NEC codes** (`NEC-AUTH-1001`, …) via a central handler.
- **Auth** — HS256 access token (15-min, `Authorization: Bearer`, held in memory) + rotating refresh token (httpOnly, `SameSite=Strict` cookie).
- **The core never knows a plugin exists.** Plugins contribute through **registries** — core iterates whatever's registered and never hardcodes plugin tables, ids, or routes. Search and the home feed both follow this exact pattern.

```
Plugin (onEnable)  ──registers──▶  core registry  ──core iterates──▶  merged result
   e.g. registerSearchSource(...)      searchRegistry      GET /api/search
```

---

## Plugin development guide

Plugins are how you extend Nodevo without touching core. A plugin can register routes, permissions, ACP pages, nav items, notification types, NEC error codes, and **content sources** (search, home feed). It runs inside the host process but only through the SDK contract — **no unrestricted access to core internals.**

### Anatomy of a plugin

```
my-plugin/
├─ manifest.json           Identity, version, permissions, migrations, entrypoints
├─ server/                 Server entry → exports a PluginDefinition
│  └─ index.ts
├─ web/                    (optional) Web entry → registers UI slots
│  └─ index.ts
└─ migrations/             Raw SQL, paired up/down
   ├─ 001_create_things.up.sql
   └─ 001_create_things.down.sql
```

**`manifest.json`** (validated on install):

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "vendor": "Acme",
  "minNodevoVersion": "1.0",
  "licenseRequired": false,
  "permissions": ["myplugin.thing.create"],
  "migrations": ["001_create_things"],
  "entrypoints": {
    "server": "server/dist/index.js",
    "web": "web/dist/index.umd.js"
  }
}
```

### The server entry

Your server entry exports a `PluginDefinition`. `onEnable(ctx)` is where you wire everything up; `onDisable` is optional (the engine auto-deregisters routes, registries, ACP pages, and NEC codes for you).

```ts
import type { PluginDefinition } from "@nodevo/plugin-sdk";
import { createRouter } from "./router.js";
import { searchThings } from "./service.js";

const plugin: PluginDefinition = {
  id: "my-plugin",

  async onEnable(ctx) {
    // Routes are mounted at /api/p/my-plugin/*  (host services injected via ctx.host)
    ctx.registerRoutes(createRouter(ctx.host));

    // Permission keys (inserted into the permissions table; defaults assigned on first install)
    await ctx.registerPermissions([
      { key: "myplugin.thing.create", label: "Create things", domain: "My Plugin",
        defaults: ["member", "admin"] },
    ]);

    // A frontend nav item (auto-hidden when the plugin is disabled)
    await ctx.registerNavItem({ label: "Things", url: "/things", position: 5 });

    // An ACP sidebar page (returned by GET /api/admin/registered-pages)
    ctx.registerAcpPage({ section: "My Plugin", label: "Things", path: "/admin/things" });

    // Notification types (for the preference UI) + NEC error codes (for the Error Reference)
    ctx.registerNotificationTypes(["myplugin.thing_created"]);
    ctx.registerNecCodes([
      { code: "NEC-MYPLUGIN-6001", msg: "Thing not found", sev: "Error",
        domain: "My Plugin", desc: "…", cause: "…", fix: "…" },
    ]);

    // A SEARCH source — core merges your results; it never queries your tables.
    ctx.registerSearchSource({
      id: "things",
      label: "Things",
      permission: null,                  // null = public, or a permission key to gate
      search: (query, opts) => searchThings(query, opts),  // → { data: SearchResultItem[], total }
    });

    // A HOME FEED source — same idea, for the home/guest feed.
    ctx.registerHomeFeedSource({
      id: "things",
      label: "Things",
      recent: (limit) => /* … */,        // → HomeFeedItem[]
    });
  },
};

export default plugin;
```

### Host services (`ctx.host`)

Everything your plugin needs is injected — you never import core internals:

| `ctx.host.*` | What |
|---|---|
| `prisma` | the host Prisma client (use raw SQL for your own tables) |
| `queues` | BullMQ queues — enqueue jobs; the core worker processes them |
| `middleware` | `requireAuth`, `optionalAuth`, `enforcePostLength` |
| `errors` | `NodevoError`, `NEC` |
| `utils` | shared helpers (e.g. `resolveAvatar`) |
| `notificationService` | dispatch notifications (or use `ctx.notify(...)`) |
| `env`, `logger` | validated config + Pino logger |

### The golden rule — core never knows your schema

The host has **no knowledge of your tables, ids, or routes**. Want your content in search or the home feed? Register a **source** that returns normalized items (`SearchResultItem` / `HomeFeedItem`). Core asks your source to run the query and merges the result — so your plugin can be installed, disabled, or removed and core simply iterates whatever is currently registered. Migrations are tracked separately from core (in `nodevo_plugin_migrations`) and must ship a `down.sql` for every `up.sql`.

### Local development

1. Put your plugin under `plugins/community-examples/<name>/` (or `plugins/official/<name>/`) — both are pnpm workspace members.
2. For HMR on the web side during `vite dev`, add your web entry to the dev registry in `apps/web/src/plugins/dev-plugins.ts` (this edit stays local).
3. Start the stack with `./nodevo.sh`, then **install + enable** your plugin from **ACP → Extensions → Upload** (or set `BOOTSTRAP_OFFICIAL_PLUGINS=true` to auto-load first-party plugins at startup).

### Packaging & distribution

Plugins ship as a **`.nvplugin`** archive (a ZIP of the manifest, compiled `server`/`web` bundles, and migrations):

```bash
node scripts/package-plugin.mjs [pluginDir] [outDir]
# default: plugins/official/nodevo-forum → dist/marketplace/
```

The host plugin engine extracts the archive to a temp dir (with zip-slip protection), validates the manifest and DDL-only migrations, runs them transactionally, then registers and enables the plugin. **Install and enable are always separate operations** — enabling activates routes/registrations; disabling stops them and preserves data.

### Plugin lifecycle

```
upload → validate manifest → compatibility/trust check → install (stored, migrations run)
       → enable (onEnable: routes + registries active)
       → disable (behavior stops, data kept) → uninstall (migrations reversed, package removed)
```

---

## Migrating from another platform

Nodevo ships **free, open-source migration tooling** as a standalone CLI — deliberately *not* a plugin: it runs once on your server, writes directly to the Nodevo database, and leaves nothing behind except the migration log (visible in **ACP → System → Migration History**).

### Available adapters

| Adapter | Source | Status |
|---|---|---|
| `@nodevo/migrate-wp` | WordPress — a **WXR export file** (wp-admin → Tools → Export). No WordPress install or database access needed. | ✅ Available |
| phpBB, XenForo | Direct database connection | Planned (Wave 1) |
| vBulletin, WoltLab Suite | Direct database connection | Planned (Wave 2) |

### Running a migration

```bash
# 1. Always start with a dry run — inspects, extracts and reports, writes NOTHING
pnpm --filter @nodevo/migrate-wp migrate -- \
  --file my-export.xml \
  --db "postgresql://user:pass@localhost:5432/nodevo" \
  --dry-run

# 2. The real run (interactive confirmation; --yes to skip)
pnpm --filter @nodevo/migrate-wp migrate -- --file my-export.xml --db "postgresql://…"
```

The target must be an **installed** Nodevo instance (run the wizard first). Migrations are **resumable**: every imported entity is tracked in an import map, so a re-run after an interruption continues where it stopped instead of duplicating — and accounts matched by email map onto existing users.

### What carries over

- **Users** — accounts, display names, join dates. Where the source provides password hashes (database-based adapters), users **keep their passwords**: the original hash is verified on first login and transparently upgraded to Nodevo's argon2. WXR file exports contain no hashes, so WordPress users reset their password once.
- **Content** — categories (with hierarchy), posts/articles (converted to the TipTap editor format — headings, lists, quotes, code, images and links survive), tags, and member comments (threaded one level).
- **Not migrated** — themes/styling (Nodevo has its own appearance system), source-platform plugins, guest comments (Nodevo comments require an account), and in this version media files (referenced by URL, not downloaded). Everything skipped is itemized with a reason in the migration report.

---

## Contributing

1. Branch off `development`.
2. Make your change; keep modules in their `routes → controller → service → repository` shape and put shared types in `@nodevo/contracts`.
3. **`pnpm backbone:check`** must be green (typecheck + lint + test + build).
4. Validate all input with Zod; enforce permission/license checks on the backend.
5. Ship Prisma schema changes with a migration in the same PR.
6. Open a PR to `development` — the PR template includes the merge-readiness checklist.

See `docs/` for the API reference and architecture ADRs.

---

## License

MIT — see [LICENSE](./LICENSE). The open-source core is free to use; official premium plugins are licensed separately and never gate core functionality.
