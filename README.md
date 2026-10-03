<div align="center">

# Xentium

**An open-source, extensible CMS and community platform.**

Modular-monolith core · TypeScript end to end · plugins first

`Node.js 24` · `Express 5` · `React 19` · `PostgreSQL 17` · `Prisma 7` · `Redis 7` · `pnpm + Turborepo`

📖 **Developer docs: [doc.xentium.org](https://doc.xentium.org)**

</div>

---

## Table of contents

- [What is Xentium](#what-is-xentium)
- [Tech stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [Environment configuration](#environment-configuration)
- [First run](#first-run)
- [Everyday commands](#everyday-commands)
- [Project structure](#project-structure)
- [Framework packages (npm)](#framework-packages-npm)
- [Architecture in a nutshell](#architecture-in-a-nutshell)
- [Layout system](#layout-system)
- [Announcements](#announcements)
- [Working on core](#working-on-core)
- [Plugin development guide](#plugin-development-guide)
- [Migrating from another platform](#migrating-from-another-platform)
- [Contributing](#contributing)
- [License](#license)

---

## What is Xentium

Xentium is an open-source community platform. Out of the box you get an article/CMS
site, and you extend it with plugins. The core works fine on its own. Our paid official
add-ons (forum, messaging and so on) are plugins, and we don't move core features into
them.

What's in core:

- 🔐 **Auth & RBAC:** email/password login, rotating refresh sessions, flat permission groups, permissions cached in Redis.
- 📝 **Articles / CMS:** TipTap editor, nested categories with access control, revisions, comments, likes, tags, full-text search.
- 👤 **Users & social:** profiles, custom profile fields, follow/block, profile walls, and a progression system where levels are groups.
- 🛡️ **Moderation:** reports, warnings, bans, an immutable log, thresholds and the floating ModCanvas tool. Built-in abuse detection (rapid logins, multi-accounts, registration bursts, ban evasion) opens review cases for a human. It never acts on its own.
- 🎨 **Appearance:** a three-tier CSS token system, a live Theme Studio, `.xttheme` packages, fonts and a nav manager.
- 🧱 **Layout editor:** arrange blocks in regions to decide what shows up on each page, in the navbar and in the footer. You drag in a tree or right in a live preview; edits autosave as a draft and go live when you publish. Layouts are data, so a theme can't run code.
- 🔔 **Notifications:** one core service every module sends through (in-app and queued email).
- 🧩 **Plugin engine:** install/enable/disable, sandboxed migrations, routes, permissions and ACP pages from plugins, plus registries you can hook into.
- 🛒 **Marketplace & licensing:** per-domain licences for the official paid plugins. A lapsed licence never breaks core.
- 🌍 **i18n:** English, German, Spanish, French and Portuguese bundled. The API itself doesn't care about language.

---

## Tech stack

| Layer | What we use |
|---|---|
| **Backend** | Node.js 24, Express 5, Prisma 7, PostgreSQL 17, Redis 7 + BullMQ, Zod, Pino, argon2, jose |
| **Frontend** | React 19, Vite, React Router 7, TanStack Query, React Hook Form + Zod, SCSS, TipTap |
| **Tooling** | pnpm workspaces, Turborepo, ESLint + Prettier, Vitest + Supertest, Playwright, Docker Compose |

---

## Prerequisites

- **Node.js 24** (there's an `.nvmrc`, so `nvm use` works)
- **pnpm 10** (`corepack enable` gets you the version pinned in `package.json`)
- **Docker** with Compose for PostgreSQL and Redis, or your own Postgres 17 and Redis 7

You don't write any config files. The install wizard asks for your database details,
generates the secrets and writes `.env` for you.

---

## Quick start

```bash
# 1. Clone and install
git clone https://github.com/slaxxer/xentium.git
cd xentium
corepack enable          # gets the pinned pnpm version
pnpm install

# 2. Start everything: Postgres + Redis containers, Prisma client, api + worker + web
./xentium.sh
```

Open **http://localhost:5173** and you'll land in the install wizard. It does the rest in
the browser: checks your database, generates the secrets, writes `.env`, applies the
schema and creates your admin account. You don't restart anything.

> If you use our Docker setup, enter this in the wizard's database step: host `localhost`,
> port `5432`, database `xentium`, user `xentium`, password `xentium`.

> Already have a `.env` (an existing install, CI, a restored config)? The wizard notices,
> and the database step only tests the connection. It doesn't overwrite anything.

> `./xentium.sh` starts the containers, waits until they're healthy, then runs the API,
> the BullMQ worker and the web app together. `Ctrl+C` stops the apps but leaves the
> containers running so the next start is quick. `./xentium.sh down` stops those too.

**Default ports:** API `4000`, web `5173`, Postgres `5432`, Redis `6379`.

---

## Environment configuration

Xentium reads one `.env` file at the repo root. Normally you never touch it: the wizard
writes it on first run (with mode `0600`). This section is for when you need to, e.g. in
CI, in a prebuilt container, or when you restore a config.

**How the API decides what to boot:** if a required variable is missing, it starts in
**setup mode**, a small server that only serves the install wizard. As soon as the wizard
has written the config, the full app starts in the same process on the same port. If the
variables are there, it boots normally. We validate the config with Zod at startup
(`apps/api/src/config/env.ts`), and the API refuses to run on an invalid one.

### Required

| Variable | Notes |
|---|---|
| `DATABASE_URL` | e.g. `postgresql://xentium:xentium@localhost:5432/xentium` (matches our Docker defaults) |
| `COOKIE_SECRET` | at least 16 characters; signs cookies |
| `JWT_SECRET` | at least 32 characters; signs the HS256 access tokens |
| `DUMMY_ARGON2_HASH` | a throwaway argon2 hash. We verify against it when a login email doesn't exist, so a failed login takes the same time either way and nobody can probe which accounts exist. |

### Optional

| Variable | Default |
|---|---|
| `NODE_ENV` | `production`. Development mode is opt-in: `./xentium.sh` sets it, or put `NODE_ENV=development` in `.env`. |
| `PORT` | `4000` |
| `APP_URL` | `http://localhost:5173` |
| `REDIS_URL` | `redis://localhost:6379` |
| `REDIS_KEY_PREFIX` | `xentium:` |
| `REFRESH_TOKEN_HMAC_SECRET` | falls back to `JWT_SECRET` if unset (the wizard generates its own) |
| `UPLOAD_DIR` | `./var/uploads`, relative to where the API process runs |
| `BOOTSTRAP_OFFICIAL_PLUGINS` | `false`. Set it to `true` to install the first-party plugins from `plugins/official/` on startup; otherwise you install them from the ACP. |
| `LICENSE_SERVER_URL`, `LICENSE_*_KEY` | only needed for marketplace and licensing |

### Manual setup

If you'd rather skip the wizard's setup step, copy `.env.example` to `.env` and generate
the secrets yourself:

```bash
# COOKIE_SECRET (>=16) and JWT_SECRET (>=32)
echo "COOKIE_SECRET=$(openssl rand -hex 16)"
echo "JWT_SECRET=$(openssl rand -hex 32)"

# DUMMY_ARGON2_HASH (any valid argon2 hash works)
pnpm --filter @xentium/api exec node --input-type=commonjs \
  -e "require('argon2').hash('xentium-dummy').then(h=>console.log('DUMMY_ARGON2_HASH='+h))"
```

A complete dev `.env`:

```dotenv
NODE_ENV="development"
DATABASE_URL="postgresql://xentium:xentium@localhost:5432/xentium"
REDIS_URL="redis://localhost:6379"
APP_URL="http://localhost:5173"
COOKIE_SECRET="<openssl rand -hex 16>"
JWT_SECRET="<openssl rand -hex 32>"
DUMMY_ARGON2_HASH="<argon2 hash from the command above>"
```

---

## First run

Until the site is installed, an install guard blocks every route except the installer,
and the web app sends you to `/install`. The wizard goes through these steps:

1. **Welcome**
2. **Environment check.** On a fresh clone it checks the Node version, whether `.env` is writable and the data directory. With an existing `.env` it checks Node, PostgreSQL, Redis, disk and config.
3. **Database.** On a fresh clone you enter your PostgreSQL details (host, port, database, user, password, and a Redis URL under *Advanced* if you need one). We test the connection, generate `COOKIE_SECRET`, `JWT_SECRET`, `REFRESH_TOKEN_HMAC_SECRET` and `DUMMY_ARGON2_HASH`, write `.env` and switch to the full app. With an existing `.env` this step is just a connection test.
4. **Site config:** name, URL, default language, timezone.
5. **Admin account:** your first administrator.
6. **Finalize:** `prisma migrate deploy` applies the schema, we seed the core groups, permissions and system profile fields, and write a `site.id` to settings.
7. **Complete:** links to the ACP and to your site.

After that the installer locks itself. Log in and go to the ACP (Admin Control Panel)
at `/admin`.

> Typed the wrong credentials? Nothing is written until the connection test passes, so
> fix them and hit *Connect & save* again. We never overwrite an existing `.env`; the
> wizard only adds the keys that are missing.

> The installer applies the migrations. If you want to run them yourself while
> developing, use `pnpm db:migrate`.

---

## Everyday commands

```bash
# Dev
./xentium.sh             # infra (Postgres + Redis) + api + worker + web
./xentium.sh down        # stop the infra containers
pnpm dev:apps            # api + worker + web only (infra already running)
pnpm backbone:up         # start only the infra containers
pnpm backbone:down       # stop them

# Database (Prisma)
pnpm db:generate         # regenerate the Prisma client after a schema change
pnpm db:migrate          # create/apply a dev migration
pnpm db:reset            # drop everything and re-apply (DESTRUCTIVE)
pnpm db:studio           # open Prisma Studio

# Checks (run them all before you open a PR)
pnpm backbone:check      # typecheck + lint + test + build
pnpm typecheck
pnpm lint
pnpm test
pnpm build

# End-to-end (Playwright)
pnpm e2e                 # reset the DB, run the suite
pnpm e2e:ui              # interactive runner

# Plugins
pnpm plugin:package      # build and package a plugin into a .xtplugin
```

**The API tests use their own database.** `installer.test.ts` tests the wizard starting
from an empty database, so the suite truncates every table. That's why it runs against a
separate `<yourdb>_test` database, which `apps/api/vitest.config.ts` creates and migrates
for you. On top of that, `assertDisposableDatabase()` refuses to truncate any database
whose name doesn't end in `_test`, so a wrong `DATABASE_URL` fails instead of wiping your
data.

Set `TEST_DATABASE_URL` to point the suite somewhere specific (CI).
`ALLOW_DESTRUCTIVE_TESTS=1` switches the guard off. Only use it on a database you're
happy to lose.

Run a single API test file:

```bash
pnpm --filter @xentium/api exec vitest run src/modules/auth/auth.test.ts
```

---

## Project structure

```
xentium/
├─ apps/
│  ├─ api/                  Express API + BullMQ worker
│  │  └─ src/
│  │     ├─ app/            app wiring, route registration
│  │     ├─ config/         Zod env, rate limits, upload limits
│  │     ├─ core/           platform engines: plugin / license / installer, plus the
│  │     │                  extension registries (search, home feed, XEC codes, ACP pages)
│  │     ├─ infrastructure/ db, redis, queue, storage, email, logging
│  │     ├─ modules/        feature modules (auth, users, articles, moderation, …)
│  │     ├─ shared/         errors (XEC), middleware, http, utils
│  │     ├─ jobs/           BullMQ job handlers
│  │     ├─ server.ts       HTTP entry point
│  │     └─ worker.ts       worker entry point
│  ├─ web/                  Vite + React frontend
│  │  └─ src/               app, pages, features, components, layouts, hooks,
│  │                        lib, plugins (slot registries), styles
│  └─ docs/                 this wiki (doc.xentium.org), built from docs/ and this README
├─ packages/                @xentium/* (↑ = published to npm)
│  ├─ contracts/          ↑ shared types, DTOs and enums (permissions, pagination, XEC, …)
│  ├─ errors/             ↑ XentiumError, the XEC registry, Express error middleware
│  ├─ server-kit/         ↑ settings, pagination, secrets, rate limiting, uploads, storage
│  ├─ auth/               ↑ tokens, password hashing, revocation, request guards
│  ├─ plugin-engine/      ↑ manifest validation, migration SQL guard, registry, router
│  ├─ sdk/                  runtime helpers (slug, access) + the licence public key
│  ├─ plugin-sdk/           the plugin authoring contract (not on npm yet, see below)
│  ├─ ui/                   shared React components (GroupAccessPicker)
│  └─ config/               shared tsconfig base
├─ plugins/
│  ├─ official/             first-party plugins (licensed, not in this repo)
│  └─ community-examples/   reference plugins for local development
├─ prisma/                  schema + migrations (client → apps/api/src/generated/prisma)
├─ docker/                  Compose for Postgres 17 + Redis 7
├─ scripts/                 tooling (plugin packaging, versioning, …)
├─ e2e/                     Playwright suites
└─ docs/                    developer docs (published at doc.xentium.org)
```

Every feature module in `apps/api/src/modules/<name>/` has the same shape:
`*.routes.ts → *.controller.ts → *.service.ts`, plus `*.validation.ts`, `*.types.ts` and
`*.test.ts`. See [Working on core](#working-on-core) for when a `*.repository.ts` is worth it.

---

## Framework packages (npm)

Xentium is a framework, and this CMS is the first app built on it. We publish the
framework layer to npm under the [`@xentium`](https://www.npmjs.com/search?q=%40xentium)
scope (public, MIT), so you can build other things on it too.

These are the packages core runs on. We don't keep a separate "public API" that lags
behind what we use ourselves.

| Package | What you get |
| --- | --- |
| [`@xentium/contracts`](https://www.npmjs.com/package/@xentium/contracts) | shared types, permission keys, pagination and the XEC error-code registry |
| [`@xentium/errors`](https://www.npmjs.com/package/@xentium/errors) | `XentiumError`, the XEC registry and the Express error middleware |
| [`@xentium/server-kit`](https://www.npmjs.com/package/@xentium/server-kit) | settings with a TTL cache, pagination, encryption at rest, rate limiting, upload validation, storage |
| [`@xentium/auth`](https://www.npmjs.com/package/@xentium/auth) | minting and verifying tokens, argon2 hashing, a revocation denylist, request guards |
| [`@xentium/plugin-engine`](https://www.npmjs.com/package/@xentium/plugin-engine) | manifest validation, the DDL-only migration guard, the plugin registry and router |

```bash
pnpm add @xentium/errors @xentium/server-kit
```

We're still in prerelease, so these go out under the `alpha` dist-tag. Pin it:

```bash
pnpm add @xentium/errors@alpha
```

Anything with a dependency is a factory. Nothing grabs a module-level singleton, so your
app passes in its own database, secret, Redis client or filesystem root:

```ts
import { createErrorMiddleware } from "@xentium/errors";
import { createSettings } from "@xentium/server-kit";

app.use(createErrorMiddleware({ isProd, logger, persist }));

const settings = createSettings({
  get:     (key)  => db.setting.findUnique({ where: { key } }),
  getMany: (keys) => db.setting.findMany({ where: { key: { in: keys } } }),
});
```

The rule we hold these packages to: **a framework package doesn't know what a user, an
article or a page is.** So the layout/block system, appearance and everything else
that's CMS-specific stays in `apps/` and isn't published.

### For plugin developers

> [!IMPORTANT]
> **`@xentium/plugin-sdk` isn't on npm yet.** It's the authoring contract you need, and
> we're holding it back on purpose: we're splitting it into a generic half and a
> CMS-specific half, which is a breaking change. We'd rather make you wait than publish a
> version we already know we'll break.
>
> Until then, take it from the repo: copy `packages/plugin-sdk/src/index.ts` into your
> plugin, or add the repo as a git dependency. It's types only, so nothing extra ships
> at runtime either way.

The rest of the framework is useful in a plugin today: `@xentium/contracts` for
permission keys and XEC codes, and `@xentium/errors` so your plugin's errors come back
in the same shape as ours.

You **don't** need `@xentium/server-kit`, `@xentium/auth` or `@xentium/plugin-engine` in
a plugin. The host already runs them, and `ctx.host` gives you what it has: `prisma`,
`queues`, `logger`, the auth middleware. If you install your own copy, you get a second
instance that isn't connected to anything.

The full walkthrough is in the [Plugin development guide](#plugin-development-guide).

---

## Architecture in a nutshell

- **A modular monolith, not microservices.** In production there are two processes: `server.ts` (HTTP) and `worker.ts` (BullMQ).
- **REST first.** Every endpoint validates its input with Zod. Errors carry typed **XEC codes** (`XEC-AUTH-1001`, …) and go through one central handler.
- **Auth:** a short-lived HS256 access token (15 minutes, sent as `Authorization: Bearer`, kept in memory in the browser) plus a rotating refresh token in an httpOnly `SameSite=Strict` cookie.
- **Core doesn't know plugins exist.** Plugins add things through **registries**. Core loops over whatever is registered and never hardcodes a plugin's tables, ids or routes. Search and the home feed both work this way.

```
Plugin (onEnable)  ──registers──▶  core registry  ──core iterates──▶  merged result
   e.g. registerSearchSource(...)      searchRegistry      GET /api/search
```

---

## Layout system

You'll find it at **ACP → Appearance → Themes**, under **Layouts** on the theme you want to
edit (each theme, and the built-in Core theme, has its own). A page's structure is a stored
**document**, not compiled markup: for each **template**, an ordered list of **blocks** in
each **region**. Theme Studio edits both halves of a theme: how things look (Colours &
type) and what goes where (Layout).

### Templates

Core ships a fixed set. A layout rearranges pages that already exist; it never creates
routes. Plugins can register templates for their own pages (the forum does).

| Template | Renders at | Regions |
|---|---|---|
| `home` | `/` | main · aside |
| `article.index` | `/articles` | main · aside |
| `article.detail` | `/articles/:slug` | main · aside |
| `page.detail` | `/p/:slug` | main · aside |
| `profile` | `/u/:username` | main · aside |
| `members` | `/members` | main · aside |
| `chrome.header` | the site header, on every page | header |
| `chrome.footer` | the site footer, on every page | footer |

`main` is the page body (the editor labels it "Body") and `aside` is the rail beside it.
The login screens and the whole ACP are left out on purpose: you should never be able to
rearrange the screen you'd need to fix a broken arrangement.

### Editing

- **You see edits right away.** The preview is the real page in an iframe, and the editor pushes the document into it before anything is saved.
- **The draft autosaves** about 700 ms after you stop. There's no save button.
- **Publishing is explicit** and covers the whole site. It promotes every pending draft. Open tabs pick up the change within seconds over the style-version SSE stream, without reloading.
- **Reset** puts the template back to its built-in default. You can't undo it.
- **Drag wherever you like:** in the structure tree or straight in the preview, and between regions. The `↑`/`↓` buttons are there for the keyboard. Hover a block to see its outline and type; click it to select it and open its settings.
- **Block settings are generated** from each block's Zod schema, so nobody hand-writes forms.
- **Required blocks** (`logo` and `userMenu` in the navbar) can be moved but not deleted. Both the editor and the API enforce that.

### When something goes wrong

None of these can take a site down:

- A stored document that fails validation: the built-in default renders, and the ACP shows a warning.
- An **unknown block type** (a plugin got disabled, a block was retired): we skip that block and render the rest. The block stays in the document, so re-enabling the plugin brings it back exactly where it was.
- A block that throws: it renders nothing, and the blocks around it are fine.

### Themes are data

A `.xttheme` is a zip of layout documents, tokens, a stylesheet and assets. **Never code.**

```
manifest.json            id, name, version, vendor, minXentiumVersion, appearance
tokens.json              the design tokens, by scope
styles/tokens.css        the global tokens as :root custom properties
styles/custom.css        the theme's own stylesheet (optional)
layouts/<template>.json  one document per template
assets/                  images and fonts
```

A theme is one look, light **or** dark; the manifest says which. Export packages what's
currently published. Import checks everything before it writes anything, so a package
with one broken layout doesn't apply at all. Installing a theme adds it to the site's
theme library, and we ask you whether to switch to it. Since there's no executable code,
reviewing a theme means reading JSON and CSS.

Need a block the catalogue doesn't have? That's a **plugin**, not a theme. See
[`docs/plugin-blocks.md`](docs/plugin-blocks.md), and [`docs/style-system.md`](docs/style-system.md)
for how themes and tokens fit together.

---

## Announcements

Xentium can reach your admin panel directly. Once a day the worker asks the marketplace
whether there is anything to pass on, and anything that comes back opens a dialog in the ACP.
Once an admin clicks OK it is gone from the site, for every admin: your instance keeps no
copy and no record of who read it.

The check is anonymous. It sends no site id, no account, no version and no plugin list, and
it works whether or not you've connected a marketplace account — a site that never linked one
is exactly the site that most needs to hear about a security problem. There are no read
receipts, deliberately: a channel that knows who read it is a tracking channel.

Every announcement is **signed** (RS256, the same key that signs entitlements) and your
instance throws away anything that doesn't verify, has been altered in transit, or has
expired. Without that, anyone who could answer for your `LICENSE_SERVER_URL` would get to put
arbitrary text in a modal in front of every administrator. There's no HTML in the channel at
all — plain text, plus at most one `https://` link that's shown in full and never opened for
you.

We write them in English and translate where we can; each admin sees their own language if
we have it, then the site's, then English. They can't be muted: a channel you can turn off
isn't one we can rely on when it matters.

There is one marketplace, `plugins.xentium.org`, and an announcement is checked against the
key bundled in the build — not against `LICENSE_PUBLIC_KEY`. That env var can change which
*licences* an instance accepts, for development against a local marketplace; it cannot change
who an instance believes is Xentium.

Full details in [the wiki](https://doc.xentium.org/admin/announcements/).

---

## Working on core

We expect new core code to follow these conventions. If a PR hand-rolls something a
shared utility already does, we'll ask you to switch.

### Module shape

`modules/<name>/<name>.routes → .controller → .service` (plus `.validation`, `.types`,
`.test`). Services can use Prisma directly. Pull a query out into a `.repository` only
when several services share it or it's genuinely complex. It's not a required layer.

### Controllers are plain async functions

Express 5 passes rejected promises to the error middleware, so there's **no `wrap()`
helper**, and you don't cast `req`. `req.userId`, `req.sessionId` and
`req.file.detectedExt` are typed in `apps/api/src/types/express.d.ts`. If you catch
yourself writing `(req as any)` or a local `AuthedRequest`, the typing is already there.

```ts
// A complete controller. Anything it throws (XentiumError included) reaches errorMiddleware.
export async function getThing(req: Request, res: Response) {
  const { id } = paramsSchema.parse(req.params);       // Zod on EVERY input
  res.json(await thingService.get(id, req.userId));
}
```

### Shared utilities (use these, don't rewrite them)

| Utility (`apps/api/src/shared/utils/`) | Use it for | Rules |
|---|---|---|
| `settings.ts`: `getSetting` / `getSettings` / `getFreshSetting` / `bustSettingsCache` | every settings read | Reads are cached for 15 s; read several keys at once with `getSettings({key: default})`. **Anything that writes a setting must call `bustSettingsCache(key)`.** Use `getFreshSetting` only where a stale value isn't acceptable (e.g. appearance tokens). |
| `paginate.ts`: `paginate()` (meta via `buildPaginationMeta` from `@xentium/contracts`) | every list endpoint | Only `buildPaginationMeta` builds `{page, limit, total, totalPages, hasPrev, hasNext}`. Don't build that object by hand. |
| `userRef.ts`: `USER_REF_SELECT` / `toUserRef` | naming a user in a response | The one way a response refers to a user (`id`, `username`, badge colour). The `UserRef` type is in `@xentium/contracts`. |
| `memoTtl.ts`: `memoTtl` / `TtlCache` | caching anything hot in memory | It backs the settings cache and the `/appearance/css` memo. Use it before you invent a cache. |

On the web side the equivalents are `lib/toast.ts` (`toast.success/info/warning/error`,
our own toasts: they stack, merge duplicates as ×N, pause on hover and take their
colours from the Feedback tokens in Theme Studio) and `lib/dialog.ts` (`openDialog`, a
promise-based confirm/alert). `lib/swal.ts` is an old name that wraps both (sweetalert2
is gone); new code imports `toast` and `openDialog` directly.

### Errors, validation, data

- Every endpoint validates **body, params and query** with Zod before doing anything. A `ZodError` becomes `XEC-API-4001` centrally. Errors are `XentiumError`s with an `XEC-<DOMAIN>-<CODE>` code, and a stack trace never reaches a client.
- Core tables are named `xcf_<snake_case>`. We soft-delete with `deletedAt`, and queries leave deleted rows out by default. TipTap content is stored as ProseMirror JSON, never raw HTML.
- The API doesn't do languages (it returns machine keys and XEC codes). Only emails and notifications are translated on the server.

### Security detection

Abuse detection is part of core. Four baseline patterns run on the `security-analysis`
job every 30 minutes and open review cases for a human (ACP → Moderation → Review Cases,
and in ModCanvas → Cases). Detection **never acts on its own**. Plugins can add scans
with `registerSecurityScan` or take over a baseline with `claimSecurityPatterns`.

### Two processes, one codebase

The HTTP server (`server.ts`) and the worker (`worker.ts`) are separate processes, and
both load plugins and read the same registries. If you change job code or anything a
plugin registers into, restart the **worker** too. In dev, `./xentium.sh` runs both.

---

## Plugin development guide

Plugins are how you extend Xentium without touching core. A plugin can register routes,
permissions, ACP pages, nav items, notification types, XEC error codes and **content
sources** for search and the home feed. It runs inside the host process, but only through
the SDK. You don't get free access to core internals.

Check [Framework packages](#framework-packages-npm) first for what's on npm, and where
`@xentium/plugin-sdk` stands.

### What's in a plugin

```
my-plugin/
├─ manifest.json           identity, version, permissions, migrations, entry points
├─ server/                 server entry, exports a PluginDefinition
│  └─ index.ts
├─ web/                    (optional) web entry, registers UI
│  └─ index.ts
└─ migrations/             raw SQL, in up/down pairs
   ├─ 001_create_things.up.sql
   └─ 001_create_things.down.sql
```

We validate **`manifest.json`** on install:

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "vendor": "Acme",
  "minXentiumVersion": "1.0",
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

### Migrations and the database

Your plugin owns its schema through raw-SQL migrations. We track them separately from
core's Prisma migrations, in the `xcf_plugin_migrations` table. The host checks every rule
below on install, enable and update, and breaking one aborts the operation with the
`XEC-PLUGIN-*` code shown. Design for them from the start.

- **DDL only.** A migration may only `CREATE` / `ALTER` / `DROP` a `TABLE`, `INDEX`,
  `SEQUENCE`, `TYPE`, `FUNCTION` or `TRIGGER` (and `CREATE EXTENSION`). Any DML
  (`INSERT`/`UPDATE`/`DELETE`/`SELECT`/`TRUNCATE`/`COPY`/…) is rejected with
  `XEC-PLUGIN-2010`. Seed data goes in `onEnable`, not in a migration.
- **Up and down come in pairs.** Every `NNN_name.up.sql` needs a matching
  `NNN_name.down.sql` (`XEC-PLUGIN-2011`). Use `IF EXISTS` / `IF NOT EXISTS` so a down
  migration can safely run twice.
- **Table names.** Core tables start with `xcf_`, and your schema stays in its own
  namespace. Declare a **`tablePrefix`** (short, snake_case, ending in `_`, e.g. `forum_` or
  `sb_`), and we check that **every** table, index, sequence, type, function and trigger
  your migrations create, alter, drop or index starts with it. Whether you declare one or
  not, a plugin migration can never touch a reserved core object (names starting with
  `xcf_`, `xentium_`, `_prisma`, `pg_` or `information_schema`). Both mistakes raise
  `XEC-PLUGIN-2013`. `CREATE EXTENSION` and `COMMENT` are exempt. The prefix is optional,
  but we strongly recommend it; all our official plugins use one.
- **A migration that has run is frozen.** We record its checksum, and editing the file
  afterwards is rejected (`XEC-PLUGIN-2012`). Put schema changes in a **new** migration in
  your next version.
- **Updates only go forward, matched by name.** On update we run only the migrations
  whose *name* we haven't seen before, in any version. So keep the full list in the
  manifest and only append to it. Never renumber or rename one you've shipped.
- **No foreign keys across the boundary.** Prisma doesn't know about plugin tables, so
  your table can't `REFERENCES` a core table (and core can't reference yours). Store the
  id (e.g. `user_id TEXT`), enforce integrity in your service, and clean up when an
  account is deactivated with the SDK's `onUserDeactivated` hook.

### The server entry

Your server entry exports a `PluginDefinition`. You wire everything up in
`onEnable(ctx)`. `onDisable` is optional, because the engine removes your routes,
registrations, ACP pages and XEC codes for you.

```ts
import type { PluginDefinition } from "@xentium/plugin-sdk";
import { createRouter } from "./router.js";
import { searchThings } from "./service.js";

const plugin: PluginDefinition = {
  id: "my-plugin",

  async onEnable(ctx) {
    // Routes are mounted at /api/p/my-plugin/*  (host services come in via ctx.host)
    ctx.registerRoutes(createRouter(ctx.host));

    // Permission keys (written to the permissions table; defaults assigned on first install)
    await ctx.registerPermissions([
      { key: "myplugin.thing.create", label: "Create things", domain: "My Plugin",
        defaults: ["member", "admin"] },
    ]);

    // A nav item on the site (hidden automatically when the plugin is disabled)
    await ctx.registerNavItem({ label: "Things", url: "/things", position: 5 });

    // An ACP sidebar page (listed by GET /api/admin/registered-pages).
    // Settings pages in the ACP AUTOSAVE (useAutosave + SaveChip from the
    // host globals), with no Save button, like core's. Secrets (API keys) are the
    // exception: give them an explicit Set/Remove.
    ctx.registerAcpPage({ section: "My Plugin", label: "Things", path: "/admin/things" });

    // Notification types (for the preferences UI) + XEC error codes (for the Error Reference)
    ctx.registerNotificationTypes(["myplugin.thing_created"]);
    ctx.registerNecCodes([
      { code: "XEC-MYPLUGIN-6001", msg: "Thing not found", sev: "Error",
        domain: "My Plugin", desc: "…", cause: "…", fix: "…" },
    ]);

    // A SEARCH source: core merges your results and never queries your tables.
    ctx.registerSearchSource({
      id: "things",
      label: "Things",
      permission: null,                  // null = public, or a permission key to gate it
      search: (query, opts) => searchThings(query, opts),  // → { data: SearchResultItem[], total }
    });

    // A HOME FEED source: the same idea, for the home and guest feeds.
    ctx.registerHomeFeedSource({
      id: "things",
      label: "Things",
      recent: (limit) => /* … */,        // → HomeFeedItem[]
    });

    // A SECURITY SCAN: runs with core's security analysis (every 30 min);
    // open review cases with ctx.host.security.createCase(...).
    ctx.registerSecurityScan(async () => { /* … */ });

    // Optionally CLAIM core baseline detection patterns that your scan replaces.
    // Core skips its own version while you're enabled and resumes it when you're not.
    ctx.claimSecurityPatterns(["multi_account_suspicion"]);
  },
};

export default plugin;
```

### Host services (`ctx.host`)

We inject everything your plugin needs, so you never import core internals:

| `ctx.host.*` | What it is |
|---|---|
| `prisma` | the host's Prisma client (use raw SQL for your own tables) |
| `queues` | BullMQ queues: you enqueue, the core worker runs the jobs |
| `middleware` | `requireAuth`, `optionalAuth`, `enforcePostLength` |
| `errors` | `XentiumError`, `XEC` |
| `utils` | shared helpers (e.g. `resolveAvatar`) |
| `notificationService` | send notifications (or use `ctx.notify(...)`) |
| `env`, `logger` | the validated config and a Pino logger |

### Core never knows your schema

The host knows nothing about your tables, ids or routes. Want your content in search or
the home feed? Register a **source** that returns normalized items (`SearchResultItem` /
`HomeFeedItem`). Core asks your source to run the query and merges what comes back. That
way your plugin can be installed, disabled or removed, and core just works with whatever
is registered at the moment.

### ACP pages autosave

Settings pages in our ACP don't have a Save button. They save as you change things and
show a status indicator. Your plugin's admin pages should do the same, or they'll feel
out of place. Externalize the two host bridges in your `vite.config.ts`:

```ts
"@web/hooks/useAutosave":         `${H}.webUseAutosave`,
"@web/components/SaveChip":       `${H}.webSaveChip`,
```

```tsx
const saveMut = useMutation({ mutationFn: (v: Settings) => api.put(`${BASE}/admin/settings`, v) });
useAutosave({ value: form, savedValue: data, onSave: (v) => { if (v) saveMut.mutate(v); } });
// …and render <SaveChip saving={saveMut.isPending} /> in the header.
```

That goes for settings pages **and** per-group panels registered through the
`groupConfigPanel` slot. Per-group config (permissions, progression) belongs there,
because it then shows up as a tab on core's own group page instead of a page of its
own. Keep an explicit button for **create/edit dialogs**, **secrets** (never
autosave a half-typed credential; use Set/Remove) and **destructive actions**.

📖 **The full recipe, the ways it goes wrong, and the `groupConfigPanel` + progression
path: [`docs/plugin-acp-autosave.md`](docs/plugin-acp-autosave.md).**

### Local development

1. Put your plugin in `plugins/community-examples/<name>/` (or `plugins/official/<name>/`). Both are pnpm workspace members.
2. For hot reload of the web side during `vite dev`, add your web entry to `apps/web/src/plugins/dev-plugins.ts` (keep that edit local).
3. Start the stack with `./xentium.sh`, then **install and enable** your plugin under **ACP → Extensions → Upload** (or set `BOOTSTRAP_OFFICIAL_PLUGINS=true` to load the first-party plugins on startup).

### Packaging

Plugins ship as a **`.xtplugin`** archive: a zip of the manifest, the compiled
`server`/`web` bundles and the migrations.

```bash
node scripts/package-plugin.mjs [pluginDir] [outDir]
# default: plugins/official/xentium-forum → dist/marketplace/
```

The plugin engine extracts the archive to a temp directory (with zip-slip protection),
validates the manifest and the migrations, runs the migrations in a transaction, then
registers and enables the plugin. **Installing and enabling are always separate.**
Enabling turns routes and registrations on; disabling turns them off and keeps the data.

### Plugin lifecycle

```
upload → validate manifest → compatibility/trust check → install (stored, migrations run)
       → enable (onEnable: routes + registries active)
       → disable (behaviour stops, data kept) → uninstall (migrations reversed, package removed)
```

> **Registrations live in memory.** Everything `onEnable` registers (routes, ACP pages,
> content sources, security scans and claims, XEC codes) sits in the host process's
> registries, and we rebuild it on startup from the `xcf_installed_plugins` table. The
> lifecycle endpoints keep memory and the database in sync. But if you change plugin
> state **behind a running process** (deleting a row by hand, resetting the DB in dev),
> the process keeps serving what it had, e.g. an ACP menu entry for a plugin that's gone,
> until you restart it. Restarting the API and the worker always fixes it. The worker
> loads plugins too, so restart it after replacing a plugin package.

---

## Migrating from another platform

We ship free, open-source migration tools as a standalone CLI. It's not a plugin on
purpose: you run it once on your server, it writes straight into the Xentium database,
and all it leaves behind is the migration log (**ACP → System → Migration History**).
You can watch an import there while it runs: progress for each kind of record, the log as
it is written, and the issues so far. If the process dies, the page says the run stopped
responding instead of showing it as running forever. The page also gives you the command
back for a dry run or a re-run, with connection strings left out, because we never store
them.

### Available adapters

| Adapter | Source | Status |
|---|---|---|
| `@xentium/migrate-wp` | WordPress, from a **WXR export file** (wp-admin → Tools → Export). You don't need a WordPress install or database access. | ✅ Available |
| `@xentium/migrate-phpbb` | phpBB 3.1+, over a direct **MySQL connection**. The `xentium-forum` plugin must be installed and enabled on the target (we check before anything runs). Users keep their passwords. | ✅ Available |
| `@xentium/migrate-xenforo` | XenForo 2.x, over a direct **MySQL connection**. Needs the `xentium-forum` plugin on the target. Users with native bcrypt hashes keep their passwords. | ✅ Available |
| vBulletin, WoltLab Suite | direct database connection | Planned |

### Running a migration

```bash
# 1. Always start with a dry run: it inspects, extracts and reports, and writes NOTHING
pnpm --filter @xentium/migrate-wp migrate -- \
  --file my-export.xml \
  --db "postgresql://user:pass@localhost:5432/xentium" \
  --dry-run

# 2. The real run (asks you to confirm; --yes skips that)
pnpm --filter @xentium/migrate-wp migrate -- --file my-export.xml --db "postgresql://…"

# Forums: point at the board's MySQL database instead of a file
# (same flags for @xentium/migrate-xenforo; --prefix overrides the table prefix)
pnpm --filter @xentium/migrate-phpbb migrate -- \
  --source-db "mysql://user:pass@host:3306/phpbb" \
  --db "postgresql://…" --dry-run
```

The target has to be an **installed** Xentium (run the wizard first). Migrations can be
**resumed**: we track every imported item in an import map, so if a run is interrupted,
the next one continues where it stopped instead of creating duplicates. Accounts that
match an existing user by email are merged into that user.

### What carries over

- **Users:** accounts, display names, join dates and a best-effort role mapping (admins → Administrator, moderators → Moderator). Where the source has password hashes (the database adapters; for XenForo we pull them out of its serialized auth data), users **keep their passwords**: we check the old hash on their first login and quietly upgrade it to argon2. WXR exports don't contain hashes, so WordPress users reset their password once.
- **Content:** categories with their hierarchy, posts/articles (converted to the TipTap format; headings, lists, quotes, code, images and links survive), tags and member comments (threaded one level deep). For forums: the whole node tree, threads (locked, pinned, view counts) and posts with their BBCode converted.
- **Social graph** where the source has one: XenForo **reactions become likes** (every reaction type turns into a like), **follows carry over 1:1** and ignores become blocks. phpBB foes become blocks. phpBB's *friend* flag is a private buddy list, so we don't turn it into public follows. A block cancels follows in both directions, as it does in Xentium, and we recount every like and follower total.
- **Not migrated:** themes and styling (Xentium has its own appearance system), the old platform's plugins, private messages, guest comments (comments on Xentium need an account), and, in this version, media files and attachments (we link to them by URL but don't download them). The migration report lists everything we skipped and why.

---

## Contributing

1. Branch off `development`.
2. Make your change. Keep modules in their `routes → controller → service` shape (add a `.repository` only when a query is shared or complex, see [Working on core](#working-on-core)) and put shared types in `@xentium/contracts`.
3. **`pnpm backbone:check`** has to pass (typecheck + lint + test + build).
4. Validate all input with Zod, and enforce permission and licence checks on the backend.
5. Ship Prisma schema changes with a migration in the same PR.
6. Open a PR against `development`. The PR template has the checklist we review against.

More in [CONTRIBUTING.md](./CONTRIBUTING.md) and in the developer docs at
[doc.xentium.org](https://doc.xentium.org).

---

## License

MIT, see [LICENSE](./LICENSE). The open-source core is free to use. Our official paid
plugins are licensed separately, and they never gate a core feature.
