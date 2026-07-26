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
- [Working on core](#working-on-core)
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
- 🛡️ **Moderation** — reports, warnings, bans, review cases fed by **built-in abuse-pattern detection** (rapid logins, multi-account, registration bursts, ban evasion — informational, never auto-acting), immutable log, threshold engine, and a floating ModCanvas tool.
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
- **Auth** — RS256 access JWT (15-min, `Authorization: Bearer`, held in memory) + rotating refresh token (httpOnly, `SameSite=Strict` cookie).
- **The core never knows a plugin exists.** Plugins contribute through **registries** — core iterates whatever's registered and never hardcodes plugin tables, ids, or routes. Search and the home feed both follow this exact pattern.

```
Plugin (onEnable)  ──registers──▶  core registry  ──core iterates──▶  merged result
   e.g. registerSearchSource(...)      searchRegistry      GET /api/search
```

---

## Working on core

The conventions below are load-bearing — new core code is expected to follow them, and PRs
that hand-roll what a shared utility already does will be asked to switch.

### Module shape

`modules/<name>/<name>.routes → .controller → .service` (+ `.validation` / `.types` /
`.test`). Services may use Prisma directly; extract a `.repository` **only** when a query is
shared between services or genuinely complex — it is not a required layer.

### Controllers are plain async handlers

Express 5 forwards rejected promises to the error middleware — there is **no `wrap()`
helper** and there are **no request casts**. `req.userId`, `req.sessionId`, and
`req.file.detectedExt` are ambiently typed via `apps/api/src/types/express.d.ts`; if you
find yourself writing `(req as any)` or a local `AuthedRequest`, stop — the typing already
exists.

```ts
// A complete controller. Throws (incl. NodevoError) reach errorMiddleware on their own.
export async function getThing(req: Request, res: Response) {
  const { id } = paramsSchema.parse(req.params);       // Zod on EVERY input
  res.json(await thingService.get(id, req.userId));
}
```

### The shared utilities (use these, don't reimplement)

| Utility (`apps/api/src/shared/utils/`) | Use it for | Rules |
|---|---|---|
| `settings.ts` — `getSetting` / `getSettings` / `getFreshSetting` / `bustSettingsCache` | every settings read | Reads are TTL-cached (15 s); batch multiple keys with `getSettings({key: default})`. **Every writer in the same process must call `bustSettingsCache(key)`.** Use `getFreshSetting` only where staleness is unacceptable (e.g. appearance tokens). |
| `paginate.ts` — `paginate()` (meta via `buildPaginationMeta` from `@nodevo/contracts`) | every list endpoint | `buildPaginationMeta` is the **only** producer of `{page, limit, total, totalPages, hasPrev, hasNext}` — never hand-roll the meta object. |
| `userRef.ts` — `USER_REF_SELECT` / `toUserRef` | naming a user in any response | The one way responses reference a user (`id`, `username`, badge color). The `UserRef` type lives in `@nodevo/contracts`. |
| `memoTtl.ts` — `memoTtl` / `TtlCache` | in-process caching of anything hot | Backs the settings cache and the `/appearance/css` memo; reach for it before inventing a cache. |

On the web side the equivalent load-bearing primitives are `lib/toast.ts`
(`toast.success/info/warning/error` — Nodevo's own toast system: stacking, dedup ×N,
per-category durations, hover-pause; themed by the Style Editor's Feedback colours) and
`lib/dialog.ts` (`openDialog` — promise-based confirm/alert). `lib/swal.ts` is a legacy-named
facade over both (sweetalert2 is gone); new code imports `toast`/`openDialog` directly.

### Errors, validation, data

- Every endpoint validates **body, params, and query** with Zod before any logic;
  `ZodError` → `NEC-API-4001` centrally. Errors are `NodevoError` with `NEC-<DOMAIN>-<CODE>`;
  stack traces never reach clients.
- Core tables are `ncf_<snake_case>`; soft delete via `deletedAt` (queries default to
  excluding deleted rows). TipTap content is stored as ProseMirror JSON, never raw HTML.
- The API is locale-agnostic (machine keys + NEC codes only); only emails/notifications are
  server-localized.

### Security detection

Abuse detection (§15) is core: four baseline patterns run on the `security-analysis` job
every 30 minutes and open informational review cases (ACP → Moderation → Review Cases,
ModCanvas → Cases). Detection **never auto-acts**. Plugins extend via `registerSecurityScan`
or replace baselines via `claimSecurityPatterns`. Full pipeline, thresholds, and operational
notes: [`docs/security-detection.md`](docs/security-detection.md).

### Two processes, one codebase

The HTTP server (`server.ts`) and the worker (`worker.ts`) are separate processes that both
load plugins and read the same registries. If you touch job code or anything a plugin
registers into, remember the **worker** needs a restart to pick it up — in dev,
`./nodevo.sh` runs both.

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
  "tablePrefix": "myplugin_",
  "permissions": ["myplugin.thing.create"],
  "migrations": ["001_create_things"],
  "entrypoints": {
    "server": "server/dist/index.js",
    "web": "web/dist/index.umd.js"
  }
}
```

### Migrations & database conventions

Plugins own their schema through raw-SQL migrations, tracked **separately** from
core (Prisma) in the `nodevo_plugin_migrations` table. Every rule below is
enforced by the host on install/enable/update — a violation aborts the operation
with the noted `NEC-PLUGIN-*` code, so design to them from the start.

- **DDL only.** Migration files may contain only `CREATE` / `ALTER` / `DROP` of
  `TABLE`, `INDEX`, `SEQUENCE`, `TYPE`, `FUNCTION`, `TRIGGER` (plus
  `CREATE EXTENSION`). Any DML (`INSERT`/`UPDATE`/`DELETE`/`SELECT`/`TRUNCATE`/
  `COPY`/…) is rejected → `NEC-PLUGIN-2010`. Seed data belongs in your
  `onEnable`, not a migration.
- **Paired up/down.** Every `NNN_name.up.sql` must ship a matching
  `NNN_name.down.sql` → `NEC-PLUGIN-2011`. Use `IF EXISTS` / `IF NOT EXISTS`
  so down migrations are safely re-runnable.
- **Table naming.** Core tables use the `ncf_` prefix; a plugin's schema must
  stay in its own namespace. Declare a **`tablePrefix`** (short, snake_case,
  ending in `_` — e.g. `forum_`, `sb_`) and the runner enforces that **every**
  table, index, sequence, type, function, and trigger your migrations create —
  or alter/drop/index — begins with it. Regardless of whether you declare one,
  no plugin migration may ever touch a reserved core object (names beginning
  `ncf_`, `nodevo_`, `_prisma`, `pg_`, or `information_schema`) → both violations
  raise `NEC-PLUGIN-2013`. `CREATE EXTENSION` and `COMMENT` are exempt. Declaring
  a prefix is optional but strongly recommended — all four official plugins do.
- **Applied migrations are immutable.** Once a migration has run, its checksum is
  recorded; editing that file afterwards is rejected → `NEC-PLUGIN-2012`. Ship
  schema changes as a **new** migration in the next version — never rewrite
  history.
- **Updates are forward-only, matched by name.** On update the runner runs only
  migrations whose *name* it hasn't seen before (across any version), so keep the
  historical list in the manifest intact and only append. Never renumber or
  rename an already-shipped migration.
- **No cross-boundary foreign keys.** Prisma is unaware of plugin tables, so a
  plugin table cannot `REFERENCES` a core table (and core can't reference yours).
  Store the id (e.g. `user_id TEXT`) and enforce integrity at the service layer;
  clean up on account deactivation via the SDK's `onUserDeactivated` hook.

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

    // An ACP sidebar page (returned by GET /api/admin/registered-pages).
    // Convention: plugin ACP settings pages AUTOSAVE on change (useAutosave +
    // AutosaveStatus from the host globals) — no Save buttons, matching core
    // config pages. Secrets (API keys) are the exception: explicit Set/Remove.
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

    // A SECURITY SCAN — runs on the core security-analysis cadence (every 30 min);
    // open review cases via ctx.host.security.createCase(...).
    ctx.registerSecurityScan(async () => { /* … */ });

    // Optionally CLAIM core baseline detection patterns your scan replaces with an
    // enhanced variant — core skips its built-in while you're enabled, and the
    // baseline resumes automatically when you're disabled.
    ctx.claimSecurityPatterns(["multi_account_suspicion"]);
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

### ACP admin UI — config surfaces autosave

Nodevo ACP **config** pages have no Save button: they persist on change and show a status
indicator instead. Your plugin's admin UI must follow the same convention or it will feel
foreign inside the ACP. Externalize the two host bridges in your `vite.config.ts`:

```ts
"@web/hooks/useAutosave":         `${H}.webUseAutosave`,
"@web/components/AutosaveStatus": `${H}.webAutosaveStatus`,
```

```tsx
const saveMut = useMutation({ mutationFn: (v: Settings) => api.put(`${BASE}/admin/settings`, v) });
useAutosave({ value: form, savedValue: data, onSave: (v) => { if (v) saveMut.mutate(v); } });
// …and render <AutosaveStatus saving={saveMut.isPending} /> in the header.
```

This applies to settings pages **and** per-group panels registered through the
`groupConfigPanel` slot — which is where RBAC/progression-adjacent config belongs, so it
appears as a tab in core's own Group settings dialog rather than a standalone page. An
explicit action is still correct for **create/edit entity modals**, **secrets** (never
autosave a half-typed credential — give it a Set/Remove), and **destructive actions**.

📖 **Full recipe, the failure modes, and the `groupConfigPanel` + progression path:
[`docs/plugin-acp-autosave.md`](docs/plugin-acp-autosave.md).**

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

> **Registrations are in-memory.** Everything `onEnable` registers (routes, ACP pages,
> content sources, security scans/claims, NEC codes) lives in the host process's registries
> and is rebuilt at startup from the `ncf_installed_plugins` table. The lifecycle endpoints
> keep memory and DB in sync — but if plugin state is changed **underneath a running
> process** (manual row deletion, a DB reset in dev), the process keeps serving stale
> registrations (e.g. a ghost ACP menu entry for a plugin that no longer exists) until it is
> restarted. Restarting the API + worker always resyncs. The worker loads plugins too — after
> replacing a plugin package, restart it so scheduled scans use the new code.

---

## Migrating from another platform

Nodevo ships **free, open-source migration tooling** as a standalone CLI — deliberately *not* a plugin: it runs once on your server, writes directly to the Nodevo database, and leaves nothing behind except the migration log (visible in **ACP → System → Migration History**).

### Available adapters

| Adapter | Source | Status |
|---|---|---|
| `@nodevo/migrate-wp` | WordPress — a **WXR export file** (wp-admin → Tools → Export). No WordPress install or database access needed. | ✅ Available |
| `@nodevo/migrate-phpbb` | phpBB 3.1+ — direct **MySQL connection**. Requires the `nodevo-forum` plugin installed and enabled on the target (checked before anything runs). Users keep their passwords. | ✅ Available |
| `@nodevo/migrate-xenforo` | XenForo 2.x — direct **MySQL connection**. Requires the `nodevo-forum` plugin on the target. Users with native bcrypt hashes keep their passwords. | ✅ Available |
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

# Forum platforms: point at the board's MySQL database instead of a file
# (same flags for @nodevo/migrate-xenforo; --prefix overrides the table prefix)
pnpm --filter @nodevo/migrate-phpbb migrate -- \
  --source-db "mysql://user:pass@host:3306/phpbb" \
  --db "postgresql://…" --dry-run
```

The target must be an **installed** Nodevo instance (run the wizard first). Migrations are **resumable**: every imported entity is tracked in an import map, so a re-run after an interruption continues where it stopped instead of duplicating — and accounts matched by email map onto existing users.

### What carries over

- **Users** — accounts, display names, join dates, and best-effort role mapping (admins → Administrator, moderators → Moderator). Where the source provides password hashes (database-based adapters; XenForo's are extracted from its serialized auth blobs), users **keep their passwords**: the original hash is verified on first login and transparently upgraded to Nodevo's argon2. WXR file exports contain no hashes, so WordPress users reset their password once.
- **Content** — categories (with hierarchy), posts/articles (converted to the TipTap editor format — headings, lists, quotes, code, images and links survive), tags, and member comments (threaded one level). Forum platforms: the full node tree, threads (locked/pinned/view counts) and posts with their BBCode converted.
- **Social graph** (where the source has one) — XenForo **reactions become post likes** (every reaction type collapses to a like), **follows migrate 1:1**, and ignores become blocks; phpBB foes become blocks (its *friend* flag is a private buddy list and is deliberately not turned into public follows). A block suppresses follow relationships in both directions, matching Nodevo's rules, and all like/follower counters are recomputed.
- **Not migrated** — themes/styling (Nodevo has its own appearance system), source-platform plugins, private messages, guest comments (Nodevo comments require an account), and in this version media files/attachments (referenced by URL, not downloaded). Everything skipped is itemized with a reason in the migration report.

---

## Contributing

1. Branch off `development`.
2. Make your change; keep modules in their `routes → controller → service` shape (a `.repository` only when a query is shared or complex — see [Working on core](#working-on-core)) and put shared types in `@nodevo/contracts`.
3. **`pnpm backbone:check`** must be green (typecheck + lint + test + build).
4. Validate all input with Zod; enforce permission/license checks on the backend.
5. Ship Prisma schema changes with a migration in the same PR.
6. Open a PR to `development` — the PR template includes the merge-readiness checklist.

See `docs/` for the API reference and architecture ADRs.

---

## License

MIT — see [LICENSE](./LICENSE). The open-source core is free to use; official premium plugins are licensed separately and never gate core functionality.
