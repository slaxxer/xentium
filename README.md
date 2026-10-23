# Xentium

An open-source community platform and CMS, written in TypeScript from the database
to the browser. MIT licensed, currently in alpha.

Developer docs: [doc.xentium.org](https://doc.xentium.org)

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

### Why this exists

Most community software people actually run today is old. A lot of it is solid, but it
grew up as PHP in the 2000s and you notice it everywhere: templates you edit as strings,
plugins that patch core and break on every update, permission systems nobody fully
understands, and a frontend that was added later.

I kept wondering what a forum and CMS would look like if you started from zero today,
with the tools we have now and none of that history. Xentium is my answer to that.
TypeScript on both ends, Postgres, a React frontend, a typed plugin API, and themes that
are data instead of code.

It's a modular monolith on purpose. One codebase, one deploy, two processes (the API and
a background worker). You don't need Kubernetes to run a community of 200 people, and
you shouldn't have to learn it to contribute.

### What's in it

Out of the box you get a CMS: articles with a TipTap editor, revisions, nested
categories with access control, comments, tags and full-text search on Postgres. Around
that sits what a community needs: profiles, follows, profile walls, notifications (in-app
and email), and a progression system where levels are just groups.

A few parts we're particularly happy with:

- Sign-in. Passwords, passkeys, sign-in links and OAuth all finish in the same function,
  so there's exactly one place where sessions get created. Access tokens live in memory,
  refresh tokens are httpOnly cookies that rotate on every use.
- Moderation. Warnings and bans always come from templates you define, everything lands
  in an append-only log, and the abuse detection (login bursts, multi-accounts, ban
  evasion) only opens a case. A human decides.
- Theme Studio. Pages are block documents stored in the database. You drag blocks around
  in a live preview, it autosaves a draft, and you publish when you're ready. A theme
  package is layouts plus design tokens, so installing a theme can't run code on your
  server.
- Plugins. They get their own routes, migrations, permissions, admin pages and blocks
  through a typed SDK, without touching core. Disable one and your layouts keep its
  blocks, so turning it back on puts everything where it was.

It ships in English, German, Spanish, French and Portuguese. The API itself only speaks
machine keys and error codes, so translations stay in the frontend.

### Trying it

Installing should take a minute, not an afternoon. On a server it's one command:

```bash
npm create xentium@latest my-community
```

It checks the machine first (and tells you the exact fix for anything missing), sets up
Postgres and Redis, installs the app and hands you a URL. The rest happens in a browser
wizard: it tests your database, generates the secrets, writes `.env`, applies the schema
and creates your admin account. You never edit a config file and you never restart
anything. For working on the code itself, `./xentium.sh` does the same thing locally
(see [Quick start](#quick-start)).

The framework underneath is on npm too, under [`@xentium`](https://www.npmjs.com/search?q=%40xentium):
errors, auth, settings, rate limiting, uploads, the plugin engine. Core runs on exactly
these packages, so you can use them in your own Express app without taking the CMS along.

### Where it's at

Alpha. It runs fine, and nothing merges without the full typecheck, lint, test and build
passing. Still, APIs can change between alphas and you'll hit rough edges. From 1.0.0 on,
versions follow semver: [what each version promises](docs/versioning.md). Please don't
move your 20,000-member forum onto it yet. If you want to try it with real data, there are
importers for WordPress, phpBB, XenForo, vBulletin and WoltLab, and users keep their
passwords where the source allows it.

About money, so it doesn't come as a surprise later: core is MIT and complete on its own.
We also offer paid official plugins that extend it, through our
marketplace. They're ordinary plugins built on the same API anyone can use, and we don't
move core features into them.

### Want to help?

Good places to start: translations, importers for other platforms, accessibility, tests
and docs. Or skip core entirely and build a plugin or a theme, that's what the SDK is
for. The [Contributing](#contributing) section has the workflow, and issues and
questions on GitHub are always welcome.

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
| `DEMO_MODE` | `false`. Set it to `true` for a public demo with a shared admin account. It refuses installing or switching plugins, the marketplace and licence, sending mail, changes to the signed-in account's password, email and sign-in methods, and settings that could lock visitors out. Everything else stays editable, so pair it with a nightly restore. |
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
pnpm e2e                 # its own database (<yours>_e2e) and ports (5175/4300); dev is untouched
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

- **One modular monolith.** In production there are two processes: `server.ts` (HTTP) and `worker.ts` (BullMQ).
- **REST first.** Every endpoint validates its input with Zod. Errors carry typed XEC codes (`XEC-AUTH-1001`, …) and go through one central handler.
- **Auth:** a short-lived HS256 access token (15 minutes, sent as `Authorization: Bearer`, kept in memory in the browser) plus a rotating refresh token in an httpOnly `SameSite=Strict` cookie.
- **Core doesn't know plugins exist.** Plugins add things through registries. Core loops over whatever is registered and never hardcodes a plugin's tables, ids or routes. Search and the home feed both work this way.

```
Plugin (onEnable)  ──registers──▶  core registry  ──core iterates──▶  merged result
   e.g. registerSearchSource(...)      searchRegistry      GET /api/search
```

---

## Layout system

You'll find it at ACP → Appearance → Themes, under Layouts on the theme you want to
edit (each theme, and the built-in Core theme, has its own). A page's structure is a stored
document, not compiled markup: for each template, an ordered list of blocks in
each region. Theme Studio edits both halves of a theme: how things look (Colours &
type) and what goes where (Layout).

### Templates

Core ships a fixed set. A layout rearranges pages that already exist; it never creates
routes. Plugins can register templates for their own pages (the forum does).

| Template | Renders at | Regions |
|---|---|---|
| `home` | `/` | main · aside |
| `article.index` | `/articles` | main · aside |
| `article.detail` | `/articles/:slug` | main · aside |
| `profile` | `/u/:username` | main · aside |
| `members` | `/members` | main · aside |
| `chrome.header` | the site header, on every page | header |
| `chrome.footer` | the site footer, on every page | footer |

`main` is the page body (the editor labels it "Body") and `aside` is the rail beside it.
The login screens and the whole ACP are left out on purpose: you should never be able to
rearrange the screen you'd need to fix a broken arrangement.

### Editing

- You see edits right away. The preview is the real page in an iframe, and the editor pushes the document into it before anything is saved.
- The draft autosaves about 700 ms after you stop. There's no save button.
- Publishing is explicit and covers the whole site. It promotes every pending draft. Open tabs pick up the change within seconds over the style-version SSE stream, without reloading.
- Reset puts the template back to its built-in default. You can't undo it.
- Drag wherever you like: in the structure tree or straight in the preview, and between regions. The `↑`/`↓` buttons are there for the keyboard. Hover a block to see its outline and type; click it to select it and open its settings.
- Block settings are generated from each block's Zod schema, so nobody hand-writes forms.
- Required blocks (`logo` and `userMenu` in the navbar) can be moved but not deleted. Both the editor and the API enforce that.

### When something goes wrong

None of these can take a site down:

- A stored document that fails validation: the built-in default renders, and the ACP shows a warning.
- An unknown block type (a plugin got disabled, a block was retired): we skip that block and render the rest. The block stays in the document, so re-enabling the plugin brings it back exactly where it was.
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

A theme is one look, light or dark; the manifest says which. Export packages what's
currently published. Import checks everything before it writes anything, so a package
with one broken layout doesn't apply at all. Installing a theme adds it to the site's
theme library, and we ask you whether to switch to it. Since there's no executable code,
reviewing a theme means reading JSON and CSS.

Need a block the catalogue doesn't have? Blocks come from plugins, so you'd write one. See
[`docs/plugin-blocks.md`](docs/plugin-blocks.md), and [`docs/style-system.md`](docs/style-system.md)
for how themes and tokens fit together.

---

## Announcements

Xentium can reach your admin panel directly. Once a day the worker asks the marketplace
whether there is anything to pass on, and anything that comes back opens a dialog in the ACP.
Once an admin clicks OK it is gone from the site, for every admin: your instance keeps no
copy and no record of who read it.

The check is anonymous. It sends no site id, no account, no version and no plugin list, and
it works whether or not you've connected a marketplace account. A site that never linked one
is exactly the site that most needs to hear about a security problem. There are no read
receipts either, because a channel that knows who read it is a tracking channel.

Every announcement is signed (RS256, the same key that signs entitlements) and your
instance throws away anything that doesn't verify, has been altered in transit, or has
expired. Without that, anyone who could answer for your `LICENSE_SERVER_URL` would get to put
arbitrary text in a modal in front of every administrator. There's no HTML in the channel at
all: plain text, plus at most one `https://` link that's shown in full and never opened for
you.

We write them in English and translate where we can; each admin sees their own language if
we have it, then the site's, then English. They can't be muted, because when
there's a security problem we need them to reach every site.

There is one marketplace, `plugins.xentium.org`, and an announcement is checked against the
key bundled in the build, never against `LICENSE_PUBLIC_KEY`. That env var can change which
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

Express 5 passes rejected promises to the error middleware, so there's no `wrap()`
helper, and you don't cast `req`. `req.userId`, `req.sessionId` and
`req.file.detectedExt` are typed in `apps/api/src/types/express.d.ts`. If you catch
yourself writing `(req as any)` or a local `AuthedRequest`, the typing is already there.

```ts
// A complete controller. Anything it throws (XentiumError included) reaches errorMiddleware.
export async function getThing(req: Request, res: Response) {
  const { id } = paramsSchema.parse(req.params);       // Zod on every input
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

- Every endpoint validates body, params and query with Zod before doing anything. A `ZodError` becomes `XEC-API-4001` centrally. Errors are `XentiumError`s with an `XEC-<DOMAIN>-<CODE>` code, and a stack trace never reaches a client.
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
plugin registers into, restart the worker too. In dev, `./xentium.sh` runs both.

---

## Plugin development guide

Plugins are how you extend Xentium without touching core. A plugin can register routes,
permissions, ACP pages, nav items, notification types, XEC error codes and content
sources for search and the home feed. It runs inside the host process, but only through
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
  "minXentiumVersion": "1.0.0",
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

These rules keep a migration from damaging the site while it runs and keep your schema
in its own namespace. They aren't a sandbox: your functions and your server code run with
the site's database rights, so installing a plugin means trusting its code.

- **DDL only.** We read every migration with PostgreSQL's own parser. A migration may
  create, alter, rename, comment on and drop your own tables, indexes, sequences, types,
  functions and triggers, and nothing else. Anything that reads or writes rows
  (`INSERT`, `UPDATE`, `DELETE`, `SELECT`, `CREATE TABLE … AS`, views, `DO` blocks, …)
  is rejected with `XEC-PLUGIN-2010`. So is a `DEFAULT` or `CHECK` that calls one of your
  own functions or a function that runs SQL, `SECURITY DEFINER`, languages other than
  `plpgsql` and `sql`, and changing an owner or a schema. Seed data goes in `onEnable`,
  not in a migration.
- **Extensions.** `CREATE EXTENSION IF NOT EXISTS` works for `pg_trgm`, `citext`,
  `uuid-ossp`, `pgcrypto`, `unaccent`, `btree_gin`, `btree_gist` and `fuzzystrmatch`.
  Dropping one never does: core's search indexes depend on `pg_trgm`.
- **Up and down come in pairs.** Every `NNN_name.up.sql` needs a matching
  `NNN_name.down.sql` (`XEC-PLUGIN-2011`). Use `IF EXISTS` / `IF NOT EXISTS` so a down
  migration can safely run twice.
- **Table names.** Core tables start with `xcf_`, and your schema stays in its own
  namespace. A plugin with migrations must declare a **`tablePrefix`** (short, snake_case,
  ending in `_`, e.g. `forum_` or `sb_`), and every table, index, sequence, type, function
  and trigger your migrations create, alter, rename, comment on or drop must start with
  it, in the `public` schema. Reserved core names (`xcf_`, `xentium_`, `_prisma`, `pg_`,
  `information_schema`) are never allowed. A missing prefix or a name outside it raises
  `XEC-PLUGIN-2013`.
- **Each migration file runs in one transaction.** If a statement fails, nothing from
  that file stays behind. Migrations that ran before it in the same install stay applied.
- **A migration that has run is frozen.** We record its checksum, and editing the file
  afterwards is rejected (`XEC-PLUGIN-2012`). Put schema changes in a **new** migration in
  your next version.
- **Updates only go forward, matched by name.** On update we run only the migrations
  whose *name* we haven't seen before, in any version. So keep the full list in the
  manifest and only append to it. Never renumber or rename one you've shipped.
- **No foreign keys across the boundary.** Prisma doesn't know about plugin tables, so
  your table can't `REFERENCES` a core table (and core can't reference yours); we reject
  it with `XEC-PLUGIN-2013`. Store the
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
    // Settings pages in the ACP join the SAVE BAR (useDraft + SaveChip from the
    // host globals), with no Save button of their own, like core's. Secrets (API
    // keys) are the exception: give them an explicit Set/Remove.
    ctx.registerAcpPage({ section: "My Plugin", label: "Things", path: "/admin/things" });

    // Notification types (for the preferences UI) + XEC error codes (for the Error Reference)
    ctx.registerNotificationTypes(["myplugin.thing_created"]);
    ctx.registerNecCodes([
      { code: "XEC-MYPLUGIN-6001", msg: "Thing not found", sev: "Error",
        domain: "My Plugin", desc: "…", cause: "…", fix: "…" },
    ]);

    // A search source: core merges your results and never queries your tables.
    ctx.registerSearchSource({
      id: "things",
      label: "Things",
      permission: null,                  // null = public, or a permission key to gate it
      search: (query, opts) => searchThings(query, opts),  // → { data: SearchResultItem[], total }
    });

    // A home feed source: the same idea, for the home and guest feeds.
    ctx.registerHomeFeedSource({
      id: "things",
      label: "Things",
      recent: (limit) => /* … */,        // → HomeFeedItem[]
    });

    // A security scan: runs with core's security analysis (every 30 min);
    // open review cases with ctx.host.security.createCase(...).
    ctx.registerSecurityScan(async () => { /* … */ });

    // Optionally claim core baseline detection patterns that your scan replaces.
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
the home feed? Register a source that returns normalized items (`SearchResultItem` /
`HomeFeedItem`). Core asks your source to run the query and merges what comes back. That
way your plugin can be installed, disabled or removed, and core just works with whatever
is registered at the moment.

### ACP settings save through the save bar

Nothing in our ACP goes live until the admin saves. Every settings surface on a page
registers its changes, and one save bar at the bottom of the screen saves or discards
them all; leaving with unsaved changes asks first. Your plugin's admin pages join the
same bar, or they'll feel out of place. Externalize the two host bridges in your
`vite.config.ts`:

```ts
"@web/hooks/useDraft":            `${H}.webUseDraft`,
"@web/components/SaveChip":       `${H}.webSaveChip`,
```

```tsx
const saveMut = useMutation({ mutationFn: (v: Settings) => api.put(`${BASE}/admin/settings`, v) });
useDraft({ value: form, savedValue: data, label: "My plugin",
           onSave: (v) => saveMut.mutateAsync(v), onDiscard: () => setForm(data) });
// …and render <SaveChip saving={false} /> in a standalone page's header.
```

That goes for settings pages and per-group panels registered through the
`groupConfigPanel` slot. Per-group config (permissions, progression) belongs there,
because it then shows up as a tab on core's own group page instead of a page of its
own. Keep an explicit button for create/edit dialogs, secrets (never part of a
draft; use Set/Remove) and destructive actions. Plugins built for the old autosave
(`useAutosave`) join the bar without a rebuild.

The full recipe, the ways it goes wrong, and the `groupConfigPanel` + progression
path are in [`docs/plugin-acp-autosave.md`](docs/plugin-acp-autosave.md).

### Local development

1. Put your plugin in `plugins/community-examples/<name>/` (or `plugins/official/<name>/`). Both are pnpm workspace members.
2. For hot reload of the web side during `vite dev`, add your web entry to `apps/web/src/plugins/dev-plugins.ts` (keep that edit local).
3. Start the stack with `./xentium.sh`, then install and enable your plugin under **ACP → Extensions → Installed → Upload** (switch on "Allow uploads" there first; or set `BOOTSTRAP_OFFICIAL_PLUGINS=true` to load the first-party plugins on startup).

### Packaging

Plugins ship as a `.xtplugin` archive: a zip of the manifest, the compiled
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

#### If the ACP shows a plugin that's gone

Everything `onEnable` registers (routes, ACP pages, content sources, security scans and
claims, XEC codes) lives in memory in the host process, and we rebuild it on startup from
the `xcf_installed_plugins` table. The lifecycle endpoints keep memory and the database in
sync. If you change plugin state behind a running process (deleting a row by hand,
resetting the DB in dev), the process keeps serving what it had, such as an ACP menu entry
for a plugin that no longer exists. Restarting the API and the worker fixes it. The worker
loads plugins too, so restart it after replacing a plugin package as well.

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

| Adapter | Source |
|---|---|
| `@xentium/migrate-wp` | WordPress, from a WXR export file (wp-admin → Tools → Export). You don't need a WordPress install or database access. |
| `@xentium/migrate-phpbb` | phpBB 3.1+, over a direct MySQL connection. The `xentium-forum` plugin must be installed and enabled on the target (we check before anything runs). Users keep their passwords. |
| `@xentium/migrate-xenforo` | XenForo 2.x, over a direct MySQL connection. Needs the `xentium-forum` plugin on the target. Users with native bcrypt hashes keep their passwords. |
| `@xentium/migrate-vbulletin` | vBulletin 3, 4, 5 and 6, over a direct MySQL connection (we detect the version). Needs the `xentium-forum` plugin on the target. Users keep their passwords. |
| `@xentium/migrate-woltlab` | WoltLab Suite 5 and 6 with or without Burning Board, and Burning Board 4, over a direct MySQL connection. Brings members, articles and the forum. Needs the `xentium-forum` plugin on the target. Users keep their passwords. |

### Running a migration

```bash
# 1. Always start with a dry run: it inspects, extracts and reports, and writes nothing
pnpm --filter @xentium/migrate-wp migrate -- \
  --file my-export.xml \
  --db "postgresql://user:pass@localhost:5432/xentium" \
  --dry-run

# 2. The real run (asks you to confirm; --yes skips that)
pnpm --filter @xentium/migrate-wp migrate -- --file my-export.xml --db "postgresql://…"

# Forums: point at the board's MySQL database instead of a file
# (same flags for @xentium/migrate-xenforo, -vbulletin and -woltlab;
#  --prefix overrides the table prefix; for WoltLab it's the instance number, e.g. 1)
pnpm --filter @xentium/migrate-phpbb migrate -- \
  --source-db "mysql://user:pass@host:3306/phpbb" \
  --db "postgresql://…" --dry-run

# Avatars are files on the old site. Point --files at the old site's folder and
# --uploads at Xentium's upload folder (UPLOAD_DIR); without them, the run reports how
# many avatars are waiting, and running again with both flags brings just those over.
pnpm --filter @xentium/migrate-phpbb migrate -- \
  --source-db "mysql://…" --db "postgresql://…" \
  --files /var/www/old-forum --uploads /srv/xentium/var/uploads
```

The target has to be an **installed** Xentium (run the wizard first). Migrations can be
**resumed**: we track every imported item in an import map, so if a run is interrupted,
the next one continues where it stopped instead of creating duplicates. Accounts that
match an existing user by email are merged into that user. Big boards are fine: posts,
private messages and likes are read and written in pages of 2,000, so a board with
millions of posts needs no more memory than a small one.

### Keeping your old links working

Add `--redirects <folder>` to the real run and we write two files there once the import
is done: an nginx file that sends every old address (threads, posts, boards, members,
articles) to its new page with a permanent redirect, and a CSV of the same list for any
other web server. The top of the nginx file says where each part goes. Posts land on the
right page of their thread, scrolled to the post. We know every platform's URL styles,
with or without friendly URLs and in any folder, and WordPress permalinks come from the
export itself.

```bash
pnpm --filter @xentium/migrate-phpbb migrate -- \
  --source-db "mysql://…" --db "postgresql://…" --redirects /srv/xentium/redirects

# Write them again later without importing anything (say, after changing the forum's
# posts per page): the same command with --redirects-only
```

### What carries over

- **Users:** accounts, display names, join dates and a best-effort role mapping (admins → Administrator, moderators → Moderator). The old board's **other member groups** (VIP, Donors and so on) are recreated by name with members in them, but with **no permissions**: what a group may do differs too much between platforms, so you grant it under ACP → Members → Groups. A name you already use for a group that grants something gets the platform in brackets, so nobody gains rights by accident. Their **last visit** on the old site shows as "Last seen" on their profile, and **smiley codes** in posts and messages (`:)`, `:D`, `:lol:`…) become emoji, leaving code and links as written. Imported members never saw your terms, so while you have terms or a privacy policy published, each of them is asked once to accept them on their first visit (declining signs them out). Where the source has password hashes (the database adapters; for XenForo we pull them out of its serialized auth data), users **keep their passwords**: we check the old hash on their first login and quietly upgrade it to argon2. WXR exports don't contain hashes, so WordPress users reset their password once. **Personal info** comes too: date of birth (only full dates) and website, into Xentium's own profile fields. **Avatars** are copied when you pass `--files` and `--uploads` (vBulletin can also keep them in its database): only real JPEG, PNG, GIF or WebP images up to 2 MB, like a normal upload. **Bans** and **warnings** still in force carry over (XenForo, phpBB, vBulletin; WoltLab's warning system isn't public), under the moderator who issued them where they came over too; expired, reversed and pardoned ones stay out. A username that's already taken gets a suffix, and the report lists every rename.
- **Content:** categories with their hierarchy, posts/articles (converted to the TipTap format; headings, lists, quotes, code, images and links survive), tags and member comments (threaded one level deep). For forums: the whole node tree, threads (locked, pinned, view counts, tags, and their **prefix**: XenForo and vBulletin prefixes and WoltLab labels become thread prefixes with their colour and boards) and posts with their BBCode converted. **Posts and messages arrive in exactly the HTML our editor saves** (paragraphs, code blocks, editor links), so they look like native posts and editing one changes nothing; outside images become links, as the editor keeps no outside images in posts. **Thread subscriptions** carry over for the threads that came over. **Profile wall posts** with their replies (XenForo, vBulletin, WoltLab) and **WoltLab article comments**, on the articles that came over, come too.
- **Social graph** where the source has one: XenForo **reactions become likes** (every reaction type turns into a like), **follows carry over 1:1** and ignores become blocks. phpBB foes become blocks. vBulletin 5/6 positive reputation on a post becomes a like and member follows carry over; vBulletin ignore lists become blocks. WoltLab reactions on posts become likes, and its follows and ignores carry over. phpBB's *friend* flag is a private buddy list, so we don't turn it into public follows. A block cancels follows in both directions, as it does in Xentium, and we recount every like and follower total.
- **Private messages** (phpBB, XenForo, vBulletin, WoltLab) become conversations when the `xentium-messaging` plugin is enabled on the target; without it they're counted and reported, and a later run brings them over. Each conversation goes only to its participants, ones a member deleted or hid arrive archived, ones they left show them as having left, and imported conversations count as read. vBulletin 3/4 and phpBB store single messages, so we group their reply chains back into conversations.
- **Not migrated:** themes and styling (Xentium has its own appearance system), the old platform's plugins, guest comments and guest forum posts (posts on Xentium need an account), signatures, polls, custom profile fields, and attachments (imported posts link to them by URL). The migration report lists everything we skipped and why.

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

The core is MIT, see [LICENSE](./LICENSE). That covers everything in this repository
and the npm packages built from it (`@xentium/server`, `create-xentium`, the `xentium`
CLI and the framework packages). You can use, change and redistribute it, commercially
too, as long as the licence notice stays with it.

The official plugins and themes are not. The paid plugins and themes we sell on
[plugins.xentium.org](https://plugins.xentium.org) are proprietary. Their source is not in
this repository, and they are licensed per domain under the marketplace's terms. Buying one
lets you run it on your licensed site; it doesn't let you share, resell or republish it.

A few things to know:

- **Core never needs a paid plugin.** Every core feature works without one, and a
  lapsed licence never breaks your site.
- Your own plugins and themes are yours. The plugin SDK and the framework packages
  are MIT, so you can build on them and license what you make however you like, paid or
  open source.
- Third-party plugins and themes are licensed by their authors, not by us.
- Dependencies keep their own licences (fonts under the SIL Open Font License,
  Font Awesome Free under its own terms, and so on). We never bundle Font Awesome Pro; you
  add your own kit, see [`docs/icon-kits.md`](./docs/icon-kits.md).
