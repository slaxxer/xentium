# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Nodevo

Nodevo is an extensible CMS/community platform framework built with TypeScript, Node.js (≥22.12), Express 5, React 19, and PostgreSQL. It uses a pnpm monorepo managed by Turborepo.

## Commands

```bash
# Full dev environment (starts Docker infra + api + worker + web)
./nodevo.sh
./nodevo.sh down          # stop infra containers

# Individual app dev (requires infra already up)
pnpm dev:apps          # api + worker + web concurrently

# Per-workspace
pnpm --filter @nodevo/api dev
pnpm --filter @nodevo/web dev

# Quality checks (run all before merging)
pnpm backbone:check    # typecheck + lint + test + build
pnpm typecheck
pnpm lint
pnpm test
pnpm build

# Database
pnpm db:generate       # regenerate Prisma client after schema changes
pnpm db:migrate        # run migrations (dev)
pnpm db:studio

# Run a single test file
pnpm --filter @nodevo/api exec vitest run src/modules/auth/auth.test.ts
```

## Monorepo Layout

```
apps/api          Express API server + BullMQ worker
apps/web          Vite + React frontend
packages/
  contracts       Shared constants: CorePermissions, InstallStep, ThemeManifest
  ui              Shared React components. v1 reality: only GroupAccessPicker
                  ships here (used by core ACP + forum, §39). The originally
                  planned Button/Card/Field/Input/cn primitives were NOT built
                  here — the SCSS/Hearth redesign keeps UI primitives in apps/web.
  config          Shared tsconfig base + ESLint config
  sdk             Placeholder for public SDK
  plugin-sdk      Placeholder for plugin development kit
plugins/
  official/       First-party plugins
  community-examples/
themes/           Theme packages (default included)
prisma/           Schema, migrations (generated client → apps/api/src/generated/prisma)
docker/           docker-compose for Postgres 17 + Redis 7
```

## API Architecture (`apps/api`)

**Entry points**: `src/server.ts` (HTTP) and `src/worker.ts` (BullMQ queues).

**Module conventions** — each feature module under `src/modules/<name>/` has the same shape:
`*.routes.ts` → `*.controller.ts` → `*.service.ts` → `*.repository.ts`, plus `*.validation.ts`, `*.types.ts`, `*.test.ts`.

**Infrastructure** (`src/infrastructure/`):
- `db.ts` — singleton `prisma` using `@prisma/adapter-pg` (driver adapter, not connection pool)
- `redis.ts` / `queue.ts` — ioredis + BullMQ setup

**Shared** (`src/shared/`):
- `errors/NodevoError.ts` — typed error class with NEC codes (`NEC-API-4001/4003/4004/5000`)
- `errors/errorMiddleware.ts` — last-in-chain error handler
- `middleware/requireAuth.ts` — verifies `Authorization: Bearer <access-token>`, injects `req.userId` / `req.sessionId`
- `middleware/requirePermission.ts` — checks `User → UserGroup → Group → GroupPermission → Permission` chain
- `middleware/installGuard.ts` — blocks all routes until install is complete (installer routes are exempt)

**Config** (`src/config/env.ts`): Zod-validated at startup; loads `.env` from the repo root. Required vars: `DATABASE_URL`, `COOKIE_SECRET` (≥16 chars), `JWT_SECRET` (≥32 chars), `DUMMY_ARGON2_HASH`.

## Auth System

- **Access token**: HS256 JWT, 15-minute TTL, carried in `Authorization: Bearer` header
- **Refresh token**: random 32-byte value stored as SHA-256 hash in `Session`, sent as an httpOnly signed cookie, rotated on every use
- Session rotation is transactional: old session is revoked, new one is created atomically

## Permission System

Permissions are flat keys (`admin.access`, `article.create`, etc.) defined in `@nodevo/contracts` → `CorePermissions`. Groups hold permissions; users belong to groups. Use `requirePermission(key: PermissionKey)` on routes that need a specific capability.

## Installer

Multi-step wizard: `WELCOME → ENVIRONMENT → DATABASE → SITE_CONFIG → ADMIN → FINALIZE → COMPLETE`. Steps live in `src/core/installer-engine/steps/`. The `InstallStep` enum and step order are exported from `@nodevo/contracts`. The `installGuard` middleware short-circuits all non-installer API calls while `installed = false`.

## Web Architecture (`apps/web`)

React 19 + Vite 8 + React Router 7 + TanStack Query + Tailwind v4.

- `src/app/App.tsx` — root with `<InstallGate>` wrapping the router; redirects to the installer if not installed
- `src/lib/api.ts` — thin `fetch` wrapper with `credentials: "include"` for cookie auth
- `src/lib/i18n.ts` — i18next with HTTP backend; translation files served from `/locales/{lng}/{ns}.json`
- `src/features/` — self-contained feature slices (installer, profiles, articles)
- `src/hooks/useTheme.ts` — light/dark toggle persisted to `localStorage`
- `src/plugins/ThemeRegistry.ts` — client-side registry for `ThemeManifest` objects from `@nodevo/contracts`

## Packages / Plugin / Theme Authoring

- Import shared types from `@nodevo/contracts` (workspace dep)
- UI primitives from `@nodevo/ui`
- Theme packages export a `ThemeManifest` and register via `ThemeRegistry`
- Plugin permission keys should follow the `domain.action` pattern and be added to `CorePermissions` in `packages/contracts/src/permissions.ts`


# Nodevo v1 — Complete Reference Document
**Last updated: May 21, 2026**
*Single source of truth for architecture, product, and design decisions.*

---

## 1. What Nodevo Is

Nodevo is an **open-source modular CMS/platform** built as a learning-driven but production-shaped project.

It is usable out of the box as:
- An **article/CMS platform**
- A **plugin host platform**
- A base for a growing extension ecosystem

**Core product philosophy:**
- Open-source core first
- Commercial value comes from official premium plugins, not from crippling the core
- Modular monolith, not microservices
- PostgreSQL as the primary database
- REST-first API
- Explicit module, plugin, and permission boundaries
- Buildable by a small team or one determined builder

---

## 2. Frozen v1 Decisions

These are locked unless explicitly revised.

| Decision | Choice |
|---|---|
| Architecture | Modular monolith |
| API style | REST |
| Primary database | PostgreSQL 17+ |
| ORM | Prisma 7 |
| Backend language | TypeScript + Node.js LTS |
| Frontend | React 19 + Vite |
| Monorepo tooling | pnpm workspaces + Turborepo |
| Theming scope | Light + Dark only |
| Forum | Official plugin, not core |
| Private messaging | Official plugin, not core |
| Notifications | Core — cross-cutting dependency |
| Article comments | Core-owned `article_comments` table |
| Article categories | Nested tree with drag-and-drop ACP, same access control model as forum nodes |
| WYSIWYG editor | TipTap (MIT license) |
| Plugin format | `.nvplugin` (ZIP archive) |
| Style pack format | `.nvstyle` (ZIP archive) |
| License model | Open-source core + paid official plugins |
| License mechanism | RS256 signed JWT entitlement tokens |

---

## 3. Stack

### Backend
- Node.js LTS
- TypeScript
- Express 5
- Prisma 7
- PostgreSQL 17+
- Redis + BullMQ
- Zod (validation + env parsing)
- Pino (structured logging)
- Helmet, cors, cookie-parser
- argon2 (password hashing)
- jose (JWT/RS256)
- express-rate-limit + rate-limit-redis (Redis-backed, multi-process safe)
- multer
- Vitest + Supertest (testing)

### Frontend
- React 19
- Vite
- TypeScript
- React Router
- TanStack Query
- React Hook Form + Zod
- Tailwind CSS v4
- TipTap (MIT WYSIWYG editor)

### Tooling
- pnpm workspaces
- Turborepo
- ESLint + Prettier
- Docker Compose
- Playwright (e2e)

---

## 4. Repository Structure

```
nodevo/
  apps/
    api/                  Main backend
    web/                  Main frontend

  packages/
    contracts/            Shared DTOs, enums, permission keys, manifest types
    sdk/                  Shared runtime helpers for core AND plugin authors:
                          slug (slugify/uniqueSlug), access (userCanSeeNode/
                          resolveEffectiveVisibility/VISIBILITY_MODES), re-exported
                          pagination types. Also bundles license-public-key.pem
                          (read by license-engine). NOTE: not a web API client —
                          the browser uses apps/web/src/lib/api.ts.
    ui/                   Internal shared UI component library
    plugin-sdk/           Public plugin authoring contract
    config/               Shared tsconfig, eslint, prettier

  plugins/
    official/             Official Nodevo plugins (forum, messaging, etc.)
    community-examples/   Reference plugins for local dev

  themes/                 Reserved for v2 `.nvstyle` / `.nvtheme` packs (empty in v1)
    # v1 NOTE: the planned `default/` + `fonts/manifest.json` package was NOT built.
    # v1 ships tokens as SCSS in `apps/web/src/styles/tokens.scss` and fonts via
    # npm `@fontsource/*` packages imported in `apps/web/src/main.tsx`. See §13/§24.

  prisma/                 Schema + migrations
  scripts/                Build, release, scaffolding, signing utilities
  docs/                   Architecture notes, ADRs, SDK docs
  docker/                 Local infrastructure
```

---

## 5. Backend Architecture

```
apps/api/src/
  app/              App creation, route registration, HTTP wiring
  config/
    rate-limits.ts    Named rate limit constants (all limits defined here)
    env.ts            Zod-parsed environment variables
  core/
    plugin-engine/    Package validation, manifest, install/enable/disable lifecycle
    license-engine/   Entitlement checks, activation, refresh job
    installer-engine/ First-run wizard backend
    # v1 NOTE: the planned core/style-engine/ was NOT built here. Appearance
    # (token persistence, .nvstyle handling, style history) lives in
    # modules/appearance/ (appearance.service.ts + appearance.routes.ts).
    # Fonts are client-side via @fontsource (§24); there is no server font-loader.
    # permission-registry/ and event-infrastructure/ were never built — RBAC lives
    # in modules/permissions/. Built registries instead: home-feed-registry,
    # nec-registry, search-registry.
  modules/
    auth/
    users/
      user.routes.ts
      user.service.ts
      user.repository.ts
      profile-comments/     Profile wall (§40)
      profile-fields/       Custom field schema + user values (§41)
      follows/              Follow/unfollow (§36)
      blocks/               Block/unblock (§36)
      username-history/     Username change log (§35)
      progression/          Promotion engine + counter updates (§38)
    groups/
    permissions/
      permission.cache.ts   Redis-backed effective permission cache
    articles/
      article.comments.ts   Core-owned article comments (§33)
    notifications/          Core service — all modules and plugins dispatch through here
    search/                 PostgreSQL full-text, plugin-extensible content type registry
    moderation/
    admin/
    settings/
    plugins/
    licenses/
    installer/
    audit-log/
    security-events/    Login events, IP/UA/device-cookie telemetry
    appearance/
  infrastructure/
    db/               Prisma client
    redis/
    queue/            BullMQ workers
    storage/
      storage.provider.ts   StorageProvider interface
      local.provider.ts     LocalStorageProvider (v1 implementation)
      storage.service.ts    Reads active provider, called by all upload logic
    logging/          Pino setup
    email/
      email.service.ts
      email.templates.ts
      templates/        HTML email templates
  shared/
    errors/           NodevoError class + NEC error registry
    middleware/
      rate-limiter.ts   Uses RATE_LIMITS constants
    validators/
    helpers/
      slug.ts           Shared slug generator with DB uniqueness enforcement
      pagination.ts     Shared pagination helpers
  jobs/               Queue workers + scheduled jobs
  bootstrap/          Core permission registration, defaults, ThemeRegistry init, search index setup
  server.ts           HTTP server entry point (Express)
  worker.ts           BullMQ worker entry point — runs separately from server in production
```

Each module follows this pattern:
```
modules/articles/
  article.routes.ts
  article.controller.ts
  article.service.ts
  article.repository.ts
  article.validation.ts
  article.types.ts
  article.test.ts
```

---

## 6. Frontend Architecture

```
apps/web/src/
  app/              Router, providers, app bootstrapping
  pages/            Route-level page entry points
  features/
    auth/
    account/            Account settings (profile, security, notifications, preferences, privacy)
    profiles/           Public profile pages, profile wall, information tab, follow/following tabs
    articles/
    modcp/          ModCanvas + all mod tool sections
    admin/          ACP shell + all ACP feature pages
    plugins/
    appearance/
    settings/
  components/       Reusable UI components
  layouts/          Core layout shell (owns page structure)
  hooks/            Reusable React hooks
  lib/              Small client utilities + global state (authStore.ts uses
                    useSyncExternalStore — in-memory access token + user, §43).
                    NOTE: no store/ or types/ folder in v1, and no Redux/zustand —
                    server state is TanStack Query; global client state is authStore.
                    Shared types are colocated in features/ and lib/.
  styles/           Global SCSS (tokens.scss, fonts.ts) — SCSS, not Tailwind (Hearth redesign)
  plugins/          Frontend plugin slot registry
  main.tsx
```

---

## 7. Core Modules in Scope for v1

| Module | Notes |
|---|---|
| Installer | 7-step wizard. First-run only. Files self-removed post-install. |
| Auth | Email/password, sessions/refresh, password reset, email verify |
| Users | Accounts, profiles, settings |
| Groups | Flat permission groups, built-in protected groups |
| Permissions | RBAC, permission keys, group-permission mapping, Redis cache |
| Articles / CMS | Articles, categories, revisions, article comments, TipTap editor |
| Notifications | Core service. All modules dispatch through it. Plugins dispatch via plugin-sdk. |
| Search | PostgreSQL full-text (`tsvector`). Articles + users in core. Plugins extend via registry. |
| Admin Panel (ACP) | Full management shell with sidebar nav |
| Settings | System-level config storage |
| Plugin Engine | Manifest validation, package lifecycle, plugin migration runner |
| License Engine | Entitlement tokens, activation, refresh |
| Moderation | Reports, warnings, bans, review cases, log, policy, threshold engine |
| ModCanvas | Floating mod tool (frontend) |
| Appearance | Style editor, style packs, font system, history, ThemeRegistry |
| Storage | `LocalStorageProvider` behind `StorageProvider` interface. S3/R2 in v2. |
| Audit Log | Foundation only |
| Security Events | Login events, IP/UA/device-cookie telemetry |
| Error System | NEC error codes, central handler, ACP reference + log |

**Not in core (official plugins):** Forum, Private Messaging

**Build order for official plugins:** Forum first — proves the ecosystem end-to-end. Private Messaging second — more complex, not needed to validate the plugin pipeline. Advanced Moderation after both.

---

## 8. Built-in Groups

| Group | Protected | Notes |
|---|---|---|
| Administrator | Yes | Full access |
| Supermod | Yes | Full mod + content access |
| Moderator | Yes | Mod tools, limited admin |
| Member | Yes | Standard registered user |
| Guest | Yes | Unauthenticated visitors |
| (Custom groups) | No | Admin-created as needed |

---

## 9. Permission Key System

Format: `domain.action` or `domain.action.scope`

Examples:
```
article.create
article.edit.own
article.edit.any
article.publish
user.ban
user.delete
moderation.warn
moderation.ban
moderation.cases.view
moderation.settings
admin.access
admin.plugins
plugin.install
plugin.enable
forum.thread.create         ← declared by forum plugin
forum.moderate              ← declared by forum plugin
```

Plugins declare their own permission keys via `plugin-sdk` inside `onEnable()`.

---

## 10. Plugin System

### Plugin Classes
1. **Core features** — shipped with Nodevo
2. **Official Nodevo plugins** — paid, licensed, from nodevo.io
3. **Community plugins** — always free, uploaded via ACP

### Package Format
`.nvplugin` — ZIP archive containing:
- `manifest.json` (id, name, version, vendor, min/max Nodevo version, entrypoints, permissions declared, license required flag, migration list)
- Server entry
- Web entry (if any)
- Migrations (if any)
- Assets (if any)

### Plugin Lifecycle
1. Upload / download
2. Temp extraction
3. Manifest validation
4. Compatibility check
5. Trust check (signature for official, unsigned for community)
6. Install (package stored, metadata registered)
7. Migrations run
8. Register
9. Enable → plugin becomes active
10. Disable → behavior stops, data preserved
11. Uninstall → package removed, migrations optionally reversed

**Install and Enable are always separate operations.**

### Plugin Extension Points (v1)
- Register routes
- Register ACP pages
- Register settings
- Register permission keys
- Register event handlers
- Register UI slots (frontend)

No unrestricted patching of core internals.

### Safety Rules
- Extract to temp directory before anything
- Validate paths (zip-slip prevention)
- Never overwrite core files
- Validate manifest before install
- Separate install from enable always

---

## 11. License System

### Philosophy
- Core is open-source and usable without a license
- Licensing gates **official premium plugin** install/enable only
- Expiry never bricks the site — running plugins keep running
- New installs/updates of licensed plugins require a valid entitlement

### Activation Flow (v1 — Manual Key)
1. Admin buys on nodevo.io → receives license key
2. Enters key in ACP → Extensions → License
3. Nodevo sends `{ licenseKey, siteId }` to license server
4. License server returns RS256-signed JWT entitlement token
5. Token stored locally, verified with bundled public key

### Entitlement Token Contains
- `siteId`
- `licenseKey`
- `entitlements[]` — e.g. `["plugin.nodevo-forum", "plugin.nodevo-seo-tools"]`
- `issuedAt`, `expiresAt`, `refreshAfter`

### Expiry Behaviour
- Grace period: 30 days if license server unreachable
- On hard expiry: running plugins continue, new installs/updates blocked

### Refresh
- Daily BullMQ background job

### Account Connection (v1 — promoted from v2 by ADR 0001)
- Connecting a marketplace account is now the **primary** path; the manual key is the
  **offline fallback**. Enforcement moves to the authenticated download gate, and
  entitlements are **per-domain** bound. See §53 and `docs/adr/0001-marketplace-entitlement.md`.
- v2 still owns: connected nodevo.io **OAuth** account (replacing the auth-code exchange),
  and self-service domain re-bind UI.

---

## 12. Moderation System

> **v1 reality (June 2026):** the **Review Cases** detection (the Security Events →
> Moderation Cases pipeline) is no longer core — it moved to the **nodevo-advanced-
> moderation** plugin (see §15 note). Core still owns the cases table, the review UI
> (ModCanvas Cases / ACP Review Cases), the exception whitelist, reports, warnings,
> bans, and the moderation log. Without the plugin, no review cases are auto-created.

### Features
- **Reports** — targetType: `article | article_comment | profile_comment | user | plugin-content`. Status: pending | reviewed | resolved | dismissed.
- **Warnings** — status: active | expired | pardoned. Optional expiry. Pardon removes from active count.
- **Bans** — type: temporary | permanent. Status: active | expired | lifted.
- **Moderation Log** — immutable. Records actor (human username or "SYSTEM"), action, target, timestamp. Distinguishes human vs system-triggered entries.
- **Review Cases** — informational alerts from security events. No auto-action in v1.

### Warning Threshold Engine
Configured via `moderation.policy` settings (JSON, Zod-validated, versioned in audit log):
- Count active (non-expired, non-pardoned) warnings
- Match against threshold rules → trigger action
- Log as SYSTEM actor
- Daily BullMQ job expires warnings, recalculates thresholds

### Ban Expiry Job

A daily BullMQ job checks for temporary bans past their `expires_at`:
```sql
UPDATE moderation_bans SET status = 'expired' WHERE type = 'temporary' AND status = 'active' AND expires_at < NOW();
UPDATE users SET banned_until = NULL WHERE id IN (
  SELECT user_id FROM moderation_bans WHERE status = 'expired' AND expires_at < NOW()
);
```
Both updates run inside a transaction. Logs each expiry to `moderation_log` as SYSTEM actor. Users whose bans expire are NOT notified (they can simply log in again).

### Deleted Posts (Forum)
- Posts are never truly deleted — they are **deactivated**
- Moderator must provide a reason
- Deleted post displays: `Post by [USER] was deleted by [MODERATOR] · [TIMESTAMP] · Reason: [REASON]`
- Shown red-highlighted in thread
- Content is hidden, tombstone record preserved

### ModCanvas (Frontend)
- Floating 🛡️ button, fixed bottom-right
- Only renders for users with any `moderation.*` permission
- Badge: pending reports + open cases. Colors: 1-5 neutral, 6-20 amber, 21+ red
- Keyboard shortcut: `Shift+M`
- Slides in from right, stays open across page navigations
- Context-aware: detects current page (user profile → pre-populates user fields)
- 6 sections: Dashboard, Reports, Warnings, Bans, Cases, Log
- Each section gated by individual permission key

---

## 13. Appearance System

### Style Editor
- Editable regions: Global, Header, Navbar, Footer, Content, Buttons, Typography
- Controls: color picker, font dropdown, range sliders, weight selector
- Light and dark mode edited independently
- Live preview iframe
- Save → compiles tokens to CSS override file

### Curated Font List (pre-bundled, no API key)

> **v1 implementation note (Hearth redesign):** the original `themes/default/fonts/manifest.json`
> approach was dropped. v1 bundles fonts via npm `@fontsource/*` packages imported in
> `apps/web/src/main.tsx`, and the selectable set is defined in `apps/web/src/styles/fonts.ts`.
> The shipped set is the 6-family Hearth list below (default **Raleway**), not the 13-font
> table originally planned. The fuller list is retained as the v2 target for when `.nvstyle`/
> `.nvtheme` packs can ship their own fonts.

**v1 shipped set (`apps/web/src/styles/fonts.ts`):** Raleway (default), Montserrat, Poppins,
Open Sans, Ubuntu, Roboto.

**Original v2 target list (manifest-driven, not built in v1):**

| Category | Fonts |
|---|---|
| Sans-serif | Inter, Roboto, Open Sans, Poppins, Nunito, DM Sans (default) |
| Serif | Playfair Display, Merriweather, Lora |
| Monospace | JetBrains Mono, Source Code Pro |
| Display | Syne, Raleway |

### Style Packs (`.nvstyle`)
- ZIP: `manifest.json` (type: "style-pack"), `styles/light.css`, `styles/dark.css`, `preview/`
- v1 CSS validation: only `:root` CSS custom property overrides allowed
- Style history: last N saved states with preview + restore

> **v1 reality (June 2026):** two additions beyond the original spec, both in
> `modules/appearance/` — see the live-style-sync memory for full detail:
> 1. **Custom CSS console** (ACP → Style Editor → Custom CSS): admins (`admin.access`)
>    can author raw per-theme CSS (settings `appearance.custom_css_light/dark`,
>    Zod-capped at 100KB each). Validated (parseable) and theme-scoped/specificity-
>    boosted via postcss **at save time**; the compiled result is cached in setting
>    `appearance.custom_css_compiled` and appended last in the served stylesheet, so
>    `GET /css` never parses CSS. This is a deliberate **trusted-boundary exception**
>    to the `:root`-only rule above, which still applies to `.nvstyle` pack uploads
>    (`validateStylePackCss`). Served as `text/css` only.
> 2. **Live style sync**: `GET /api/appearance/version` (public, `no-store`) returns
>    `{ version, intervalMs }`; every client polls it (default 5s, clamped 2–60s via
>    setting `appearance.live_refresh_seconds`) and refetches `/css` cache-busted when
>    the version bumps. There is no compiled CSS override *file* — `buildCSS()` composes
>    the stylesheet from settings per request; `/css` carries `max-age=60`. Both
>    endpoints are exempt from the global rate limiter (§26 note).
>    The editable token defaults live once in `@nodevo/contracts` →
>    `HEARTH_DEFAULT_TOKENS` (consumed by API + Style Editor; tokens.scss stays the
>    rendering source of truth).
> 3. `POST /api/appearance/reset` deletes all appearance override settings so the app
>    inherits the bundled `tokens.scss` directly ("true core design").

### v2 Theme Templates (`.nvtheme`)
- Full component + layout overrides
- v1 code stays v2-ready: all layout in `layouts/`, every visual decision references CSS var, no hardcoded colors

---

## 14. Error System

### Format
`NEC-[DOMAIN]-[CODE]`

### Domains
`NEC-AUTH`, `NEC-USER`, `NEC-PERM`, `NEC-PLUGIN`, `NEC-LICENSE`, `NEC-INSTALL`, `NEC-ARTICLE`, `NEC-MOD`, `NEC-STORE` (file storage/upload errors), `NEC-DB`, `NEC-QUEUE`, `NEC-CORE`, `NEC-API`

### Error Object
```typescript
{
  code: string        // e.g. "NEC-PLUGIN-2001"
  message: string
  context?: object
  timestamp: string
  severity: "info" | "warn" | "error" | "critical"
}
```

- Central `NodevoError` class in `shared/errors/`
- Middleware catches all, logs via Pino, persists to error log
- Stack traces never exposed to clients
- Community plugins register custom codes via plugin-sdk
- ACP pages: System → Error Reference (lookup by code) and System → Error Log (filterable)

---

## 15. Anti-Abuse Telemetry Foundation

> **v1 reality (June 2026) — detection moved to the paid plugin.** The original design
> put the detection patterns (the `security-analysis` job below) in **core**. They now
> live entirely in the **nodevo-advanced-moderation** plugin. Core ships **no detection
> logic** — a plugin-less install creates **no review cases at all**.
>
> What core still owns (the **foundation any moderation/security plugin builds on**):
> 1. **Telemetry data** — `ncf_login_events` (IP, user-agent, device cookie, success/
>    failure, event type, timestamp), written by core auth. Plugins read it via `host.prisma`.
> 2. **Scan cadence** — a generic "Security scans" scheduled job runs every registered
>    `ctx.registerSecurityScan(fn)` every 30 min (no-op with no plugin). This is core
>    infrastructure, NOT advanced-moderation's, so any plugin's scans fire.
> 3. **Case system** — `host.security.createCase()` (dedup + mod-notify), the
>    `ncf_moderation_cases` table, and the ModCanvas Cases / ACP Review Cases UI.
> 4. **Exception whitelist** — `ncf_reviewed_security_signals` + the "mark exception" action.
> 5. **Enforcement** — `host.security.autoBanMultiaccounts()`, `host.notificationService`.
>
> So a plugin author writes **only the detection brains**; data, scheduling, case storage,
> review UI, exceptions, and enforcement are all core. The auto-ban (opt-in) and
> impossible-travel are advanced-moderation features. The "no auto-ban from a single
> shared signal" hard rule below was relaxed by user decision (opt-in auto-ban requires
> device cookie + IP + user-agent all identical).

v1 logs and persists — but does **not** auto-enforce:
- Auth success/failure events
- Session metadata
- IP metadata
- User-agent metadata
- Optional first-party device-cookie identifiers
- Moderation-relevant audit trails
- Review cases for suspicious account-link signals (shown in ModCanvas + ACP)

**Hard rules:**
- No true browser hardware fingerprinting
- No auto-ban from a single shared signal (IP alone)
- No automated ban waves from multi-account suspicion
- Review cases are informational and moderator-reviewed only

This foundation exists so future plugins (e.g. Advanced Moderation) can correlate signals without invasive tracking being added retroactively.

### Security Events → Moderation Cases Pipeline

A BullMQ job (`security-analysis`) runs every 30 minutes and scans recent `security_events` for suspicious patterns:

| Pattern | Signal | Creates case type |
|---|---|---|
| 3+ failed logins from same IP in 10 min | `login_failure` burst | `rapid_login_attempts` |
| 2+ accounts share same `device_cookie` | device cookie match | `multi_account_suspicion` |
| New account registered within 10 min of ban | IP + timing | `ban_evasion_suspicion` |
| 5+ accounts from same IP in 24h | IP registration burst | `registration_burst` |

When a pattern is detected, a `moderation_cases` row is created (status `open`) and a `mod.new_case` notification is sent to users with `moderation.cases.manage` permission. Cases are reviewed manually — no auto-action in v1.

---

## 16. Installer

### Purpose
First-run wizard. Configures the instance without hand-editing.

### Steps
1. Welcome
2. Environment check (Node, PostgreSQL, Redis, disk, permissions, OpenSSL)
3. Database configuration (host, port, name, user, password + test connection)
4. App configuration (site name, URL, language, timezone) + **RS256 key pair generated** (`JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `REFRESH_TOKEN_HMAC_SECRET` written to `.env`)
5. Admin account creation
6. `prisma migrate deploy` (applies schema) + seeding (default groups, permissions, system profile fields) + `site.id` UUID written to settings + config written
7. Completion → links to ACP + site

### Rules
- Installer is a first-class module with backend endpoints + frontend wizard
- Idempotent steps where practical
- Installer routes and files are removed / locked out after successful completion
- Installer link disappears from public navigation post-install

---

## 17. API Design

### Route Groups
```
/api/install/*
/api/auth/*
/api/users/*
  /api/users/:id/followers
  /api/users/:id/following
  /api/users/:id/follow        POST / DELETE
  /api/users/:id/block         POST / DELETE
  /api/users/:id/profile-comments
  /api/users/me/blocks
  /api/users/me/limits         ← effective content limits from progression config
/api/groups/*
/api/articles/*
/api/notifications/*
/api/search
/api/profile-fields/*          ← admin CRUD for custom field schema
/api/moderation/*
/api/admin/*
  /api/admin/health            ← deep health check: DB + Redis + queue + storage
  /api/admin/registered-pages  ← returns plugin-registered ACP pages (used by ACP nav)
/api/plugins/*
/api/licenses/*
/api/settings/*
/api/appearance/*
/api/health                    ← basic API liveness check
```

Forum routes (`/api/forum/*`) are registered by the official forum plugin, not core.

### Principles
- Validate ALL input with Zod on every endpoint — request body, params, query strings, headers. No exceptions.
- Explicit DTOs
- Predictable error shapes (NEC codes)
- All permission and license checks on the backend
- Frontend checks are UI-only

---

## 17b. Security Foundations

These requirements apply across the entire codebase. Not a Phase 17 concern — built in from Phase 1.

### Input Validation

Every API endpoint validates all inputs with Zod before any business logic runs. This is enforced by the global error middleware catching `ZodError` instances and returning `NEC-API-4001` (validation failed). No endpoint may access `req.body`, `req.params`, or `req.query` without first passing through a Zod schema. This prevents type confusion, injection, and unexpected nulls.

### XSS — TipTap Content Sanitisation

**Body storage format:** TipTap content is stored as **JSON** (TipTap's internal ProseMirror JSON format) in the `articles.body` column. This is the canonical format. The frontend renders it back via TipTap — never via `dangerouslySetInnerHTML` on the raw JSON.

**`body_plain` extraction:** On every article save, the service traverses the TipTap JSON tree and extracts all text nodes into `body_plain`. This is used for search vectors only. Never rendered as HTML.

**HTML rendering:** TipTap renders its own JSON to HTML in the browser. This output is safe by design (TipTap sanitises its own output). No raw HTML is ever stored in the DB for article content.

**Profile comments and article comments:** These use plain text only (no rich formatting in v1). Stored as `TEXT`, rendered as text. No HTML sanitisation needed.

**CSS in `.nvstyle` packs:** The style engine validates that `.nvstyle` CSS files only contain `:root { --css-custom-properties: ... }` declarations. Any other CSS rule type is rejected on upload. This prevents injecting arbitrary CSS that could execute scripts (`expression()`, `url('javascript:...')`).

### File Upload Security

All file uploads go through multer + the StorageService. Limits defined in `config/upload-limits.ts`:

```typescript
export const UPLOAD_LIMITS = {
  AVATAR:        { maxBytes: 2 * 1024 * 1024,  allowedMimeTypes: ["image/jpeg","image/png","image/gif","image/webp"] },
  FEATURED_IMAGE:{ maxBytes: 5 * 1024 * 1024,  allowedMimeTypes: ["image/jpeg","image/png","image/gif","image/webp"] },
  PLUGIN_PACKAGE:{ maxBytes: 50 * 1024 * 1024, allowedMimeTypes: ["application/zip","application/octet-stream"] },
  STYLE_PACK:    { maxBytes: 10 * 1024 * 1024, allowedMimeTypes: ["application/zip","application/octet-stream"] },
} as const;
```

MIME types are validated by reading the file's magic bytes (first N bytes), not the `Content-Type` header (which is user-controlled). A library like `file-type` is used for this. Multer validates size; the service validates actual MIME type.

**SVG uploads** (allowed for logos only) are served with `X-Content-Type-Options: nosniff` and a restrictive CSP applied to the `/uploads` route (`script-src 'none'`). Since only admins can upload SVGs, this is an acceptable trust boundary in v1, but the header defence prevents script execution if a malformed SVG is ever served.

### Storage Access Control

The static file route (`/uploads`) only serves content from specific public subdirectories:

```
Public (served via /uploads):
  avatars/            ← user profile pictures
  articles/           ← article featured images

Private (never served statically — API-only):
  plugins/            ← .nvplugin packages
  themes/packs/       ← .nvstyle packs
  themes/active/      ← compiled active CSS (served via /api/appearance/css)
  temp/               ← extraction staging (cleaned after install)
```

Plugin packages and style packs are only accessible through authenticated API endpoints with the appropriate permission check. The static file middleware explicitly rejects requests to paths outside the public allowlist.

### Plugin Migration SQL Trust Boundary

The Phase 14 migration runner validates that plugin migration files contain **DDL statements only**. Specifically it allows: `CREATE TABLE`, `ALTER TABLE`, `DROP TABLE`, `CREATE INDEX`, `DROP INDEX`, `CREATE UNIQUE INDEX`. It rejects: `INSERT`, `UPDATE`, `DELETE`, `SELECT`, `TRUNCATE`, `COPY`, and any statement that isn't DDL. A basic SQL parser runs before any migration executes. If validation fails, the install is rejected with `NEC-PLUGIN-2010` (invalid migration SQL).

### Dynamic Plugin Route Management

Express has no native route deregistration. When a plugin is disabled, its routes remain registered in Express but a middleware at the start of each plugin route group checks plugin status:

```typescript
// Added automatically by the plugin engine to every registered plugin route
router.use((req, res, next) => {
  const plugin = pluginRegistry.get(PLUGIN_ID);
  if (!plugin || plugin.status !== 'enabled') {
    return res.status(404).json({ code: 'NEC-PLUGIN-2020', message: 'Plugin not available' });
  }
  next();
});
```

This is transparent to the plugin author. The engine injects this middleware automatically when registering plugin routes. Disabling a plugin takes effect immediately for all new requests.

### Password Reset Security

Password reset uses a **DB-backed single-use token** (not a JWT). Rationale: a JWT reset link remains valid until expiry even after use or after the password is changed. A DB token can be invalidated immediately.

```sql
password_reset_tokens
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,   -- SHA-256 HMAC (same reasoning as refresh tokens — random 32-byte value, brute force impossible)
  expires_at  TIMESTAMPTZ NOT NULL,   -- 15 minutes from creation
  used_at     TIMESTAMPTZ NULL        -- set on use; subsequent uses rejected
```

Flow: generate random 32-byte token → SHA-256 HMAC with `REFRESH_TOKEN_HMAC_SECRET` → store hash in `password_reset_tokens` → email the raw token in reset link → on reset: look up hash, check expiry, check `used_at` is null, set password, set `used_at = NOW()`, **delete all `refresh_tokens` for this user**.

The last step (delete all refresh tokens) is critical: it ends all active sessions when a password is changed.

Similarly, **changing a password via Account Settings** must also delete all refresh tokens except the current session's token.

`password_reset_tokens` is added to the Phase 2 Prisma schema.

### Session Security on Password Change

Any action that modifies credentials must invalidate all sessions:
- Password reset → delete all `refresh_tokens` for user
- Password change (account settings) → delete all `refresh_tokens` except current
- Account deactivation → delete all `refresh_tokens` for user
- Admin-initiated force logout → delete all `refresh_tokens` for user

### Content Security Policy

Helmet is configured in Phase 1 with an explicit CSP:

```typescript
helmet.contentSecurityPolicy({
  directives: {
    defaultSrc:     ["'self'"],
    scriptSrc:      ["'self'"],            // no inline scripts, no eval
    styleSrc:       ["'self'", "'unsafe-inline'"],  // inline styles needed for Tailwind
    imgSrc:         ["'self'", "data:", "blob:"],
    connectSrc:     ["'self'"],
    fontSrc:        ["'self'"],
    objectSrc:      ["'none'"],
    frameAncestors: ["'none'"],
    upgradeInsecureRequests: [],
  }
});
```

`unsafe-inline` for styles is needed for Tailwind CSS. No `unsafe-eval` or `unsafe-inline` for scripts.

### ACP Deep Health Check

`GET /api/admin/health` (requires `admin.access` permission):

```typescript
{
  db:      { status: "ok" | "error", latencyMs: number },
  redis:   { status: "ok" | "error", latencyMs: number },
  queue:   { status: "ok" | "error", workerCount: number },
  storage: { status: "ok" | "error", writeable: boolean },
  email:   { status: "configured" | "unconfigured" | "error" },
  overall: "healthy" | "degraded" | "critical"
}
```

`GET /api/health` (public, no auth) returns only `{ status: "ok" }` for load balancer checks.

---

## 18. ACP Navigation Structure

> **⚠ This section is superseded by §42 (ACP Navigation Structure — Updated).** Refer to §42 for the current complete ACP nav. This section is retained only as a historical reference of the initial design.

---

## 19. UI Design System

### Color Tokens

**Dark theme:**
| Token | Value |
|---|---|
| bg | `#080812` |
| bgSurface | `#0f0f1e` |
| bgCard | `#13132a` |
| accent | `#7c6af7` |
| accent2 | `#a78bfa` |
| success | `#34d399` |
| warn | `#fbbf24` |
| danger | `#f87171` |
| textPri | `#eeeef8` |
| textSec | `#8080b0` |
| textMuted | `#50507a` |

**Light theme:**
| Token | Value |
|---|---|
| bg | `#f4f4fb` |
| bgSurface | `#ffffff` |
| bgCard | `#ffffff` |
| accent | `#6355e8` |
| accent2 | `#8b7cf7` |
| success | `#10b981` |
| warn | `#f59e0b` |
| danger | `#ef4444` |
| textPri | `#0d0d22` |
| textSec | `#4a4a7a` |
| textMuted | `#8888aa` |

### Typography
- Default font: **DM Sans**
- Border radius: `14px` (cards), `8px` (inputs/buttons), `20px` (large cards)

### Design Direction
Dark Tech + Soft Modern blend — dark backgrounds, purple/violet accents, rounded corners, soft glow effects.

---

## 20. Public Pages (v1)

| Page | Notes |
|---|---|
| Home | Logged-in welcome card + article feed. Logged-out hero + CTA. |
| Articles List | Grid/list toggle. Category filter tabs. |
| Article Reader | Full content, like/share, author card, comments section. |
| User Profile | Tabs: Articles, Forum Posts, Followers, Following, About. Persistent Comments wall below tab bar. Information section (custom profile fields). Stats: posts, articles, followers, following. |
| Search Results | Tabbed: All, Articles, Forum, Users. |
| Login | Dropdown from nav — not a separate page. |
| Register | Full page with terms checkbox. |
| Forgot Password | Email entry + sent confirmation state. |
| Account Settings | Tabs: Profile, Security, Notifications, Preferences, Privacy. |
| Article Editor | TipTap WYSIWYG + publishing sidebar (status, category, tags, visibility, SEO preview). |
| Install Wizard | 7 steps. Shown pre-install only. Files removed post-install. |
| Forum Categories | Stats bar + category/subforum cards with live status. |
| Forum Subforum | Thread list with badges (pinned, solved, hot) + filters. |
| Forum Thread | Posts with rich author sidebar, solution highlight, mod tools, reply box with mini toolbar. |

---

## 21. Forum Thread Post Design

### Author Sidebar (per post)
- Avatar
- Username
- Role badge
- Threads count
- Posts count
- Likes received count
- Join date

### Post Actions
- Like button (toggleable, live count)
- Reply
- Quote
- ✏️ Edit (own posts only — inline edit box with save/cancel)
- Edited timestamp shown if post was modified

### Moderator Quick Actions (mod+ only)
- ⚠️ Warn — opens reason modal, logs to moderation system
- 🗑️ Delete — requires reason. Post is **deactivated, not deleted**. Displays tombstone:
  > *Post by [USER] was deleted by [MOD] · [TIMESTAMP] · Reason: [REASON]*
  > (red-highlighted border)

### Reply Box
- Mini WYSIWYG toolbar: Bold, Italic, Underline, Lists, Quote, Code, Link, Image
- Textarea with preview option
- Post Reply button

---

## 22. Account Settings → Preferences

- **Theme** — Light / Dark / System card selector
- **Font** — 6 options rendered in their actual typeface (DM Sans, Inter, Poppins, Playfair Display, Nunito, Syne)
- **Other toggles** — Reduce motion, Compact view, Auto-play media

---

## 23. Official Plugin Roadmap

| Plugin | Status | License required |
|---|---|---|
| nodevo-forum | v1 target — first official plugin | Yes |
| nodevo-messaging | Post v1 | Yes |
| nodevo-subscriptions | Post v1 — premium group paywall, Stripe integration, `/upgrade` page, subscription management. Foundation (schema, `PaymentProvider` interface, ACP stub) already in core (§52). | Yes |
| nodevo-oauth | Post v1 — social login: Google, GitHub, Discord. Each provider individually enabled/disabled and configured (client ID + client secret) from ACP → System → Settings → Social Login (registered by the plugin). Admins can turn Google on, leave GitHub off, etc. Adds provider buttons to the login and registration forms. Links external OAuth accounts to existing Nodevo accounts. | Yes |
| nodevo-2fa | Post v1 — TOTP two-factor authentication (Google Authenticator, Authy). Priority for admin accounts. Recovery codes. ACP can require 2FA for staff groups. | Yes |
| nodevo-seo-tools | Post v1 | Yes |
| nodevo-analytics | Post v1 | Yes |
| nodevo-advanced-moderation | Post v1 — consumes `security_events` and `moderation_cases` foundation from core (§15). Multi-account scoring, automated case escalation, IP reputation integration. | Yes |

**Note:** `nodevo-notifications` is **not** a plugin — notifications are core (§29). Every core module dispatches through the `NotificationService`. Plugins dispatch via `plugin-sdk`.

---

## 24. Style Ecosystem Architecture

The style system is built in three layers. v1 builds layer 1 fully and stubs layers 2 and 3 so future work slots in without a rewrite.

### The Three Layers

```
Layer 1 — Tokens         ← v1 builds fully
  Colors, spacing, typography values as CSS custom properties
  Controlled by Style Editor + .nvstyle packs

Layer 2 — Components     ← v2 builds, v1 stubs
  Per-component visual overrides (buttons, cards, inputs)
  Controlled by .nvtheme component entries

Layer 3 — Templates      ← v3 builds, v1 stubs
  Page structure, layout shapes, header/footer/sidebar
  Controlled by .nvtheme layout slot entries
```

### Token Architecture (Three-Tier)

```css
/* ── PRIMITIVE TOKENS — never used directly in components ── */
--primitive-purple-500: #7c6af7;
--primitive-purple-400: #a78bfa;
--primitive-green-400:  #34d399;
--primitive-red-400:    #f87171;
--primitive-gray-950:   #080812;
--primitive-gray-900:   #0f0f1e;
--primitive-gray-800:   #13132a;

/* ── SEMANTIC TOKENS — what Style Editor controls ── */
--color-accent:       var(--primitive-purple-500);
--color-accent-soft:  rgba(124, 106, 247, 0.12);
--color-accent-glow:  rgba(124, 106, 247, 0.25);
--color-accent2:      var(--primitive-purple-400);
--color-bg:           var(--primitive-gray-950);
--color-surface:      var(--primitive-gray-900);
--color-card:         var(--primitive-gray-800);
--color-success:      var(--primitive-green-400);
--color-warn:         #fbbf24;
--color-danger:       var(--primitive-red-400);
--color-info:         #38bdf8;
--color-text-primary: #eeeef8;
--color-text-sec:     #8080b0;
--color-text-muted:   #50507a;
--color-border:       #1e1e3a;
--color-border-hi:    #2e2e55;

/* ── COMPONENT TOKENS — what .nvtheme layer 2 overrides ── */
--btn-primary-bg:      var(--color-accent);
--btn-primary-radius:  8px;
--btn-primary-weight:  700;
--btn-ghost-border:    var(--color-border);
--card-bg:             var(--color-card);
--card-radius:         14px;
--card-border:         var(--color-border);
--input-bg:            var(--color-surface);
--input-border:        var(--color-border);
--input-radius:        8px;
--nav-height:          62px;
--acp-sidebar-width:   230px;
--radius-sm:           8px;
--radius-md:           14px;
--radius-lg:           20px;
```

v1 Style Editor touches **semantic tokens** only.
v2 themes override **component tokens** without changing semantic meaning.
No component in the codebase ever uses a raw colour value — always a CSS variable.

### The One Hard Rule

**Nothing in the codebase hardcodes a visual value.**
No `color: #7c6af7`. No `background: #13132a`. Every visual decision is a CSS variable reference or a token from `useTheme()`. This is the single rule that makes v2 themes possible without a rewrite. Violations are treated as bugs.

### ThemeManifest Type (packages/contracts)

Defined in v1 even though only `defaultTheme` is ever registered:

```typescript
// packages/contracts/src/theme.types.ts

export type ThemeType = "style-pack" | "theme";

export interface ThemeManifest {
  id:       string;
  name:     string;
  version:  string;
  vendor:   string;
  type:     ThemeType;
  supports: {
    components: boolean;   // layer 2 — .nvtheme only
    layouts:    boolean;   // layer 3 — .nvtheme only
  };
  tokens?: {
    light: string;         // relative path to light CSS override file
    dark:  string;         // relative path to dark CSS override file
  };
  // v2 only — ignored in v1
  components?: Record<string, string>;  // slot name → component file path
  // v3 only — ignored in v1
  layouts?: Record<string, string>;     // slot name → layout file path
  fonts?: string;          // relative path to font manifest JSON
}
```

### ThemeRegistry

> **v1 note:** there is no `core/style-engine/` directory. The `ThemeRegistry` concept
> below is design intent; in v1, appearance/token handling lives in `modules/appearance/`.

```typescript
// (design intent) theme-registry.ts

class ThemeRegistry {
  private active: ThemeManifest = defaultTheme;
  private installed: Map<string, ThemeManifest> = new Map();

  /** Always returns the active theme. v1: always defaultTheme. */
  getActive(): ThemeManifest {
    return this.active;
  }

  /** Register a loaded theme manifest. */
  register(manifest: ThemeManifest): void {
    this.installed.set(manifest.id, manifest);
  }

  /** Activate a registered theme by id. */
  activate(id: string): void {
    const theme = this.installed.get(id);
    if (!theme) throw new NodevoError("NEC-CORE-8001", "Theme not found");
    this.active = theme;
    // v1: this path is never reached except during bootstrap with defaultTheme
    // v2: triggers CSS recompile + component slot hydration
    // v3: triggers layout slot hydration
  }

  getInstalled(): ThemeManifest[] {
    return Array.from(this.installed.values());
  }
}

export const themeRegistry = new ThemeRegistry();
```

### Layout Slots (apps/web)

```tsx
// layouts/AppLayout.tsx

// v1: slot values are hardcoded to default components
// v2: slot values come from the active theme manifest

const LAYOUT_SLOTS = {
  header:  DefaultHeader,
  footer:  DefaultFooter,
  sidebar: null,          // default theme has no sidebar
} as const;

export function AppLayout({ children }: { children: ReactNode }) {
  const Header  = LAYOUT_SLOTS.header;
  const Footer  = LAYOUT_SLOTS.footer;

  return (
    <div className="app-layout">
      {Header && <Header />}
      <main className="app-content">{children}</main>
      {Footer && <Footer />}
    </div>
  );
}

// v2 TODO: make LAYOUT_SLOTS dynamic from themeRegistry.getActive().layouts
```

### useTheme Hook (apps/web)

```typescript
// hooks/useTheme.ts

// v1 Phase 1: always follows OS preference (user pref not yet available)
// v1 Phase 4: reads user's saved preference from account settings
// v2: returns whatever the active theme provides

export function useTheme() {
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");
  // userPref comes from account settings (Phase 4). Before Phase 4: always 'system'
  const userPref    = useUserPreference("theme") ?? "system"; // "light" | "dark" | "system"

  const isDark =
    userPref === "dark" ||
    (userPref === "system" && prefersDark);

  return {
    manifest: themeRegistry.getActive(),
    isDark,
  };
}
```

All components that need theme context use this hook. Nothing reaches into CSS files directly.

### .nvstyle vs .nvtheme Package Format

Both formats share the same `manifest.json` structure. The engine gains capabilities in v2/v3 without changing the format.

```
.nvstyle (v1 — token overrides only):
  manifest.json   { "type": "style-pack", "supports": { "components": false, "layouts": false } }
  styles/
    light.css     :root { --color-accent: #0ea5e9; }
    dark.css      :root { --color-accent: #38bdf8; }
  preview/
    thumbnail.png

.nvtheme (v2 — adds component overrides):
  manifest.json   { "type": "theme", "supports": { "components": true, "layouts": false } }
  styles/
    light.css
    dark.css
  components/
    Button.tsx
    Card.tsx
    Input.tsx
  preview/
    thumbnail.png

.nvtheme (v3 — adds layout overrides):
  manifest.json   { "type": "theme", "supports": { "components": true, "layouts": true } }
  styles/ ...
  components/ ...
  layouts/
    Header.tsx
    Footer.tsx
    AcpSidebar.tsx
  preview/
    thumbnail.png
```

The style engine's `loadTheme()` function reads the manifest and activates what it supports. Unknown keys are ignored safely.

### Font Registry

> **v1 status: NOT built as specified.** There is no `themes/default/fonts/manifest.json` and
> no server-side font loader. v1 loads fonts client-side through npm `@fontsource/*` imports in
> `apps/web/src/main.tsx`, with the selectable registry in `apps/web/src/styles/fonts.ts`
> (6 families, default Raleway). The manifest shape below remains the **v2 target** for
> theme-packaged fonts — keep it for when `.nvtheme` packs land.

```json
// v2 target — themes/default/fonts/manifest.json (not present in v1)
{
  "version": "1.0",
  "fonts": [
    { "family": "DM Sans",          "category": "sans-serif", "isDefault": true,  "weights": [300,400,500,600,700,800], "bundled": true, "path": "./DM_Sans" },
    { "family": "Inter",             "category": "sans-serif", "isDefault": false, "weights": [300,400,500,600,700,800], "bundled": true, "path": "./Inter" },
    { "family": "Poppins",           "category": "sans-serif", "isDefault": false, "weights": [300,400,500,600,700],     "bundled": true, "path": "./Poppins" },
    { "family": "Nunito",            "category": "sans-serif", "isDefault": false, "weights": [300,400,500,600,700,800], "bundled": true, "path": "./Nunito" },
    { "family": "Open Sans",         "category": "sans-serif", "isDefault": false, "weights": [300,400,500,600,700,800], "bundled": true, "path": "./Open_Sans" },
    { "family": "Roboto",            "category": "sans-serif", "isDefault": false, "weights": [300,400,500,700],         "bundled": true, "path": "./Roboto" },
    { "family": "Playfair Display",  "category": "serif",      "isDefault": false, "weights": [400,500,600,700,800],     "bundled": true, "path": "./Playfair_Display" },
    { "family": "Merriweather",      "category": "serif",      "isDefault": false, "weights": [300,400,700],             "bundled": true, "path": "./Merriweather" },
    { "family": "Lora",              "category": "serif",      "isDefault": false, "weights": [400,500,600,700],         "bundled": true, "path": "./Lora" },
    { "family": "JetBrains Mono",    "category": "monospace",  "isDefault": false, "weights": [400,500,700],             "bundled": true, "path": "./JetBrains_Mono" },
    { "family": "Source Code Pro",   "category": "monospace",  "isDefault": false, "weights": [400,500,700],             "bundled": true, "path": "./Source_Code_Pro" },
    { "family": "Syne",              "category": "display",    "isDefault": false, "weights": [400,500,600,700,800],     "bundled": true, "path": "./Syne" },
    { "family": "Raleway",           "category": "display",    "isDefault": false, "weights": [300,400,500,600,700,800], "bundled": true, "path": "./Raleway" }
  ]
}
```

v2 themes can ship their own fonts in the package using the same manifest shape. The font loader reads from the active theme's font manifest, falling back to the default.

### What to Build vs Stub in v1

| Item | v1 Action |
|---|---|
| `tokens.css` with all three tiers | Build fully |
| `ThemeManifest` type in `contracts/` | Build fully |
| `ThemeRegistry` class | Build — register + getActive + stub activate |
| `useTheme()` hook | Build — returns default always in v1 |
| `AppLayout` with named slot constants | Build — hardcoded to defaults |
| `.nvstyle` upload, validation, activation | Build fully |
| Style Editor (semantic token layer) | Build fully |
| Style history (last N saves + restore) | Build fully |
| Font registry manifest | Dropped — v1 uses `apps/web/src/styles/fonts.ts` + `@fontsource/*` instead (deferred to v2) |
| Font loader from manifest | Dropped — fonts imported client-side in `main.tsx` (deferred to v2) |
| Component token CSS variables | Define fully, unused by editor in v1 |
| `.nvtheme` component slot loading | TODO comment in style engine |
| Layout slot switching from theme | TODO comment in AppLayout |
| Theme marketplace | Not in v1 |

---

## 25. Email Layer

### Why It Must Be Defined in v1

Password reset requires email in v1. Deferring the email module means password reset stays a placeholder, which is a security gap. The email abstraction also gates future notifications (when the official plugin ships) without requiring a rewrite.

### Module Location

```
apps/api/src/infrastructure/email/
  email.service.ts       Primary email service (Nodemailer wrapper)
  email.templates.ts     Template registry
  templates/
    password-reset.html
    email-verify.html
    welcome.html
  email.types.ts
```

### Design

```typescript
// infrastructure/email/email.service.ts

interface SendEmailOptions {
  to:       string;
  template: EmailTemplate;
  data:     Record<string, string>;
}

class EmailService {
  async send(options: SendEmailOptions): Promise<void>;
  async sendRaw(to: string, subject: string, html: string): Promise<void>;
  isConfigured(): boolean;   // returns false if SMTP not set — callers handle gracefully
}
```

- Wraps Nodemailer
- SMTP credentials from env/settings (not hardcoded)
- Template system: simple HTML strings with `{{variable}}` substitution in v1
- `isConfigured()` check so all callers degrade gracefully if SMTP is absent
- All email sending goes through BullMQ queue — never blocks a request

### v1 Templates
- `password-reset` — reset link, expires 15 minutes
- `email-verify` — verification link, expires 24 hours
- `welcome` — sent on registration if email verify is disabled

---

## 26. Rate Limiting Map

All limits defined as named constants in `config/rate-limits.ts`, not scattered ad-hoc.

### Explicit Limits

| Endpoint group | Window | Max requests | Notes |
|---|---|---|---|
| `POST /api/auth/login` | 15 min | 10 | Per IP |
| `POST /api/auth/refresh` | 1 min | 20 | Per IP — prevents token refresh abuse |
| `POST /api/auth/register` | 1 hour | 5 | Per IP |
| `POST /api/auth/password-reset` | 1 hour | 3 | Per IP |
| `POST /api/auth/verify-email` | 1 hour | 5 | Per IP |
| `POST /api/users/:id/follow` | 1 min | 30 | Per authenticated **user ID** (not IP — shared networks should not throttle each other) |
| `POST /api/users/:id/profile-comments` | 5 min | 10 | Per authenticated **user ID** |
| `POST /api/users/:id/block` | 1 hour | 50 | Per authenticated **user ID** |
| `POST /api/plugins/upload` | 1 hour | 20 | Per authenticated user ID |
| `POST /api/licenses/activate` | 1 hour | 5 | Per IP |
| `POST /api/install/*` | 1 hour | 30 | Per IP, installer only |
| `GET /api/*` (general) | 1 min | 200 | Per IP, authenticated |
| `GET /api/*` (general) | 1 min | 60 | Per IP, unauthenticated |

> **v1 reality:** the global limiter (`shared/middleware/rateLimit.ts`,
> `globalApiLimiter`) is prod-only and exempts `/api/install`, `/api/health`,
> `/api/meta`, plus `/api/appearance/version` and `/api/appearance/css` — the
> live-style-sync poll (every 2–60s per client, unauthenticated — see §13 note)
> would otherwise burn 12–30 of the 60/min unauth budget per tab and 429 whole
> NATs. Per-route limiters still apply on top of the global one.

### Implementation

```typescript
// config/rate-limits.ts

export const RATE_LIMITS = {
  AUTH_LOGIN:        { windowMs: 15 * 60 * 1000, max: 10 },
  AUTH_REGISTER:     { windowMs: 60 * 60 * 1000, max: 5  },
  AUTH_RESET:        { windowMs: 60 * 60 * 1000, max: 3  },
  AUTH_VERIFY:       { windowMs: 60 * 60 * 1000, max: 5  },
  PLUGIN_UPLOAD:     { windowMs: 60 * 60 * 1000, max: 20 },
  LICENSE_ACTIVATE:  { windowMs: 60 * 60 * 1000, max: 5  },
  INSTALL:           { windowMs: 60 * 60 * 1000, max: 30 },
  API_AUTH:          { windowMs: 60 * 1000,       max: 200 },
  API_UNAUTH:        { windowMs: 60 * 1000,       max: 60  },
} as const;
```

Rate limit responses use `NEC-API-4290` (rate limit exceeded) with `Retry-After` header.

---

## 27. Permission Cache

### The Problem

Every authenticated request triggers RBAC checks. Without caching, each check hits the DB to resolve: user → groups → group permissions → effective permission set. On a page that makes 5+ API calls, this becomes 5+ sets of DB queries for the same data.

### Strategy

Cache effective permission sets in Redis. Key: `perm:user:{userId}`. Value: serialised array of granted permission keys. TTL: 5 minutes.

### Invalidation Triggers

The cache for a user must be purged when:
- Their group membership changes
- Any of their groups' permissions change
- They are banned or their role changes

Invalidation is done by deleting the Redis key. The next request recomputes from DB and re-caches.

### Implementation

```typescript
// modules/permissions/permission.cache.ts

const CACHE_TTL_SECONDS = 300; // 5 minutes

class PermissionCache {
  async getEffective(userId: string): Promise<string[] | null> {
    const cached = await redis.get(rkey(`perm:user:${userId}`));
    return cached ? JSON.parse(cached) : null;
  }

  async setEffective(userId: string, perms: string[]): Promise<void> {
    await redis.setex(rkey(`perm:user:${userId}`), CACHE_TTL_SECONDS, JSON.stringify(perms));
  }

  async invalidate(userId: string): Promise<void> {
    await redis.del(rkey(`perm:user:${userId}`));
  }

  async invalidateGroup(groupId: string): Promise<void> {
    // Get all users in the group, invalidate each
    // Done via BullMQ job to avoid blocking the request that triggered the change
  }
}
```

The permission service checks cache first, falls back to DB on miss, and writes back to cache. All group/permission mutation endpoints enqueue an invalidation job.

---

## 28. Plugin Migration Tracking

### The Problem

Prisma manages core migrations in one sequence. Plugins also run migrations. If plugin migrations are tracked in the same `_prisma_migrations` table, a plugin update can conflict with a core update, and uninstalling a plugin becomes unclear (which migrations to reverse?).

### Strategy

Plugin migrations are tracked in a **separate Nodevo-owned table**, not Prisma's internal table.

```sql
-- Core schema
CREATE TABLE nodevo_plugin_migrations (
  id          TEXT PRIMARY KEY,        -- "{pluginId}_{version}_{name}"
  plugin_id   TEXT NOT NULL,
  plugin_ver  TEXT NOT NULL,
  name        TEXT NOT NULL,
  applied_at  TIMESTAMPTZ DEFAULT NOW(),
  checksum    TEXT NOT NULL,           -- SHA256 of migration SQL
  direction   TEXT NOT NULL            -- 'up' | 'down'
);
```

### Rules

- Core migrations run via Prisma, tracked by `_prisma_migrations`
- Plugin migrations are raw SQL files, run by the plugin engine, tracked by `nodevo_plugin_migrations`
- Plugin migrations always run inside a transaction
- `down` migrations are required for every `up` — enforced at package validation time
- On plugin uninstall, all `up` migrations for that plugin are reversed in order
- On plugin update, `down` migrations for the previous version run first, then `up` for the new version
- Checksum validates that a previously applied migration file has not been modified

### Plugin Migration File Format

```
plugins/official/nodevo-forum/migrations/
  001_create_categories.up.sql
  001_create_categories.down.sql
  002_create_threads.up.sql
  002_create_threads.down.sql
```

The plugin engine validates that every `.up.sql` has a matching `.down.sql` before allowing install. This check happens at package validation time (step 3 of the plugin lifecycle), so a plugin with missing down migrations is rejected before anything touches the database.

---

## 29. Notifications (Core)

### Why Core, Not Plugin

Every core module needs to send notifications. Moderation warns users. The license engine alerts admins on expiry. Auth notifies on suspicious login. If notifications are a plugin, core modules can't use them without the plugin being loaded first — a fragile circular dependency.

### Architecture

```
modules/notifications/
  notification.service.ts     Internal dispatch API used by all modules
  notification.repository.ts  DB reads/writes
  notification.routes.ts      REST endpoints for frontend (mark read, list, prefs)
  notification.types.ts
```

### Core Service API

```typescript
// modules/notifications/notification.service.ts

interface DispatchOptions {
  userId:   string;
  type:     string;          // e.g. "moderation.warning", "auth.suspicious_login"
  title:    string;
  body:     string;
  link?:    string;          // relative URL to navigate to on click
  meta?:    Record<string, unknown>;
  channels: ("in_app" | "email")[];
}

class NotificationService {
  async dispatch(opts: DispatchOptions): Promise<void>;
  async markRead(notificationId: string, userId: string): Promise<void>;
  async markAllRead(userId: string): Promise<void>;
  async listForUser(userId: string, opts: PaginatedRequest): Promise<PaginatedResponse<Notification>>;
}
```

### Plugin Usage via plugin-sdk

```typescript
// plugins can dispatch through the same service
plugin.notify({
  userId: targetUserId,
  type:   "forum.thread_reply",
  title:  "New reply in your thread",
  body:   `${authorName} replied to "${threadTitle}"`,
  link:   `/forum/thread/${threadId}`,
  channels: ["in_app", "email"],
});
```

### DB Tables

```
notifications
  id, user_id, type, title, body, link, meta (JSON),
  read_at (null = unread), created_at

notification_preferences
  id, user_id, type_pattern,        -- e.g. "forum.*", "moderation.*", "*"
  in_app_enabled, email_enabled
```

### v1 Notification Types (Core)

| Type | Trigger |
|---|---|
| `auth.suspicious_login` | Security event: login from new IP/device |
| `auth.password_changed` | Password successfully changed |
| `moderation.warning_issued` | User received a warning |
| `moderation.ban_issued` | User was banned |
| `moderation.warning_pardoned` | A warning was pardoned |
| `moderation.ban_lifted` | A ban was lifted |
| `social.new_follower` | Someone followed you |
| `progression.promoted` | User promoted to next progression level |
| `profile.comment_posted` | Someone posted on your profile wall |
| `mod.new_report` | User submits a report — sent to all users with `moderation.report.manage` permission |
| `mod.new_case` | Security analysis creates a new review case — sent to `moderation.cases.manage` |
| `license.expiring_soon` | License expires within 30 days (admin only) |
| `license.expired` | License has expired (admin only) |
| `system.plugin_update` | A plugin update is available (admin only) |

Forum plugin adds its own types (`forum.thread_reply`, `forum.mention`, etc.) via `plugin.registerNotificationTypes()`.

**Note:** notification types added by later sections (social, progression, profile) are also defined in §36, §38, and §40 respectively alongside their owning features. This table is the consolidated master list.

---

## 30. Search

### Approach

PostgreSQL full-text search via `tsvector` + `tsquery`. No external service in v1. Good enough for a platform at launch, and the `StorageProvider` pattern means Elasticsearch or Typesense can be bolted in later behind the same interface if needed.

### Search Vector Maintenance

Each searchable entity maintains a `search_vector tsvector` column, updated via a Postgres trigger on insert/update.

```sql
-- articles table
ALTER TABLE articles ADD COLUMN search_vector tsvector;

CREATE INDEX articles_search_idx ON articles USING GIN(search_vector);

CREATE TRIGGER articles_search_vector_update
BEFORE INSERT OR UPDATE ON articles
FOR EACH ROW EXECUTE FUNCTION
  tsvector_update_trigger(search_vector, 'pg_catalog.english', 'title', 'body', 'excerpt');
```

### Plugin-Extensible Content Registry

Plugins register additional searchable content types at enable time:

```typescript
// plugin-sdk
plugin.registerSearchableContent({
  type:        "forum_thread",
  table:       "forum_threads",
  vectorCol:   "search_vector",
  labelCol:    "title",
  linkPattern: "/forum/thread/{id}",
  permission:  null,           // null = public. Or a permission key to gate results.
});
```

The search module queries all registered types and merges results, respecting permissions per type.

### API

```
GET /api/search?q={query}&type={all|articles|users}&page=1&limit=20
```

Forum plugin adds `threads` and `posts` to the available types. Response uses the standard `PaginatedResponse<SearchResult>` contract.

---

## 31. Storage Abstraction

### Interface

```typescript
// infrastructure/storage/storage.provider.ts

export interface StorageProvider {
  save(
    file:     Buffer,
    path:     string,     // relative path e.g. "avatars/user_123.jpg"
    mimeType: string
  ): Promise<string>;     // returns public URL

  delete(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  url(path: string): string;  // get URL for a stored path without re-saving
}
```

### v1 Implementation

```typescript
// infrastructure/storage/local.provider.ts

class LocalStorageProvider implements StorageProvider {
  private basePath = process.env.STORAGE_PATH ?? "./storage";
  private baseUrl  = process.env.APP_URL + "/uploads";

  async save(file: Buffer, path: string, mimeType: string): Promise<string> {
    await fs.writeFile(join(this.basePath, path), file);
    return this.url(path);
  }

  url(path: string): string {
    return `${this.baseUrl}/${path}`;
  }
  // ...
}
```

### Storage Service

```typescript
// infrastructure/storage/storage.service.ts

// All upload code calls this, never the provider directly
class StorageService {
  constructor(private provider: StorageProvider) {}

  async saveAvatar(userId: string, file: Buffer, mimeType: string): Promise<string>;
  async saveFeaturedImage(articleId: string, file: Buffer, mimeType: string): Promise<string>;
  async savePluginPackage(filename: string, file: Buffer): Promise<string>;
  async saveStylePack(filename: string, file: Buffer): Promise<string>;
}
```

Swapping in S3 in v2 means replacing `LocalStorageProvider` with `S3StorageProvider` and changing one line in the DI setup. No upload logic changes.

### Storage Path Conventions

```
avatars/{userId}.{ext}
articles/{articleId}/featured.{ext}
plugins/{pluginId}/{version}.nvplugin
themes/packs/{packId}.nvstyle
themes/active/light.css
themes/active/dark.css
temp/extract/{jobId}/         ← plugin extraction staging area, cleaned after install
```

---

## 32. Shared Utilities

### Slug Generator

```typescript
// shared/helpers/slug.ts

async function generateSlug(
  base:        string,
  checkExists: (slug: string) => Promise<boolean>
): Promise<string> {
  const raw  = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  let   slug = raw;
  let   n    = 2;

  while (await checkExists(slug)) {
    slug = `${raw}-${n++}`;
  }

  return slug;
}

// Usage in article service:
const slug = await generateSlug(title, (s) => articleRepo.slugExists(s));
```

Used by: articles, forum categories, forum threads (via forum plugin). `slugify` + `uniqueSlug` live in **`@nodevo/sdk`** (`packages/sdk/src/slug.ts`); core and plugins both import them from there.

### Pagination Contract

```typescript
// packages/contracts/src/pagination.types.ts

export interface PaginatedRequest {
  page:   number;          // 1-based, default 1
  limit:  number;          // default 20, max 100
  sort?:  string;          // field name
  order?: "asc" | "desc"; // default "desc"
}

export interface PaginationMeta {
  page:       number;
  limit:      number;
  total:      number;
  totalPages: number;
  hasNext:    boolean;
  hasPrev:    boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}
```

Every list endpoint in core and in plugins uses this contract. The SDK provides a `usePaginated()` TanStack Query hook that handles the meta automatically.

### Soft Delete Convention

Consistent across all content entities:

```typescript
// Soft-deletable: articles, users (deactivation), article comments, forum posts (tombstone)
deletedAt: DateTime? @map("deleted_at")

// Hard-deletable by schedule (not by user action): sessions, temp files, old notifications
// — no deletedAt column, removed by BullMQ cleanup jobs
```

All repository `findMany` calls include `where: { deletedAt: null }` by default. A `withDeleted: true` option is available for admin/moderation queries.

---

## 33. Article Comments

Owned by core. Simple and standalone — no dependency on the forum plugin.

### Data Model

```
article_comments
  id, article_id, author_id,
  parent_id (null = top-level, set = reply to comment),
  body (text),
  deleted_at (null = active, set = soft-deleted with tombstone),
  deleted_by_id, deleted_reason,
  edited_at,
  created_at, updated_at

article_comment_likes
  id, comment_id, user_id, created_at
```

### Rules

- Threaded to one level (top-level + replies, no deeper nesting)
- Author can edit their own comment (edited_at recorded)
- Moderators soft-delete with required reason — tombstone shown in thread
- Tombstone format mirrors forum post deletion: *"Comment by [user] was deleted by [mod] · [timestamp] · Reason: [reason]"*
- Comment count on articles excludes soft-deleted entries

### Permission Keys

```
article.comment.create
article.comment.edit.own
article.comment.delete.any    ← moderator
```

### Default Group Assignments

| Group | `article.create` | `article.publish` | `article.comment.create` |
|---|---|---|---|
| Administrator | ✓ | ✓ | ✓ |
| Supermod | ✓ | ✓ | ✓ |
| Moderator | ✓ | — | ✓ |
| Member | — | — | ✓ |
| Guest | — | — | — |

Articles are editorial content. Members can comment but cannot create articles. Moderators can draft but cannot publish without admin review. Configured in ACP → Access Control → Permissions.

---

## 34. Migration Tooling

### Philosophy

Migration tooling is not a plugin. A plugin is a runtime extension that lives inside the Nodevo process permanently. Migration is a one-time operation that should cease to exist in the production environment once it completes.

Making migration a plugin would mean:
- Legacy platform dependencies (MySQL adapters, XML parsers, old schema handlers) living in the production bundle indefinitely
- Source database credentials flowing through a web-facing process
- The plugin lifecycle (install → enable → disable) mapped onto something that has no concept of "ongoing"
- Dead code sitting in the ACP after the migration is long done

Migration tooling is a **standalone CLI package ecosystem** — installed on a server or developer machine, run once, then uninstalled. The running Nodevo instance is never modified except through its own API or direct DB writes.

Migration tooling is **free and open source**. It is a growth mechanism, not a revenue mechanism. The easier it is to move an existing community into Nodevo, the more installs Nodevo gets. Charging for it creates friction at the exact moment a potential user is most motivated to switch.

---

### Package Structure

```
@nodevo/migrate               Root CLI entry point
  @nodevo/migrate-core        Shared utilities — all adapters depend on this
  @nodevo/migrate-wp          WordPress adapter         (Wave 1)
  @nodevo/migrate-xenforo     XenForo adapter           (Wave 1)
  @nodevo/migrate-phpbb       phpBB adapter             (Wave 1)
  @nodevo/migrate-vbulletin   vBulletin adapter         (Wave 2)
  @nodevo/migrate-woltlab     WoltLab Suite adapter     (Wave 2)
```

Each adapter is installed independently. A WordPress migration does not pull in the XenForo parser. After migration completes, both packages are uninstalled from the machine. The Nodevo instance retains only the migration log.

---

### Official Adapter Roadmap

| Adapter | Wave | Distribution | Complexity | Notes |
|---|---|---|---|---|
| `migrate-wp` | 1 | Official, free | Low | WXR XML export files. No direct DB needed. CMS use case. |
| `migrate-xenforo` | 1 | Official, free | Medium | Dominant active forum platform. Well-documented schema. |
| `migrate-phpbb` | 1 | Official, free | Medium | Largest legacy free forum base. Simple schema, lots of prior art. |
| `migrate-vbulletin` | 2 | Official, free | High | Three schema versions (3.x, 4.x, 5.x). Auto-detected. Many communities actively escaping vB5. |
| `migrate-woltlab` | 2 | Official, free | High | Rich permission inheritance. Lossy RBAC mapping. European/German user base. |

**Wave 1** ships alongside or shortly after Nodevo v1 launch.
**Wave 2** ships in the months following, once Wave 1 adapters are stable.

---

### Community Adapter API

`@nodevo/migrate-core` exports the full adapter contract. Anyone can build a community adapter using the same foundation and publish it to npm with the `nodevo-migrate-` prefix convention.

```typescript
// @nodevo/migrate-core public API

export interface MigrateAdapter {
  name:    string;
  version: string;

  /** Check source platform version, available tables, etc. */
  inspect(source: SourceConnection): Promise<MigrationInspection>;

  /** Perform the full migration. Called after user confirms. */
  run(
    source:   SourceConnection,
    target:   TargetConnection,
    options:  MigrateOptions,
    reporter: MigrationReporter  // progress, warnings, errors
  ): Promise<MigrationResult>;
}

export interface MigrationInspection {
  platform:       string;   // e.g. "XenForo 2.2.14"
  counts: {
    users?:       number;
    threads?:     number;
    posts?:       number;
    categories?:  number;
    attachments?: number;
    [key: string]: number | undefined;
  };
  warnings: string[];       // e.g. "Permission mapping will be lossy"
  preconditions: {
    met:     string[];      // e.g. "Forum plugin installed"
    missing: string[];      // blocks run if non-empty
  };
}
```

Community adapters for platforms like MyBB, Discourse, Invision Community, SMF, and Flarum can be built and published without any changes to the official packages. npm search for `nodevo-migrate-` is the discovery mechanism — no formal registry needed in v1.

---

### Precondition Checking

Forum platform adapters check that the Forum plugin is installed and enabled before touching any data:

```
$ npx @nodevo/migrate xenforo \
    --source-db="mysql://user:pass@host/xenforo_db" \
    --nodevo-api="https://mysite.com" \
    --nodevo-key="admin-api-key"

Checking preconditions...
  ✓  Nodevo reachable (v1.0.0)
  ✓  Forum plugin installed and enabled (v1.2.0)
  ✓  Source DB connected (XenForo 2.2.14)

Ready to migrate:
  → 1,284 users
  → 47 categories / subforums
  → 8,904 threads
  → 44,320 posts
  → 23,410 attachments

Warnings:
  ! XenForo permission inheritance cannot be fully represented in Nodevo RBAC.
    Moderator-level users will be mapped to the Moderator group.
    Custom permission overrides will not be migrated.
    A detailed permission mapping report will be written on completion.

Proceed? [y/N]
```

If a precondition is not met the CLI exits cleanly before touching any data.

---

### Per-Platform Details

**WordPress (`migrate-wp`)**
- Source: WXR XML export file (no DB access required)
- Maps: Posts → Articles, Pages → Articles (flagged), Users → Users, Comments → Article comments, Categories/Tags → Article categories/tags, Featured images → StorageProvider
- Lossy: WordPress user roles mapped to closest Nodevo group (admin → Administrator, editor → Editor, subscriber → Member)
- No Forum plugin dependency

**XenForo (`migrate-xenforo`)**
- Source: Direct MySQL connection to XenForo DB
- Maps: Threads → Forum threads, Posts → Forum posts, Users → Users, Node tree → Forum categories/subforums, User groups → best-effort RBAC group mapping, Attachments → StorageProvider
- Lossy: XenForo's per-node permission overrides cannot be represented in flat RBAC — migration report documents what was dropped
- Requires: Forum plugin installed and enabled

**phpBB (`migrate-phpbb`)**
- Source: Direct DB connection (MySQL or PostgreSQL)
- Maps: Topics → Forum threads, Posts → Forum posts, Users → Users, Forums/Categories → Forum categories/subforums, Attachments → StorageProvider
- Simpler permission model than XenForo — mapping is more faithful
- Requires: Forum plugin installed and enabled

**vBulletin (`migrate-vbulletin`)**
- Source: Direct MySQL connection
- Auto-detects schema version: 3.x, 4.x, or 5.x
- Maps: Threads → Forum threads, Posts → Forum posts, Users → Users, Forums → Forum categories/subforums, Attachments → StorageProvider
- vBulletin 5 has a significantly different schema — handled as a distinct internal migration path
- Requires: Forum plugin installed and enabled

**WoltLab Suite (`migrate-woltlab`)**
- Source: Direct MySQL connection
- Maps: Threads → Forum threads, Posts → Forum posts, Users → Users, Board structure → Forum categories/subforums, Custom user fields → flagged in migration report for manual handling, Attachments → StorageProvider
- Most complex permission model — WoltLab's group inheritance generates a detailed mapping report; no automatic lossy conversion, admin must review
- Requires: Forum plugin installed and enabled

---

### Migration Log (Core Schema)

The CLI writes a structured log to the Nodevo database on every run. Core owns this table — no migration tooling code runs in the production process.

```sql
migration_runs
  id            TEXT PRIMARY KEY,
  adapter       TEXT NOT NULL,           -- e.g. "xenforo", "wordpress"
  adapter_ver   TEXT NOT NULL,
  source_info   TEXT NOT NULL,           -- e.g. "XenForo 2.2.14"
  started_at    TIMESTAMPTZ NOT NULL,
  completed_at  TIMESTAMPTZ,
  status        TEXT NOT NULL,           -- 'running' | 'completed' | 'partial' | 'failed'
  summary       JSONB,                   -- { users: 1240, threads: 8904, posts: 44320, ... }
  errors        JSONB,                   -- [{ entity, source_id, reason }, ...]
  report_path   TEXT,                    -- path to full migration report file if generated
  created_at    TIMESTAMPTZ DEFAULT NOW()
```

### ACP Migration History (Core)

A lightweight read-only page at **ACP → System → Migration History**.

Displays:
- List of all migration runs (adapter, source platform, date, status, summary counts)
- Expandable error list per run
- Link to full migration report file for adapters that generate one (vBulletin, WoltLab)
- No migration controls in the ACP — the CLI is the only trigger

This page is always present in core. It shows "No migrations have been run" on fresh installs.

---

### What Migration Covers vs What It Doesn't

**Migrated by all adapters:**
- User accounts (email, username, join date, post count)
- Content (threads/posts or articles/comments depending on platform)
- Category/forum structure
- Attachments and media via `StorageProvider`
- A best-effort group/role mapping

**Always documented as manual post-migration work:**
- Complex permission inheritance that doesn't map to flat RBAC
- Custom user profile fields
- Custom plugins/add-ons from the source platform
- Private messages (migrated if the PM plugin is installed, skipped otherwise)
- Reputation/reaction systems (documented in migration report, not migrated in v1)
- Theme and styling (never migrated — Nodevo uses its own theme system)

---

## 35. Username Change System

### User-Facing Behaviour

- Users can change their username from Account Settings → Profile
- A cooldown prevents repeated changes — default 60 days, configurable in ACP
- Setting cooldown to `0` disables user-initiated changes entirely (admin-only changes still work)
- The time remaining until the next allowed change is shown clearly in the UI
- Username uniqueness check is case-insensitive and also checks `username_history` to prevent impersonation of previously held usernames

### Data Model

```sql
-- Added to users table
username_changed_at   TIMESTAMPTZ NULL   -- null = never changed or restriction manually lifted

-- New table
username_history
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  old_username  TEXT NOT NULL,
  new_username  TEXT NOT NULL,
  changed_at    TIMESTAMPTZ DEFAULT NOW(),
  changed_by_id TEXT NOT NULL    -- user's own id, or admin id if ACP override
```

### ACP Settings

`users.username_change_cooldown_days` — integer, default `60`, stored in platform settings.

ACP → Users → \[User Detail\] → Actions:
- **Reset username cooldown** — clears `username_changed_at`, allowing immediate change
- **Change username** — admin override with no cooldown, logged in `username_history` and audit log
- **Username history** — shows full list of previous names for the user

### Permission Keys

```
user.username.change           ← user changes own (subject to cooldown)
user.username.change.any       ← admin override, no cooldown
user.username.history.view     ← view username history (moderator+)
```

---

## 36. Follow and Block System

### Follow System

Users can follow each other. Following is one-directional — A follows B does not mean B follows A.

```sql
user_follows
  id           TEXT PRIMARY KEY,
  follower_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (follower_id, following_id)
```

**Follow behaviour:**
- Following a user sends them a notification (respects their notification preferences)
- Follower counts are denormalized on the users table (`follower_count`, `following_count`) for performance
- A user's followers list is visible on their profile (public by default, configurable in privacy settings)
- **Remove Follower** — the followed user can remove someone from their followers without notifying them. The removed follower can re-follow unless blocked.

### Block System

```sql
user_blocks
  id          TEXT PRIMARY KEY,
  blocker_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (blocker_id, blocked_id)
```

**Block behaviour (all enforced server-side):**
- Blocking B automatically removes any follow relationship in both directions
- Blocked user cannot follow the blocker again
- Blocked user's follow button is replaced with a neutral state (no indication they are blocked — prevents harassment confirmation)
- When PM plugin is installed: blocked user cannot initiate conversations
- Blocked user's content can optionally be hidden from the blocker's feeds (configurable per-user in privacy settings)
- Blocking is silent — no notification is sent to the blocked user

**Moderator visibility:**
- ACP → Users → \[User Detail\] shows block relationships (both directions) for abuse investigation
- Blocks are never auto-removed by moderation actions

### Profile UI Components

User profile gains two tabs alongside Articles, Forum Posts, About:

**Followers tab:**
- Grid/list of users who follow this profile
- If viewing your own profile: each entry has a **Remove** button
- Count shown in profile header stat bar

**Following tab:**
- Grid/list of users this profile follows
- If viewing your own profile: each entry has an **Unfollow** button

**Block list** lives in Account Settings → Privacy (not on the public profile).

### Permission Keys

```
user.follow            ← follow another user
user.block             ← block another user
user.followers.manage  ← remove own followers
```

### API Routes

```
POST   /api/users/:id/follow
DELETE /api/users/:id/follow       ← unfollow
POST   /api/users/:id/block
DELETE /api/users/:id/block        ← unblock
DELETE /api/users/:id/followers/:followerId   ← remove a follower
GET    /api/users/:id/followers    ← paginated
GET    /api/users/:id/following    ← paginated
GET    /api/users/me/blocks        ← own block list
```

---

## 37. Privacy Settings

All settings stored in a `user_privacy_settings` table as a JSON column for flexibility. **A row is created with default values on every user registration** — never null-checked, always present.

### Email Notification Toggles

Wraps the existing `notification_preferences.email_enabled` into a clear grouped UI:

| Category | Types covered | Toggle |
|---|---|---|
| Forum activity | Thread replies, mentions, solution marked | On/Off |
| Follows | New follower | On/Off |
| Moderation | Warning issued, ban lifted, case opened | On/Off |
| System | License expiry, plugin updates (admin only) | On/Off |
| Product news | Platform announcements | On/Off |

**Master toggle:** "Disable all email notifications" — overrides all per-category settings. The individual toggles remain visible but are greyed out while the master is off.

### Profile Wall Controls

| Setting | Options |
|---|---|
| Allow profile comments | On/Off — disables wall entirely when off |
| Who can comment on my profile | Everyone / Members I follow / Nobody |

### Follow and Visibility Controls

| Setting | Options |
|---|---|
| Who can follow me | Everyone / Nobody |
| Show my follower list publicly | On/Off |
| Show my following list publicly | On/Off |
| Hide blocked users' content | On/Off (applies to feeds and thread views) |
| Who can see my profile | Everyone / Members only |
| Who can see my post history | Everyone / Members only / Nobody |

### Block List

- Displays all blocked users in a paginated list
- Unblock button per entry
- "Block a user" search input (can block without visiting their profile)

---

## 38. User Progression System

### Philosophy

Levels are groups. Rather than building a separate level system alongside RBAC, the progression engine promotes users between configured groups as they meet activity thresholds. This means every level's capabilities are expressed through standard permission keys and the same content limit system — no second permission layer to maintain.

Protected groups (Administrator, Supermod, Moderator) are excluded from the ladder entirely. The progression ladder only applies to the member-tier group chain.

### Denormalized Activity Counters

Added to the `users` table — updated on every relevant write event, never queried in real time:

```sql
post_count           INT NOT NULL DEFAULT 0
thread_count         INT NOT NULL DEFAULT 0
article_count        INT NOT NULL DEFAULT 0
like_count_received  INT NOT NULL DEFAULT 0
```

### Group Progression Config

Each group gets an optional progression configuration:

```sql
group_progression
  group_id               TEXT PRIMARY KEY REFERENCES groups(id),
  is_progression_group   BOOL NOT NULL DEFAULT FALSE,
  ladder_position        INT NULL,           -- order in ladder (1 = entry level)
  promote_from_group_id  TEXT NULL,          -- which group this auto-promotes FROM
  min_posts              INT NULL,           -- threshold condition
  min_threads            INT NULL,
  min_days_member        INT NULL,
  min_likes_received     INT NULL,
  max_post_length        INT NULL,           -- NULL or 0 = unlimited
  max_daily_posts        INT NULL,
  max_attachments        INT NULL,           -- v2 stub: file attachment system not in v1; column reserved for when forum/article file uploads land
  max_profile_image_bytes    INT NULL,
  allowed_profile_image_types TEXT[] NULL,
  badge_label            TEXT NULL,
  badge_color            TEXT NULL```

All threshold fields are AND conditions unless the ACP is configured for OR logic. Default is AND (all specified thresholds must be met).

### Example Ladder

| Position | Group | Thresholds | Max post length | Badge |
|---|---|---|---|---|
| 1 | New Member | 0 (default on register) | 500 chars | 🌱 New Member |
| 2 | Member | 20 posts | 2,000 chars | 💬 Member |
| 3 | Regular | 100 posts + 30 days | 5,000 chars | ⭐ Regular |
| 4 | Veteran | 500 posts + 180 days + 50 likes | Unlimited | 🏆 Veteran |

Each level also unlocks forum categories and article sections via standard RBAC permission keys — a "Level 3 only" forum category simply requires `forum.access.advanced` and only Regular+ groups have it.

### Content Limit Enforcement

Post, thread, and article creation endpoints read the author's effective `group_progression` config and enforce limits before writing:

- Max post/article length → `NEC-PERM-1040` (content too long for your current level)
- Daily post limit → `NEC-PERM-1041` (daily post limit reached)
- Max attachments → `NEC-PERM-1042` (attachment limit exceeded)

**Profile image upload** reads the user's group progression config:
- `max_profile_image_bytes` — if set, enforces this limit instead of the global `UPLOAD_LIMITS.AVATAR`. Group limit is always more restrictive than the global cap, never more permissive.
- `allowed_profile_image_types` — if set, only these MIME types are accepted. Error: `NEC-STORE-7002` (file type not permitted for your level).

Example ladder behaviour:
| Level | Max size | Allowed types |
|---|---|---|
| New Member (Level 1) | 512 KB | `image/jpeg` only |
| Member (Level 2) | 1 MB | `image/jpeg`, `image/png` |
| Regular (Level 3+) | 2 MB (global default) | All types (global default) |

If `max_profile_image_bytes` or `allowed_profile_image_types` is NULL, the global `UPLOAD_LIMITS` values apply. The enforcement order is: group config first → fall back to global.

The frontend reads the authenticated user's content limits from `GET /api/users/me/limits` and shows a live character counter with the current cap. When a user is close to leveling up, a progress indicator can be shown on their profile (configurable in ACP — show/hide progression progress bar).

### Promotion Engine

A BullMQ job triggered on every post, thread creation, and like event:

```typescript
async function checkPromotion(userId: string): Promise<void> {
  const user    = await userRepo.getWithCounters(userId);
  const current = await groupRepo.getProgressionConfig(user.groupId);

  if (!current?.is_progression_group) return;  // not on the ladder

  const next = await groupRepo.getNextInLadder(current.ladder_position);
  if (!next) return;  // already at top of ladder

  if (meetsThresholds(user, next)) {
    await userRepo.setGroup(userId, next.group_id);
    await notificationService.dispatch({
      userId,
      type:  "progression.promoted",
      title: `You've been promoted to ${next.badge_label}!`,
      body:  `Keep participating to unlock even more access.`,
      channels: ["in_app", "email"],
    });
    await auditLog.write({ action: "user.promoted", userId, meta: { from: current.group_id, to: next.group_id } });
  }
}
```

No automatic demotion in v1 — levels are permanent unless an admin manually changes the user's group.

### ACP Configuration

**ACP → Access Control → Groups → \[Group\] → Progression tab:**
- Toggle: "This group is part of the member progression ladder"
- Ladder position (drag to reorder in the global Progression view)
- Threshold inputs: min posts, min threads, min days, min likes (each optional)
- Threshold logic: AND / OR radio
- Content limits: max post length, daily post limit, max attachments
- **Profile image limits**: max file size (KB/MB input or "use default"), allowed types (checkbox: JPEG, PNG, GIF, WebP)
- Badge label and colour picker
- Preview: shows what a member badge looks like in forum context

**ACP → Access Control → Progression (new page):**
- Global toggle: enable/disable the entire progression system
- Full ladder view — all progression groups in order, their thresholds at a glance
- Drag-and-drop reorder
- "Show progress bar on profiles" toggle
- "Notify user on promotion" toggle (default on)
- Stat: how many users are at each level

### Notification Types Added

| Type | Trigger |
|---|---|
| `progression.promoted` | User automatically promoted to next level |

### Permission Keys Added

```
progression.manage           ← configure the progression system (admin)
user.group.change.any        ← manually change any user's group (admin/supermod)
```

---

## 39. Category Access Control and Forum Node Tree

### Forum Node Tree Model

The forum plugin models all forum structure as a single **node tree** rather than separate category and subforum tables. Every node has a type — `category` (container, no threads) or `forum` (postable, threads live here). This allows subcategories, subforums, and arbitrarily nested structure with one clean table.

```sql
-- Owned by the forum plugin (in its own migrations)
forum_nodes
  id                    TEXT PRIMARY KEY,
  parent_id             TEXT NULL REFERENCES forum_nodes(id),  -- null = root level
  type                  TEXT NOT NULL,     -- 'category' | 'forum'
  name                  TEXT NOT NULL,
  slug                  TEXT NOT NULL UNIQUE,
  description           TEXT NULL,
  position              INT NOT NULL DEFAULT 0,   -- sort order within parent
  allow_threads         BOOL NOT NULL DEFAULT FALSE,  -- false for category nodes

  -- Access control (shared model from core)
  visibility            TEXT NOT NULL DEFAULT 'public',
  visibility_groups     TEXT[] NOT NULL DEFAULT '{}',
  visibility_min_level  INT NULL,
  hide_if_no_access     BOOL NOT NULL DEFAULT TRUE,
  effective_visibility  TEXT NOT NULL DEFAULT 'public',  -- precomputed cache

  -- Denormalized stats
  thread_count          INT NOT NULL DEFAULT 0,
  post_count            INT NOT NULL DEFAULT 0,
  last_post_at          TIMESTAMPTZ NULL,
  last_thread_id        TEXT NULL,

  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
```

**Depth guidance:** the ACP enforces a soft limit of 3 levels with a warning. No hard technical block — the tree structure supports any depth — but the forum frontend and the migration adapters assume a maximum practical depth of 3.

**Example structure:**

```
Category: "Development"              type: category, visibility: public
  Subcategory: "Backend"             type: category, visibility: public
    Forum: "API Questions"           type: forum    ← threads live here
    Forum: "Database & Prisma"       type: forum
  Forum: "Plugin Development"        type: forum    ← forum at level 2 is fine
  Forum: "Frontend"                  type: forum

Category: "Staff"                    type: category, visibility: groups (staff)
  Forum: "Staff Discussion"          type: forum    ← effective: staff (inherited)
  Forum: "Ban Appeals Review"        type: forum    ← effective: staff (inherited)
  Forum: "Community Manager Notes"   type: forum    ← effective: staff (inherited)
```

---

### Visibility Modes

Applied consistently to both `forum_nodes` (forum plugin) and `article_categories` (core). The model is defined once in core; the forum plugin inherits it.

| Mode | Who can see the node |
|---|---|
| `public` | Everyone including guests |
| `members` | Logged-in users only |
| `level` | Users at or above `visibility_min_level` on the progression ladder |
| `groups` | Only users whose group IDs intersect `visibility_groups` |

**Staff shorthand** — an ACP convenience button that sets `visibility = 'groups'` and pre-populates `visibility_groups` with the IDs of Administrator, Supermod, and Moderator. It is not a separate mode. Custom staff groups must be added manually to relevant nodes.

**`hide_if_no_access`:**
- `true` (default for `groups` mode) — node is stripped from all API responses and returns 404 on direct URL access. Non-staff users have no indication it exists.
- `false` (default for `level` mode) — node appears in listings but is visually locked with an explanation, e.g. "Reach Level 3 to access this section." Useful for progression-gated categories where showing the target is good UX.

---

### Access Inheritance

**Rule:** a node's effective access is the most restrictive of its own setting and all its ancestors.

The server-side check always walks the full ancestor chain. The `effective_visibility` column is a precomputed cache updated whenever the node or any ancestor is edited — it is never the source of truth for enforcement, only a performance optimisation for list queries.

```typescript
function resolveEffectiveAccess(node: ForumNode, ancestors: ForumNode[]): ResolvedAccess {
  // Start with node's own setting, then apply each ancestor from root down
  // Most restrictive wins at each step
  return [node, ...ancestors].reduce(mostRestrictive);
}
```

**Consequences:**
- Setting a child to `public` inside a staff-only parent → effective access remains staff-only
- Setting a child to `level: 3` inside a `members` parent → effective access is `level: 3` (more restrictive)
- Changing a parent's restriction immediately recalculates all descendants via a BullMQ job

The ACP shows a warning banner when a child's own setting is overridden by a parent, and displays the computed effective access so the admin always knows what will actually be enforced.

---

### Per-Category Group Access Picker (ACP)

The `GroupAccessPicker` component lives in `packages/ui/` and is used by both the forum node editor (forum plugin) and the article category editor (core). It is written once and imported in both places.

**ACP Forum Node Editor — Access Control section:**

```
Access Control
──────────────────────────────────────────────────────────

Visibility
  ○ Public              Everyone including guests
  ○ Members only        Logged-in users
  ○ Level N+            [Level picker dropdown ▾]
  ● Specific groups     Choose below

Groups with access                          [+ Add group]
  ┌────────────────────────────────────────────────────┐
  │ ✓ Administrator                                    │
  │ ✓ Supermod                                         │
  │ ✓ Moderator                                        │
  │ ✗ Editor                                           │
  │ ✗ Member (Level 1)                                 │
  │ ✗ Regular (Level 2)                                │
  │ ✗ Veteran (Level 3)                                │
  └────────────────────────────────────────────────────┘

Shortcuts:   [Staff (Mods+)]   [All Members]   [Level 2+]

If no access:   ● Hide entirely    ○ Show locked notice

──────────────────────────────────────────────────────────
Inherited restriction
  ⚠ Parent "Development" restricts to: Staff only
  This node cannot be less restrictive than its parent.
  Effective access: Staff only (inherited)
```

**Shortcut behaviour:**
- `[Staff (Mods+)]` — checks Administrator, Supermod, Moderator. Unchecks all other groups.
- `[All Members]` — checks all progression groups (all levels). Unchecks admin/mod groups.
- `[Level 2+]` — checks groups at ladder position ≥ 2. Unchecks Level 1 and admin/mod groups.

Shortcuts are convenience pre-fills only. The admin can add or remove individual groups freely after clicking a shortcut.

---

### ACP Forum Category Manager

**ACP → Forum → Categories** presents the full node tree with:

- Expandable/collapsible nodes
- Drag handle `⠿` to reorder within the same parent
- "Move to…" dropdown to reparent a node (cross-parent moves)
- Type badge: `CATEGORY` or `FORUM`
- Visibility badge: `Public`, `Members`, `Level N+`, `Staff`, or group names
- Effective access indicator when inherited differs from own setting
- `+ Add category` and `+ Add subforum` buttons contextual to each node
- Edit and Delete per node (delete requires confirmation if the node has children)

Deleting a node with children offers three options:
1. Delete node and all descendants
2. Move children up one level (reparent to deleted node's parent)
3. Cancel

---

### What Core Provides vs What the Forum Plugin Provides

| Responsibility | Owner |
|---|---|
| Visibility mode constants and types | Core (`packages/contracts`) |
| `userCanSeeNode()` access check function | Core (`@nodevo/sdk` → `packages/sdk/src/access.ts`) |
| `effective_visibility` computation logic | Core (shared util) |
| `GroupAccessPicker` ACP UI component | Core (`packages/ui`) |
| `forum_nodes` table and migrations | Forum plugin |
| Forum node ACP pages (category manager) | Forum plugin |
| `article_categories` table and visibility columns | Core |
| Article category ACP editor | Core |

The forum plugin uses `@nodevo/plugin-sdk` (authoring contract) and the `GroupAccessPicker` from `@nodevo/ui`. The shared access utils (`userCanSeeNode`, `resolveEffectiveVisibility`, `VISIBILITY_MODES`) are exposed from `@nodevo/sdk` for plugins to consume for node-tree visibility instead of reimplementing access control logic.

### Forum Plugin — Additional Table Schemas

```sql
-- Thread subscription (notify user on new replies)
forum_subscriptions
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,    -- no FK to core users table (cross-plugin boundary)
  thread_id    TEXT NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
  notify_type  TEXT NOT NULL DEFAULT 'reply',   -- 'reply' | 'all_activity'
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, thread_id)
```

**Cross-plugin FK note:** Plugin tables cannot use PostgreSQL FKs that reference core tables managed by Prisma (Prisma is unaware of plugin tables). `forum_subscriptions.user_id` references `users.id` conceptually but not via a DB constraint. Referential integrity is enforced at the service layer. On user account deactivation, a BullMQ job cleans up the user's plugin-owned records via a registered `onUserDeactivated` hook in the plugin-sdk.

---

### Permission Keys (Added)

```
forum.node.create           ← create categories and forums (admin)
forum.node.edit             ← edit node settings including access control (admin)
forum.node.delete           ← delete nodes (admin)
forum.node.reorder          ← drag/drop reorder (admin)
forum.staff.access          ← access staff-restricted forum nodes
```

`forum.staff.access` is granted to Moderator, Supermod, and Administrator by default. It is what the "Staff" shorthand grants in the group picker. Granting it to a custom group (e.g. "Community Manager") via the standard permission matrix immediately gives that group access to all staff-only forum nodes.

---

## 40. Profile Comments (Profile Wall)

### Behaviour

Any logged-in user can post a comment on another user's profile wall. The profile owner cannot comment on their own wall — enforced server-side (`author_id != profile_user_id`).

- Blocked users cannot post (checked against `user_blocks`)
- Profile owner can disable their wall entirely via Account Settings → Privacy
- Comment authors can edit their own comment within a configurable time window (ACP setting: `profile_comments.edit_window_minutes`, default `15`)
- Profile owner can delete any comment on their own wall — soft-delete, no reason required
- Moderators soft-delete with required reason — tombstone displayed: *"Comment by [user] was deleted by [mod] · [timestamp] · Reason: [reason]"* — same pattern as forum posts and article comments
- Profile owner receives a `profile.comment_posted` notification (respects notification preferences)

### Data Model

```sql
profile_comments
  id               TEXT PRIMARY KEY,
  profile_user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body             TEXT NOT NULL,
  deleted_at       TIMESTAMPTZ NULL,
  deleted_by_id    TEXT NULL,
  deleted_reason   TEXT NULL,
  edited_at        TIMESTAMPTZ NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT no_self_comment CHECK (author_id != profile_user_id)
```

### Profile UI

The profile page gains a **Comments** section below the tab bar (visible on all tabs, like a persistent wall). It shows the most recent comments with a "Load more" paginator. The compose box appears below the list — hidden if the visitor is the profile owner, not logged in, or has been blocked.

### Privacy Settings

Added to Account Settings → Privacy:
- "Allow profile comments" toggle — when off, existing comments are hidden and new ones are blocked
- "Who can comment" selector: `Everyone` / `Members I follow` / `Nobody`

### Permission Keys

```
profile.comment.create       ← post a comment on another user's profile
profile.comment.delete.own   ← delete your own comment
profile.comment.delete.wall  ← delete any comment on your own wall
profile.comment.delete.any   ← moderator: delete any comment anywhere
```

### Notification Types Added

| Type | Trigger |
|---|---|
| `profile.comment_posted` | Someone comments on your profile wall |

---

## 41. Custom Profile Fields

### Overview

Admins configure a set of profile fields in the ACP. These fields appear at registration (optionally), in Account Settings → Profile (for editing), and on the user profile in an "Information" tab. Each field value has its own per-user privacy setting.

### Data Model

```sql
-- Admin-defined field schema
user_profile_fields
  id                        TEXT PRIMARY KEY,
  key                       TEXT NOT NULL UNIQUE,   -- internal key e.g. "discord_tag"
  label                     TEXT NOT NULL,           -- admin-configurable display name
  type                      TEXT NOT NULL,           -- 'text' | 'date' | 'email' | 'url'
  placeholder               TEXT NULL,
  position                  INT NOT NULL DEFAULT 0,  -- display order
  show_on_registration      BOOL NOT NULL DEFAULT FALSE,
  required_on_registration  BOOL NOT NULL DEFAULT FALSE,
  show_on_profile           BOOL NOT NULL DEFAULT TRUE,
  dob_display_format        TEXT NULL,                  -- 'age'|'birthday'|'full'; only relevant when type='date'
  is_system                 BOOL NOT NULL DEFAULT FALSE,  -- pre-seeded, label editable, undeletable
  created_at                TIMESTAMPTZ DEFAULT NOW()

-- Per-user values with individual privacy
user_profile_field_values
  id        TEXT PRIMARY KEY,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  field_id  TEXT NOT NULL REFERENCES user_profile_fields(id) ON DELETE CASCADE,
  value     TEXT NOT NULL,    -- always stored as text, cast on read by type
  privacy   TEXT NOT NULL DEFAULT 'public',  -- 'public' | 'members' | 'nobody'
  UNIQUE (user_id, field_id)
```

### System Fields (Pre-Seeded at Install)

These are seeded during the installer. Labels are configurable in ACP; fields cannot be deleted; fields can be hidden from registration and/or profile display.

| Key | Default Label | Type | Registration Default |
|---|---|---|---|
| `date_of_birth` | Date of Birth | `date` | Optional |
| `website` | Website | `url` | Optional |
| `discord` | Discord Tag | `text` | Optional |
| `contact_email` | Contact Email | `email` | Optional |

### Date of Birth Special Handling

Stored as a date. A field-level `dob_display_format` setting in the `user_profile_fields` row controls how it renders on profiles:

| Format | Display example |
|---|---|
| `age` (default) | 25 years old |
| `birthday` | May 20 |
| `full` | May 20, 2001 |

Admin configures this in the field editor. Users cannot override it — the platform decides how dates of birth are displayed to protect privacy.

### Registration Form Integration

Fields with `show_on_registration: true` appear in an **"Additional information"** section at the bottom of the registration form. If all such fields are optional, the section is collapsed by default with an "Add profile info (optional) ▾" toggle to reduce friction for quick signups. Required fields are always visible.

### Account Settings → Profile Integration

After the core profile fields (display name, username, avatar, bio):

```
Profile Information
───────────────────────────────────────────────────
Date of Birth    [May 20, 2001  ▾]   Privacy: [Age only ▾]   Visibility: [Members ▾]
Website          [https://...]        Visibility: [Public  ▾]
Discord Tag      [alex#1234]          Visibility: [Public  ▾]
Contact Email    [alex@...]           Visibility: [Nobody  ▾]
Custom Field 1   [...]                Visibility: [Public  ▾]
```

Date of birth additionally shows a "Display as" dropdown (Age only / Birthday / Full date), controlled by the admin's `dob_display_format` setting — if the admin locked the format, this dropdown is hidden.

### Profile Display — Information Tab

Displayed in the "Information" tab on the user's public profile. Only fields where all three conditions are met are shown:
1. `show_on_profile: true` on the field definition
2. The user has a non-empty value for this field
3. The field's `privacy` value allows the current viewer (`public` = all, `members` = logged-in only, `nobody` = hidden from everyone including staff)

```
Information
───────────────────────────────────────────────
🎂  Date of Birth      25 years old
🌐  Website            alexrivera.dev
💬  Discord            alex#1234
```

Contact email is not shown in this example because it was set to `nobody` by the user.

Fields with `nobody` privacy are hidden from everyone — including moderators and admins viewing the profile. The raw value is only visible in ACP → Users → \[User Detail\] for admin/supermod roles.

### Privacy Settings Integration

Account Settings → Privacy gains a **"Profile Information"** summary section listing each field with its current privacy setting. It links directly to Account Settings → Profile for editing — it is a read-only overview, not a duplicate editor.

```
Profile Information Privacy
───────────────────────────────────────────────
Date of Birth     Members only       [Edit ↗]
Website           Public             [Edit ↗]
Discord Tag       Public             [Edit ↗]
Contact Email     Hidden             [Edit ↗]
```

### ACP Configuration

**ACP → Users → Profile Fields** (new page):

- Table of all fields: label, key, type, registration visibility, profile visibility, position
- Drag-to-reorder (updates `position`)
- **+ Add field** button → modal: label, type, placeholder, show on registration, required on registration
- **Edit** per field → same modal + `dob_display_format` for date fields
- **Delete** non-system fields → confirmation modal warns if users have values ("234 users have filled this field. Deleting it will permanently remove their data.")
- System fields show a 🔒 lock icon — label and settings are editable, delete is disabled
- **Show on registration** toggle per field inline in the table
- **Required** toggle per field (only active when "Show on registration" is on)

### ACP Settings

| Setting | Default | Notes |
|---|---|---|
| `profile_comments.enabled` | `true` | Global on/off for all profile comments |
| `profile_comments.edit_window_minutes` | `15` | How long authors can edit their comments |
| `profile_fields.show_section_collapsed_on_registration` | `true` | Collapse optional fields at registration |

### Permission Keys Added

```
profile_fields.manage    ← create, edit, delete, reorder profile fields (admin)
profile.view.full        ← see 'nobody' privacy fields in ACP user detail (admin/supermod)
```

### Notification Types Added

| Type | Trigger |
|---|---|
| `profile.comment_posted` | Someone posts on your profile wall |

---

## 42. ACP Navigation Structure (Updated)

```
Dashboard
Users
  User List
  User Detail            ← accessible from User List; username history, blocks, raw profile fields (admin/supermod)
  Profile Fields         ← custom field schema manager
Access Control
  Groups                 ← Progression tab added per group
  Permissions
  Progression            ← global ladder view + system settings
Content
  Articles
  Article Categories     ← drag/drop tree manager, same pattern as Forum > Categories
Forum
  Categories
Moderation
  Report Queue
  Warnings
  Bans
  Review Cases
  Moderation Log
  Settings
Appearance
  Style Editor
  Styles
  Style History
  Navigation            ← frontend navbar manager (drag-drop, add/hide/reorder links)
Extensions
  Marketplace
  Installed
  Upload
  License
System
  Error Reference
  Error Log
  Migration History      ← reads migration_runs table
  Settings
About
```

---

## 43. Auth and Session Model

### RS256 Key Pairs — Two Separate Keys

There are two distinct RS256 key pairs in the system. Never confuse them:

| Key | Purpose | Source | Storage |
|---|---|---|---|
| **Auth signing key** | Signs Nodevo's own JWT access tokens | Generated at install time | `JWT_PRIVATE_KEY` + `JWT_PUBLIC_KEY` env vars (PEM, base64) |
| **License verification key** | Verifies license entitlement JWTs from nodevo.io | Issued by nodevo.io, fixed | Bundled into `packages/sdk/` as `license-public-key.pem` |

**Auth key generation** happens in installer Step 4 (App Config). The installer generates an RS256 key pair using Node.js `crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })` and writes both keys to the `.env` file. The private key never leaves the server. The public key is available to all services that verify access tokens.

### Flow

```
Register / Login
  → argon2 password verify
  → generate random 32-byte refresh token (crypto.randomBytes(32).toString('hex'))
  → hash with SHA-256 HMAC (NOT argon2 — tokens need fast comparison, not slow hashing)
  → store hash in refresh_tokens table
  → set httpOnly Secure SameSite=Strict cookie: raw refresh token
  → sign RS256 JWT access token with JWT_PRIVATE_KEY (15 min expiry, payload: userId, groupId)
  → return access token in response body

Authenticated request
  → client sends access token in Authorization: Bearer header
  → jose verifies JWT signature using JWT_PUBLIC_KEY + expiry
  → decoded payload contains userId + groupId (no DB hit for basic auth)
  → if expired: client calls POST /api/auth/refresh
      → server reads refresh_token cookie (raw token)
      → compute SHA-256 HMAC of raw token
      → compare hash against DB record (constant-time comparison)
      → rotate: delete old record, create new refresh token
      → issue new access token + set new refresh cookie

Logout
  → DELETE /api/auth/session
  → delete refresh_token record from DB
  → clear cookie
```

### Why SHA-256 for Refresh Tokens (not argon2)

argon2 is correct for password hashing — its intentional slowness (100-500ms) protects against brute force. Refresh tokens are 32-byte random values with 2^256 entropy — brute force is computationally impossible regardless of hash speed. Using argon2 here would add 100-500ms latency to every page load after token expiry. SHA-256 HMAC with a server-side secret (`REFRESH_TOKEN_HMAC_SECRET` env var) is correct.

### DB Tables

```sql
refresh_tokens
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,   -- SHA-256 HMAC of the raw token (NOT argon2)
  user_agent   TEXT NULL,
  ip_address   TEXT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ NULL
```

Multiple refresh tokens per user are allowed (multiple devices/sessions). Each session appears in Account Settings → Security with device/IP/last-seen info and a Revoke button.

### Token Strategy

| Token | Storage | Lifetime | Notes |
|---|---|---|---|
| Access token | Memory (JS variable, never localStorage) | 15 minutes | JWT signed with RS256 |
| Refresh token | httpOnly Secure **SameSite=Strict** cookie | 30 days | Rotated on every use |

### CSRF Defense

`SameSite=Strict` on the refresh token cookie is the primary CSRF defense. Because:
- Access tokens are in memory and sent as `Authorization: Bearer` headers — CSRF does not apply to header-based auth
- The refresh cookie can only be sent by same-site requests (`SameSite=Strict`) — cross-origin attack cannot trigger token rotation
- No additional CSRF token mechanism required for the REST API

The one endpoint that reads the cookie (`POST /api/auth/refresh`) is protected by `SameSite=Strict` alone. Verify this in Phase 17 security audit.

### Security Events

Every auth event writes to `security_events` (§15):
- Login success — IP, UA, device cookie, timestamp
- Login failure — IP, UA, attempted email (hashed), timestamp
- Password change — IP, UA
- Refresh token rotation — IP, UA

### Banned User Login

The login endpoint checks `users.banned_until` before issuing tokens:
- If `banned_until` is `null` or in the past → login proceeds normally
- If `banned_until` is in the future → return `NEC-AUTH-1003` (account banned) with `{ banExpiresAt, reason }` in the response
- If `banned_until` is the sentinel value `9999-12-31` (permanent) → return `NEC-AUTH-1004` (account permanently banned)

### Account Enumeration Prevention

The login endpoint **must return identical errors** whether the email does not exist or the password is wrong. Both cases return `NEC-AUTH-1001` with message "Invalid credentials." Never return "User not found" or "Email not registered" — this leaks which emails are in the system.

Password reset follows the same rule: `POST /api/auth/password-reset` always returns 200 OK regardless of whether the email exists. The email is only sent if the account is found.

### Password Requirements

Minimum password policy enforced on registration and password change. Configurable in ACP → System → Settings under `auth.password_policy`:

| Setting | Default | Minimum |
|---|---|---|
| `min_length` | 8 | 8 |
| `require_uppercase` | false | — |
| `require_number` | false | — |
| `require_special` | false | — |

Returns `NEC-AUTH-1006` (password does not meet requirements) with details on failure.

### Open Redirect Prevention

After login, if a `?redirect=` param is present, it must be validated as a same-origin relative path before redirect. Any absolute URL or different-origin path is silently ignored and the user is sent to `/` instead.

```typescript
function isSafeRedirect(url: string): boolean {
  // Must be relative (no protocol, no host)
  return url.startsWith('/') && !url.startsWith('//');
}
```

### Mid-Session Ban

When a user's access token expires and they call `POST /api/auth/refresh`, the refresh endpoint checks `users.banned_until` **before** rotating the token. If the user is currently banned, the endpoint:
1. Deletes the refresh token record from DB (force logout)
2. Clears the refresh cookie
3. Returns `NEC-AUTH-1003` or `NEC-AUTH-1004` with ban details

This ensures a ban takes full effect within 15 minutes (the access token lifetime) without requiring a real-time invalidation mechanism.

### Email Verification Restrictions

Configurable in ACP → System → Settings under `auth.require_email_verification_for`:

| Action | Default restriction |
|---|---|
| Posting articles | Verified only |
| Posting forum threads | Verified only |
| Posting replies | Verified only |
| Following users | Verified only |
| Commenting on profiles | Verified only |
| Liking content | No restriction |
| Viewing content | No restriction |

Unverified users can log in and browse. API endpoints for restricted actions return `NEC-AUTH-1005` (email not verified) if restriction is enabled and user is unverified. The frontend shows a persistent verification banner.

### Required Environment Variables

All parsed and validated by Zod in `apps/api/src/config/env.ts` at startup. App refuses to start if required variables are missing.

```
# Database
DATABASE_URL          postgresql://user:pass@host:5432/nodevo?connection_limit=20
REDIS_URL             redis://localhost:6379
REDIS_KEY_PREFIX      nodevo    ← namespaces all Redis keys, prevents collision on shared Redis

# Auth
JWT_PRIVATE_KEY       <RS256 private key, PEM base64, generated by installer>
JWT_PUBLIC_KEY        <RS256 public key, PEM base64, generated by installer>
REFRESH_TOKEN_HMAC_SECRET  <random 64-char hex, generated by installer>

# Storage
# v1 reality: the env var is UPLOAD_DIR (not STORAGE_PATH), default "./var/uploads",
# resolved via path.resolve() against the API process CWD (apps/api/ in dev), so real
# uploads land in apps/api/var/uploads/. Set an absolute path in production.
UPLOAD_DIR            ./var/uploads
APP_URL               https://mysite.nodevo.com

# Email (SMTP)
SMTP_HOST             smtp.example.com
SMTP_PORT             587
SMTP_USER             no-reply@mysite.com
SMTP_PASS             <smtp password>
SMTP_FROM             Nodevo <no-reply@mysite.com>

# Optional
NODE_ENV              production
LOG_LEVEL             info
PORT                  3000
```

The license server public key is NOT an env var — it is bundled as `packages/sdk/src/license-public-key.pem` and committed to the repository.

### Email Verification Flow

```sql
email_verify_tokens
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,   -- SHA-256 HMAC of raw token
  expires_at  TIMESTAMPTZ NOT NULL,   -- 24 hours from creation
  used_at     TIMESTAMPTZ NULL        -- set on verification; subsequent uses rejected
```

1. User registers → account created with `email_verified_at = null`
2. Verification email queued (BullMQ) with a raw random token embedded in the link
3. Token hash stored in `email_verify_tokens` (DB-backed, not JWT — JWT would remain valid after verification and could be replayed)
4. User clicks link → `POST /api/auth/verify-email?token=...`
5. Look up hash, check expiry, check `used_at` is null, set `email_verified_at = NOW()`, set `used_at = NOW()`
6. Unverified users can log in but see a verification banner; restricted actions return `NEC-AUTH-1005` if email not verified

`email_verify_tokens` is added to the Phase 2 Prisma schema.

---

## 44. Article Categories — Tree Structure

Article categories support parent/child nesting with drag-and-drop ordering in the ACP, the same pattern as the forum node tree (§39). There's no good reason to treat them differently — the access control model is shared, the ACP tree component is already built, and `parent_id` costs almost nothing to add.

### Key Differences from Forum Nodes

| | Forum nodes (§39) | Article categories |
|---|---|---|
| `type` field | Yes — `category` or `forum` | No — all nodes can hold articles |
| `allow_threads` | Yes — false for category nodes | N/A |
| `effective_visibility` | Precomputed column | Precomputed column (same approach) |
| Recommended depth | 3 levels | 2 levels (parent + child) |

All article category nodes behave identically — any category can have articles whether or not it has children. The parent/child distinction is purely organisational.

### Data Model

```sql
article_categories
  id                    TEXT PRIMARY KEY,
  parent_id             TEXT NULL REFERENCES article_categories(id),  -- null = root
  name                  TEXT NOT NULL,
  slug                  TEXT NOT NULL UNIQUE,
  description           TEXT NULL,
  position              INT NOT NULL DEFAULT 0,   -- sort order within parent

  -- Access control (shared model from §39)
  visibility            TEXT NOT NULL DEFAULT 'public',
  visibility_groups     TEXT[] NOT NULL DEFAULT '{}',
  visibility_min_level  INT NULL,
  hide_if_no_access     BOOL NOT NULL DEFAULT TRUE,
  effective_visibility  TEXT NOT NULL DEFAULT 'public',  -- precomputed cache, same as forum_nodes

  created_at            TIMESTAMPTZ DEFAULT NOW()
```

### Access Inheritance

Same rule as forum nodes: a child's effective access is the most restrictive of itself and all its ancestors. A public subcategory inside a staff-only parent is effectively staff-only. Checked server-side on every request — never client-side.

### ACP — Article Category Manager

**ACP → Content → Categories** mirrors the forum node manager (§39):

- Expandable/collapsible tree view
- Drag handle `⠿` to reorder within the same parent
- "Move to…" dropdown to reparent a category
- Visibility badge per node with inherited restriction warning when applicable
- `+ Add subcategory` contextual button per node
- Edit and Delete per node (delete warns if articles exist in that category)
- Same `GroupAccessPicker` component from `packages/ui/`

Deleting a category with children or articles offers:
1. Delete category and all descendants (articles become uncategorised)
2. Move children up one level
3. Cancel

### Soft Depth Limit

2 levels recommended — root categories + one level of subcategories. The ACP shows a warning if an admin tries to create a third level but does not block it technically. The article listing frontend is designed with two levels in mind.

### Example Structure

```
Category: "Engineering"          visibility: public
  Subcategory: "Backend"         visibility: public
  Subcategory: "Frontend"        visibility: public
  Subcategory: "Database"        visibility: public

Category: "Staff"                visibility: groups (staff)
  Subcategory: "Policy Drafts"   visibility: groups (staff) — inherited
  Subcategory: "Internal Docs"   visibility: groups (staff) — inherited

Category: "Announcements"        visibility: public
```

---

## 45. Like System — Source Tables

The `like_count_received` counter on users (§38) aggregates likes across all content types. The source tables are:

| Content type | Table | Owner |
|---|---|---|
| Article comment likes | `article_comment_likes` | Core (§46) |
| Profile comment likes | `profile_comment_likes` | Core (§40) |
| Forum post likes | `forum_post_likes` | Forum plugin |

```sql
-- Core-owned (profile_comment_likes mirrors article_comment_likes pattern)
profile_comment_likes
  id            TEXT PRIMARY KEY,
  comment_id    TEXT NOT NULL REFERENCES profile_comments(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (comment_id, user_id)
```

The `like_count_received` counter on users is incremented/decremented by a BullMQ job triggered on like/unlike events across all three sources. The counter counts likes received on content the user authored — not likes the user gave.

---

## 46. Article Entity Schema

The core CMS entity. Never explicitly defined until now.

```sql
articles
  id                TEXT PRIMARY KEY,
  author_id         TEXT NOT NULL REFERENCES users(id),
  category_id       TEXT NULL REFERENCES article_categories(id) ON DELETE SET NULL,
  title             TEXT NOT NULL,
  slug              TEXT NOT NULL UNIQUE,
  excerpt           TEXT NULL,                   -- shown in listings; auto-generated if blank
  body              JSONB NOT NULL,              -- TipTap ProseMirror JSON (never raw HTML)
  featured_image    TEXT NULL,                   -- storage path
  status            TEXT NOT NULL DEFAULT 'draft',  -- 'draft' | 'review' | 'published'
  visibility        TEXT NOT NULL DEFAULT 'public', -- 'public' | 'members' | 'private'
  seo_title         TEXT NULL,
  seo_description   TEXT NULL,
  published_at      TIMESTAMPTZ NULL,            -- null until first publish
  deleted_at        TIMESTAMPTZ NULL,            -- soft delete
  deleted_by_id     TEXT NULL,
  like_count        INT NOT NULL DEFAULT 0,      -- denormalized, updated by BullMQ on like/unlike
  comment_count     INT NOT NULL DEFAULT 0,      -- denormalized, updated on comment create/delete
  body_plain        TEXT NULL,                   -- plain text extracted from TipTap HTML for search
  search_vector     TSVECTOR,                    -- maintained by trigger on title + excerpt + body_plain
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()

tags
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE,
  slug  TEXT NOT NULL UNIQUE

article_tags
  article_id  TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  tag_id      TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (article_id, tag_id)

article_likes
  id          TEXT PRIMARY KEY,
  article_id  TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (article_id, user_id)

article_comment_likes
  id          TEXT PRIMARY KEY,
  comment_id  TEXT NOT NULL REFERENCES article_comments(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (comment_id, user_id)
```

**Note on `body_plain`:** TipTap serialises content as HTML or JSON. The `body_plain` column stores a plain text extraction (stripped of all tags) updated on every article save. The `search_vector` trigger indexes `title`, `excerpt`, and `body_plain` — never raw HTML. A server-side utility strips tags on each save before updating `body_plain`.

**Article status rules:**
- `draft` — visible only to the author and admins
- `review` — visible to editors and admins; not publicly listed
- `published` — visible per `visibility` setting
- `published_at` is set on first publish; re-publishing an already-published article does not reset it

**Visibility:**
- `public` — anyone including guests
- `members` — logged-in users only
- `private` — author and admins only

---

## 47. Article Revisions

Articles maintain a revision history on every save. Revisions are full body snapshots, not diffs — simpler to implement and query, acceptable storage cost for text content.

```sql
article_revisions
  id          TEXT PRIMARY KEY,
  article_id  TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  author_id   TEXT NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,          -- full body snapshot at time of save
  title       TEXT NOT NULL,          -- title at time of save
  created_at  TIMESTAMPTZ DEFAULT NOW()
```

**Retention policy:** last 20 revisions per article, enforced by a BullMQ cleanup job. Oldest revisions beyond the limit are hard-deleted. ACP setting: `articles.max_revisions_per_article` (default `20`, minimum `5`).

**Revision triggers:** a new revision is created on every save of a published article, and on every status transition (draft → review → published). Draft saves do not create revisions until the article is first published.

**ACP permission:** `article.revisions.view` — who can see the revision history. `article.revisions.restore` — who can restore a previous version.

---

## 48. Audit Log

Referenced throughout the document as "foundation only" — here is what that means concretely.

### Schema

```sql
audit_log
  id          TEXT PRIMARY KEY,
  actor_id    TEXT NULL,             -- null = SYSTEM
  actor_type  TEXT NOT NULL,         -- 'user' | 'system'
  action      TEXT NOT NULL,         -- e.g. "user.banned", "plugin.enabled", "group.permission_changed"
  target_type TEXT NULL,             -- e.g. "user", "plugin", "group"
  target_id   TEXT NULL,
  meta        JSONB NULL,            -- any relevant context (old value, new value, reason, etc.)
  ip_address  TEXT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
```

### Events Written in v1 (Core)

| Action | Trigger |
|---|---|
| `user.banned` | Moderator issues a ban |
| `user.warned` | Moderator issues a warning |
| `user.warning_pardoned` | Warning pardoned |
| `user.ban_lifted` | Ban lifted |
| `user.promoted` | Progression engine promotes user |
| `user.group_changed` | Admin manually changes user's group |
| `user.username_changed` | Username changed (by user or admin) |
| `user.deleted` | Account deactivated |
| `moderation.policy_changed` | Moderation policy saved |
| `plugin.installed` | Plugin installed |
| `plugin.enabled` | Plugin enabled |
| `plugin.disabled` | Plugin disabled |
| `plugin.uninstalled` | Plugin uninstalled |
| `license.activated` | License activated |
| `license.deactivated` | License deactivated |
| `settings.changed` | System settings saved |
| `group.permission_changed` | Group permissions edited |
| `article.published` | Article published |
| `article.deleted` | Article soft-deleted |

### "Foundation Only" Means

- Schema is defined and writes are wired in Phase 2
- Events are written from the relevant modules as each is built
- ACP audit log viewer is NOT in v1 scope — entries are written but not exposed in the UI
- A future admin plugin or v2 core update exposes the audit log viewer
- The data is there and queryable directly for now

---

## 49. Core Database Schema Supplement

All tables not yet defined in their own dedicated sections. This includes the foundational tables every other module depends on, plus `error_log` and `style_history` which are referenced in §13 and §12 respectively but defined here for consolidation. All tables in this section are created in Phase 2.

### Users

```sql
users
  id                  TEXT PRIMARY KEY,
  username            TEXT NOT NULL UNIQUE,
  email               TEXT NOT NULL UNIQUE,
  password_hash       TEXT NOT NULL,
  display_name        TEXT NULL,
  avatar              TEXT NULL,          -- storage path
  bio                 TEXT NULL,
  group_id            TEXT NOT NULL REFERENCES groups(id),

  -- Email state
  email_verified_at   TIMESTAMPTZ NULL,   -- null = unverified

  -- Username history
  username_changed_at TIMESTAMPTZ NULL,   -- null = never changed

  -- Activity counters (denormalized — §38)
  post_count          INT NOT NULL DEFAULT 0,
  thread_count        INT NOT NULL DEFAULT 0,
  article_count       INT NOT NULL DEFAULT 0,
  like_count_received INT NOT NULL DEFAULT 0,

  -- Social counters (denormalized — §36)
  follower_count      INT NOT NULL DEFAULT 0,
  following_count     INT NOT NULL DEFAULT 0,

  -- Status
  banned_until        TIMESTAMPTZ NULL,   -- null = not currently banned
  deleted_at          TIMESTAMPTZ NULL,   -- soft delete (account deactivation)

  -- Search
  search_vector       TSVECTOR,           -- maintained by trigger on username + display_name + bio

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
```

### Groups and RBAC

```sql
groups
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  is_protected BOOL NOT NULL DEFAULT FALSE,  -- system groups cannot be deleted
  created_at   TIMESTAMPTZ DEFAULT NOW()

-- Permission keys — core and plugin-registered
permissions
  key        TEXT PRIMARY KEY,   -- e.g. "article.publish"
  label      TEXT NOT NULL,
  domain     TEXT NOT NULL,      -- e.g. "Article" — becomes section header in group editor
  plugin_id  TEXT NULL           -- null = core; set if declared by a plugin

-- Many-to-many: which permissions a group has
group_permissions
  group_id       TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  PRIMARY KEY (group_id, permission_key)
```

Note: `users.group_id` holds the user's single active group. The progression system changes this single field when promoting. Users inherit all permissions of their group via `group_permissions`.

### Settings

```sql
settings
  key        TEXT PRIMARY KEY,    -- namespaced e.g. "users.username_change_cooldown_days"
  value      JSONB NOT NULL,       -- stores any scalar or object
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT NULL REFERENCES users(id)
```

All module configuration uses this table. The key namespace pattern is `{module}.{setting_name}`. Reads are cached in Redis with a short TTL for frequently accessed settings.

### Installed Plugins

```sql
installed_plugins
  id               TEXT PRIMARY KEY,    -- manifest id e.g. "nodevo-forum"
  name             TEXT NOT NULL,
  vendor           TEXT NOT NULL,
  installed_version TEXT NOT NULL,
  status           TEXT NOT NULL,       -- 'installed' | 'enabled' | 'disabled'
  license_required BOOL NOT NULL DEFAULT FALSE,
  package_path     TEXT NOT NULL,       -- path to stored .nvplugin file
  manifest         JSONB NOT NULL,      -- full parsed manifest
  installed_at     TIMESTAMPTZ DEFAULT NOW(),
  enabled_at       TIMESTAMPTZ NULL,
  disabled_at      TIMESTAMPTZ NULL
```

### Licenses

```sql
licenses
  id               TEXT PRIMARY KEY,
  license_key      TEXT NOT NULL UNIQUE,
  site_id          TEXT NOT NULL,        -- UUID generated at install, stored in settings as 'site.id'
  entitlement_jwt  TEXT NOT NULL,        -- RS256 signed JWT from license server
  status           TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'expired' | 'deactivated'
  activated_at     TIMESTAMPTZ DEFAULT NOW(),
  expires_at       TIMESTAMPTZ NULL,
  refresh_after    TIMESTAMPTZ NULL
```

**`site_id`** is a UUID generated once during the installer (step 6) and stored in `settings` under the key `site.id`. It is sent alongside the license key when activating and forms part of the signed entitlement JWT, ensuring the token is bound to this specific installation.

### Security Events

```sql
security_events
  id             TEXT PRIMARY KEY,
  user_id        TEXT NULL REFERENCES users(id) ON DELETE SET NULL,  -- null for failed logins
  event_type     TEXT NOT NULL,   -- 'login.success' | 'login.failure' | 'password.changed' | 'token.rotated' | 'suspicious.new_device'
  ip_address     TEXT NULL,
  user_agent     TEXT NULL,
  device_cookie  TEXT NULL,       -- optional first-party identifier (§15)
  session_id     TEXT NULL,
  meta           JSONB NULL,      -- e.g. { attempted_email: hash } for login failures
  created_at     TIMESTAMPTZ DEFAULT NOW()
```

### Moderation Tables

```sql
moderation_reports
  id           TEXT PRIMARY KEY,
  target_type  TEXT NOT NULL,    -- 'article'|'article_comment'|'profile_comment'|'user'|'plugin-content'
  target_id    TEXT NOT NULL,
  reporter_id  TEXT NOT NULL REFERENCES users(id),
  assigned_to  TEXT NULL REFERENCES users(id),
  reason       TEXT NOT NULL,
  notes        TEXT NULL,        -- internal moderator notes
  status       TEXT NOT NULL DEFAULT 'pending',  -- 'pending'|'reviewed'|'resolved'|'dismissed'
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ NULL,
  resolved_by  TEXT NULL REFERENCES users(id)

moderation_warnings
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  issued_by     TEXT NOT NULL REFERENCES users(id),
  reason        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',  -- 'active'|'expired'|'pardoned'
  expires_at    TIMESTAMPTZ NULL,
  pardoned_at   TIMESTAMPTZ NULL,
  pardoned_by   TEXT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()

moderation_bans
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  issued_by   TEXT NOT NULL REFERENCES users(id),
  type        TEXT NOT NULL,    -- 'temporary' | 'permanent'
  reason      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active',  -- 'active'|'expired'|'lifted'
  expires_at  TIMESTAMPTZ NULL,              -- null for permanent
  lifted_at   TIMESTAMPTZ NULL,
  lifted_by   TEXT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()

-- Review cases from security event correlations (§15)
moderation_cases
  id               TEXT PRIMARY KEY,
  type             TEXT NOT NULL,      -- e.g. 'multi_account_suspicion' | 'rapid_registration'
  severity         TEXT NOT NULL,      -- 'low' | 'medium' | 'high'
  status           TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'reviewed' | 'dismissed'
  signals          JSONB NOT NULL,     -- detected signals array
  linked_user_ids  TEXT[] NOT NULL,
  reviewed_by      TEXT NULL REFERENCES users(id),
  reviewed_at      TIMESTAMPTZ NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW()

moderation_log
  id          TEXT PRIMARY KEY,
  actor_id    TEXT NULL REFERENCES users(id),  -- null = SYSTEM
  actor_type  TEXT NOT NULL,    -- 'user' | 'system'
  action      TEXT NOT NULL,    -- e.g. "ban.issued" | "warning.pardoned"
  target_type TEXT NULL,
  target_id   TEXT NULL,
  reason      TEXT NULL,
  meta        JSONB NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
```

### User Privacy Settings

```sql
user_privacy_settings
  user_id   TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  settings  JSONB NOT NULL DEFAULT '{}'
  -- stored keys: allow_profile_comments, who_can_comment, who_can_follow,
  --              show_followers_public, show_following_public, hide_blocked_content,
  --              profile_visibility, post_history_visibility, email_notifications (object)
```

### User Deactivation (Soft Delete)

When `users.deleted_at` is set (account deactivated):

| Content | Behaviour |
|---|---|
| Profile page | Returns 404 |
| Articles | Remain visible; author shown as **[Deleted User]** |
| Article comments | Remain visible (or tombstoned if mod-deleted); author shown as **[Deleted User]** |
| Forum posts | Remain visible; author shown as **[Deleted User]** |
| Profile comments they wrote | Remain visible; author shown as **[Deleted User]** |
| Profile comments on their wall | Wall inaccessible (profile 404) |
| Username | **Reserved** — not freed for reuse. Prevents impersonation of deactivated accounts |
| Sessions | All `refresh_tokens` rows deleted immediately on deactivation |
| Followers/following | Counts preserved for data integrity; relationships remain in DB |

Admins can reactivate a deactivated account (clear `deleted_at`). The username is preserved specifically to allow reactivation without collision.

All created in Phase 2 migrations. Composite indexes documented inline in Prisma schema as `@@index` decorators or via raw SQL migrations.

| Table | Index columns | Purpose |
|---|---|---|
| `articles` | `(status, published_at DESC)` | Article listing by status |
| `articles` | `(category_id, status)` | Category article listing |
| `articles` | `(author_id, status)` | User's articles |
| `articles` | `search_vector` (GIN) | Full-text search |
| `article_comments` | `(article_id, deleted_at)` | Comment listing per article |
| `article_categories` | `(parent_id, position)` | Category tree queries |
| `user_follows` | `(follower_id)` | Who this user follows |
| `user_follows` | `(following_id)` | Who follows this user |
| `notifications` | `(user_id, read_at, created_at DESC)` | Unread notifications per user |
| `moderation_reports` | `(status, created_at DESC)` | Report queue |
| `moderation_warnings` | `(user_id, status)` | Active warnings per user |
| `moderation_bans` | `(user_id, status)` | Active bans per user |
| `security_events` | `(user_id, event_type, created_at DESC)` | Auth event history |
| `refresh_tokens` | `(user_id)` | Sessions per user |
| `refresh_tokens` | `(token_hash)` | Token lookup on refresh |
| `group_progression` | `(ladder_position)` | Next level lookup |
| `audit_log` | `(action, created_at DESC)` | Audit log filtering |
| `error_log` | `(severity, created_at DESC)` | Error log filtering |
| `users` | `search_vector` (GIN) | User search |
| `nav_items` | `(parent_id, position)` | Nav tree ordering |
| `profile_comments` | `(profile_user_id, deleted_at, created_at DESC)` | Profile wall |

### Notification Preference Pattern Matching

The `type_pattern` field in `notification_preferences` uses **prefix matching**:
- `"*"` matches all notification types
- `"forum.*"` matches any type starting with `"forum."`
- `"moderation.*"` matches moderation types
- An exact string (e.g. `"auth.suspicious_login"`) matches only that type

On dispatch, the service finds all preferences where the notification type starts with the pattern (or pattern is `"*"`). The most specific matching preference wins. If no preference record exists for a given type, the default is `in_app: true, email: false`.

### Error Log

```sql
error_log
  id         TEXT PRIMARY KEY,
  code       TEXT NOT NULL,        -- NEC error code e.g. "NEC-PLUGIN-2001"
  message    TEXT NOT NULL,
  context    JSONB NULL,
  severity   TEXT NOT NULL,        -- 'info' | 'warn' | 'error' | 'critical'
  request_id TEXT NULL,            -- trace ID for correlating request logs
  user_id    TEXT NULL,            -- authenticated user at time of error (if any)
  created_at TIMESTAMPTZ DEFAULT NOW()
```

The global error middleware writes every `NodevoError` instance to this table. Stack traces are logged by Pino but never persisted to the DB.

### Style History

```sql
style_history
  id         TEXT PRIMARY KEY,
  label      TEXT NOT NULL,        -- e.g. "Custom save" or "Before ocean theme test"
  tokens     JSONB NOT NULL,       -- snapshot of all semantic token values at save time
  saved_by   TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
```

Last N entries retained (ACP setting: `appearance.max_style_history`, default `20`). Restore writes the snapshot tokens back to the active style. Preview renders the snapshot in the live preview without saving.

---

## 50. Frontend Nav Manager

Admins control the public frontend navbar from **ACP → Appearance → Navigation**. The nav is fully dynamic — links can be added, reordered, toggled, and configured with per-group visibility.

### Data Model

```sql
nav_items
  id                TEXT PRIMARY KEY,
  label             TEXT NOT NULL,
  url               TEXT NOT NULL,             -- relative (/articles) or absolute (https://...)
  icon              TEXT NULL,                 -- optional icon identifier
  position          INT NOT NULL DEFAULT 0,    -- sort order
  parent_id         TEXT NULL REFERENCES nav_items(id) ON DELETE CASCADE,  -- one level of dropdown
  is_active         BOOL NOT NULL DEFAULT TRUE,
  is_system         BOOL NOT NULL DEFAULT FALSE,  -- Home, Articles — cannot be deleted, only deactivated
  plugin_id         TEXT NULL,                 -- set when registered by a plugin (auto-hidden on plugin disable)
  open_in_new_tab   BOOL NOT NULL DEFAULT FALSE,

  -- Visibility (same model as category access)
  visibility        TEXT NOT NULL DEFAULT 'public',  -- 'public' | 'members' | 'groups'
  visibility_groups TEXT[] NOT NULL DEFAULT '{}',

  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
```

### Item Types

| Type | `is_system` | `plugin_id` | Can delete | Can hide |
|---|---|---|---|---|
| System links (Home, Articles) | true | null | No | Yes |
| Plugin-registered (Forum) | false | `"nodevo-forum"` | No (auto-removed on uninstall) | Yes |
| Admin-created custom links | false | null | Yes | Yes |

### Plugin Nav Registration

The Forum plugin registers its nav item via the plugin-sdk. The engine automatically deactivates plugin-registered items when a plugin is disabled and removes them on uninstall:

```typescript
// In forum plugin onEnable():
plugin.registerNavItem({
  label:    'Forum',
  url:      '/forum',
  position: 3,        // suggested position (admin can reorder)
});
```

### ACP → Appearance → Navigation

- Full drag-and-drop tree (top-level items + one level of dropdown children)
- Drag handle `⠿` to reorder; drag into another item to nest (max 1 level deep)
- Toggle active/inactive inline per item
- Edit: label, URL, icon, open in new tab, visibility (public / members / specific groups via `GroupAccessPicker`)
- **+ Add Link** button → modal: label, URL, icon, open in new tab, visibility
- Delete custom links; system and plugin links show a disabled delete button with tooltip "Managed by system / plugin"
- Live preview strip showing how the nav renders in light + dark mode
- "Reset to defaults" restores the seeded system items in their original order

### Seeded Default Items

The installer seeds these nav items:

| Label | URL | is_system | Position |
|---|---|---|---|
| Home | / | true | 1 |
| Articles | /articles | true | 2 |

The Forum plugin adds its item at position 3 when installed and enabled.

### Visibility in the Frontend

The nav component calls `GET /api/nav-items` on load. The API filters items by:
1. `is_active = true`
2. Visibility check against the current user (same `userCanSeeNode()` logic)

Hidden items are not present in the response — no empty slots, no placeholder text.

### API Route

```
GET  /api/nav-items                ← public, returns visible items for current user
GET  /api/admin/nav-items          ← admin, returns all items including inactive
POST /api/admin/nav-items          ← create custom link
PUT  /api/admin/nav-items/:id      ← update
PUT  /api/admin/nav-items/reorder  ← update positions (array of {id, position})
DELETE /api/admin/nav-items/:id    ← delete (custom links only)
```

---

## 51. Branding and Logo Management

Admins configure site branding from **ACP → Appearance → Branding**.

### Two Logo Variants

| Variant | Usage | Recommended size | ACP setting key |
|---|---|---|---|
| **Navbar logo** | Full horizontal lockup in the top nav | 160×40px | `appearance.logo.navbar` |
| **Site icon** | Favicon, browser tab, mobile home screen, ACP sidebar compact state | 64×64px | `appearance.logo.icon` |

Each variant can be:
- **Uploaded** — stored at `themes/logo/navbar.{ext}` or `themes/logo/icon.{ext}` via StorageService
- **Linked** — an external URL stored directly as the setting value
- **Default** — setting value is `null`; the frontend renders the built-in Nodevo wordmark/mark

The setting value is always a single string (storage path, external URL, or null). The frontend reads `GET /api/appearance/branding` which returns the resolved public URLs (or null for both if using defaults).

### Upload Limits

Added to `config/upload-limits.ts`:

```typescript
NAVBAR_LOGO: { maxBytes: 2 * 1024 * 1024,  allowedMimeTypes: ['image/png', 'image/svg+xml', 'image/webp'] },
SITE_ICON:   { maxBytes: 512 * 1024,        allowedMimeTypes: ['image/png', 'image/x-icon', 'image/svg+xml'] },
```

MIME validated against magic bytes as with all uploads. SVG is allowed here because it's served as a static asset from admin-controlled storage — not rendered as HTML.

### Storage Access

`themes/logo/` added to the publicly served storage paths (alongside `avatars/` and `articles/`):

```
Public (served via /uploads):
  avatars/
  articles/
  themes/logo/      ← navbar logo + site icon
```

### Responsive Behaviour

The nav component renders both images. CSS controls visibility:

```html
<!-- Always in DOM; CSS shows/hides based on breakpoint -->
<img class="nav-logo-full" src="{navbarLogoUrl}" alt="{siteName}" />
<img class="nav-logo-icon" src="{siteIconUrl}"   alt="{siteName}" />
```

```css
/* Mobile: show icon only */
@media (max-width: 768px) {
  .nav-logo-full { display: none; }
  .nav-logo-icon { display: block; }
}
/* Desktop: show full logo */
@media (min-width: 769px) {
  .nav-logo-full { display: block; }
  .nav-logo-icon { display: none; }
}
```

If only one variant is set, the same image is used for both breakpoints. If neither is set, the text-based default wordmark is shown.

### ACP → Appearance → Branding

- **Navbar logo** section: drag-drop upload zone + URL input field + preview at 160×40
- **Site icon** section: drag-drop upload zone + URL input field + preview at 32×32 and 64×64
- **Site name in nav** toggle: show/hide the site name text alongside the logo
- **Reset to default** button per variant — clears the setting, reverts to built-in mark

### API Routes

```
GET  /api/appearance/branding         ← public; returns resolved logo URLs + site name setting
POST /api/admin/appearance/logo/:variant  ← upload (multipart) or JSON { url: "..." }
DELETE /api/admin/appearance/logo/:variant ← reset variant to default
```

`:variant` = `navbar` | `icon`

---

## 52. Premium Groups — v2 Foundation

### Intent

In v2, admins will be able to configure certain groups as purchasable. Users visit a dedicated upgrade page, pay (via Stripe or another configured provider), and are automatically promoted to the purchased group. Subscriptions can be one-time, monthly, or yearly.

**In v1 we define the schema, reserve the route, and stub the ACP tab.** Nothing processes payments in v1. The architecture is designed so v2 plugs in without migrations that alter existing rows in complex ways.

### Schema — Added to `group_progression`

```sql
-- All NULL/FALSE in v1 — populated in v2 when pricing is configured
is_purchasable  BOOL NOT NULL DEFAULT FALSE,
price_cents     INT NULL,    -- e.g. 999 = $9.99; NULL = not for sale
currency        TEXT NULL,   -- ISO 4217 e.g. 'USD', 'EUR'
billing_type    TEXT NULL    -- 'one_time' | 'monthly' | 'yearly'
```

### New Tables (defined in Phase 2, empty in v1)

```sql
user_subscriptions
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  group_id        TEXT NOT NULL REFERENCES groups(id),
  status          TEXT NOT NULL,   -- 'active' | 'cancelled' | 'expired' | 'past_due'
  billing_type    TEXT NOT NULL,   -- 'one_time' | 'monthly' | 'yearly'
  current_period_start  TIMESTAMPTZ NULL,
  current_period_end    TIMESTAMPTZ NULL,
  cancelled_at          TIMESTAMPTZ NULL,
  provider_subscription_id TEXT NULL,   -- Stripe subscription ID, etc.
  created_at      TIMESTAMPTZ DEFAULT NOW()

payments
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  subscription_id TEXT NULL REFERENCES user_subscriptions(id),
  amount_cents    INT NOT NULL,
  currency        TEXT NOT NULL,
  status          TEXT NOT NULL,   -- 'pending' | 'succeeded' | 'failed' | 'refunded'
  provider        TEXT NOT NULL,   -- e.g. 'stripe'
  provider_payment_id TEXT NULL,   -- Stripe charge/payment intent ID
  created_at      TIMESTAMPTZ DEFAULT NOW()
```

### Payment Provider Interface (packages/contracts)

```typescript
// packages/contracts/src/payment.types.ts

export interface PaymentProvider {
  name: string;

  /** Create a checkout session and return the redirect URL */
  createCheckout(opts: {
    userId:       string;
    groupId:      string;
    priceCents:   number;
    currency:     string;
    billingType:  'one_time' | 'monthly' | 'yearly';
    successUrl:   string;
    cancelUrl:    string;
  }): Promise<{ checkoutUrl: string; providerSessionId: string }>;

  /** Handle incoming webhook events from the provider */
  handleWebhook(payload: Buffer, signature: string): Promise<WebhookEvent>;

  /** Cancel an active subscription */
  cancelSubscription(providerSubscriptionId: string): Promise<void>;
}

// v1: no implementation. v2: StripePaymentProvider implements this.
// TODO v2: inject via plugin.registerPaymentProvider(provider)
```

### v1 ACP Placeholder

In ACP → Access Control → Groups → \[Group\] → **Pricing tab**:

```
Pricing                                          [Available in v2]
─────────────────────────────────────────────────────────────────
Enable paid access to this group

  [ ] Users can purchase access to this group

  Monthly price   [disabled]
  Yearly price    [disabled]
  One-time price  [disabled]

  ℹ Payment processing will be available in Nodevo v2.
    Schema and infrastructure are in place.
```

The tab is visible so admins understand the capability is coming. All controls are disabled in v1. The placeholder prevents surprise at v2's config location.

### Reserved Route

`/upgrade` is reserved in the frontend router in v1:

```tsx
// In v1: shows "Coming soon" or redirects to home
// In v2: shows the purchasable groups listing with Stripe Checkout integration
<Route path="/upgrade" element={<UpgradePage />} />
```

### Subscription Expiry Job (v2)

A daily BullMQ job checks for expired subscriptions:
- Sets `user_subscriptions.status = 'expired'`
- Reverts user to the default Member group (or the group they were in before upgrading)
- Sends `subscription.expired` notification

This job is defined but inert in v1 — no active subscriptions exist to expire.

### What v2 Actually Builds

1. `StripePaymentProvider` implementing `PaymentProvider` in `core/payment-engine/`
2. Webhook endpoint `POST /api/payments/webhook/:provider`
3. The `/upgrade` page with group listings, Stripe Checkout
4. Subscription management in Account Settings (cancel, billing history)
5. ACP Pricing tab controls unlocked
6. Subscription expiry job activated
7. ACP → Extensions → Payments (configure provider, test webhooks)

---

## 53. Marketplace & Entitlement (ADR 0001)

Full rationale in `docs/adr/0001-marketplace-entitlement.md`. This section is the
implementation contract. It promotes §11's "v2 account connection" idea into **v1
core** and reshapes enforcement to match how WoltLab/XenForo/Invision actually ship.

### Core principles
- **License grain = per-domain.** One purchase entitles one production domain.
  Non-production activations (`staging`, `development`) are flagged and never count
  against the cap, nor are they domain-locked.
- **Enforcement chokepoint = the authenticated download, not runtime.** The
  marketplace answers "does account X + domain D own plugin P?" and only then issues
  a domain-bound entitlement. Runtime verification stays light.
- **Account connection is server↔server.** The admin authorizes once with an auth
  code; the resulting token lives in `settings` (`marketplace.<source>.token`),
  attached to every source call. **Never** in the browser / localStorage. The manual
  license key is the offline fallback, exchanged for the same domain-bound entitlement.

### Domain binding
- The entitlement JWT carries `domain` + `environment` claims alongside the existing
  `siteId` / `entitlements[]` / `expiresAt` / `refreshAfter`.
- `licenses` gains nullable `domain` + `environment` columns (migration
  `20260602000000_add_license_domain_environment`).
- `environment` is derived once from `NODE_ENV` + the `APP_URL` host
  (`license-engine.resolveEnvironment()`). Domain mismatch is enforced **only** in
  `production` → `NEC-LICENSE-9003`. Dev/CI/staging are never domain-locked.

### Interfaces (`packages/contracts`)
- `MarketplaceSource` (`marketplace.ts`) — the download gate:
  `connect` / `disconnect` / `getConnection` / `listPlugins` / `authorizeDownload`.
  Core talks to a *source*; community/self-hosted sources implement the same interface.
- `EntitlementProvider` (`entitlement.ts`) — the light runtime: `check` / `refresh`,
  returning an `EntitlementStatus` (`valid` | `grace` | `expired` | `domain_mismatch`
  | `missing`). Honors the 30-day grace (§11) — running plugins are never bricked.

### Implementations (`apps/api/src/core/license-engine`)
- `license-engine.ts` — domain-bound activate/refresh/verify;
  `getEntitlementStatus()` + `isPluginEntitled()` (domain-aware); `provisionEntitlement()`
  mints an entitlement at the gate (dev signs locally, prod calls the server).
- `entitlement-provider.ts` — `entitlementProvider` implementing `EntitlementProvider`.
- `marketplace-source.ts` — `marketplaceSource` (the nodevo.io source) implementing
  `MarketplaceSource`; dev catalogue mirror; prod proxies to `LICENSE_SERVER_URL`.

### NEC codes (`NEC-LICENSE-9xxx`)
`9001` not-found · `9002` expired · `9003` domain-mismatch · `9004` cap-reached
(download gate) · `9005` account-required · `9006` token-invalid · `9007`
source-unreachable (grace applies).

### API (ACP → Extensions, `admin.access`)
```
GET    /api/admin/marketplace/plugins        ← catalogue mirror (paginated)
GET    /api/admin/marketplace/connection     ← connection state (no secret)
POST   /api/admin/marketplace/connection     ← { authCode } → connect
DELETE /api/admin/marketplace/connection     ← disconnect
POST   /api/admin/marketplace/authorize      ← { pluginId, version } → AuthorizedDownload (the gate)
GET    /api/admin/license                     ← manual-key fallback (unchanged)
POST   /api/admin/license/activate
POST   /api/admin/license/refresh
DELETE /api/admin/license
```

### Authoritative vs. local
The **activation cap** (count of production domains per purchase) is authoritative on
the marketplace server. Core records only the single domain *this* site is bound to and
proves it at the gate. Heavier concerns (purchase records, re-bind UI) live on nodevo.io.

### Open follow-ups (not blocking)
- Self-service domain re-bind on site migration (`MarketplaceSource.reactivate?`).
- Encryption-at-rest for the connection token in `settings` (currently plain JSON).
- Short prod token TTL (~7d / refresh 1d) — server-side policy, transparent to core.

---

## 55. Infrastructure Configuration

### Process Architecture

Nodevo runs as two separate processes in production:

```
Process 1: apps/api/src/server.ts   — Express HTTP server
Process 2: apps/api/src/worker.ts   — BullMQ worker process
```

Both processes connect to the same PostgreSQL database and Redis instance. Both import shared infrastructure modules (DB client, Redis client, queue definitions). The worker process registers all job handlers; the server process only enqueues jobs — it does not process them.

Docker Compose (development):
```yaml
services:
  api:    command: pnpm --filter api dev:server
  worker: command: pnpm --filter api dev:worker
  web:    command: pnpm --filter web dev
  db:     image: postgres:17
  redis:  image: redis:7-alpine
```

### Express Configuration Checklist

Critical settings that must be present in `app/app.ts`:

```typescript
// Trust first proxy (nginx, Cloudflare) for accurate req.ip in rate limiters + security_events
// Without this, all IPs appear as the proxy IP — rate limiting and abuse detection are useless
app.set('trust proxy', 1);

// Increase body size limit for TipTap JSONB articles (default 100KB is too small)
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: true, limit: '4mb' }));
```

**`trust proxy` is a security-critical setting** — rate limiting and IP-based security event logging depend on it. Without it, the entire anti-abuse telemetry foundation logs proxy IPs, not client IPs.

### Graceful Shutdown

The server and worker processes must handle `SIGTERM` (Docker stop, Kubernetes rolling update) gracefully:

```typescript
// server.ts
const server = app.listen(PORT);

process.on('SIGTERM', async () => {
  server.close(async () => {       // stop accepting new connections
    await prisma.$disconnect();    // close DB pool
    await redis.quit();            // close Redis connection
    await bullmqScheduler.close(); // drain active jobs
    process.exit(0);
  });
});
```

Without graceful shutdown, in-flight requests are dropped and DB connections leak, causing errors on the next deploy.

All Redis keys are prefixed with `REDIS_KEY_PREFIX` (env var, default `"nodevo"`). This prevents key collision when multiple Nodevo instances or environments share the same Redis instance.

```typescript
// infrastructure/redis/redis.client.ts
const prefix = process.env.REDIS_KEY_PREFIX ?? 'nodevo';

export function rkey(key: string): string {
  return `${prefix}:${key}`;
}

// Usage everywhere:
redis.get(rkey(`perm:user:${userId}`))    // → "nodevo:perm:user:abc123"
redis.get(rkey(`settings:cache`))          // → "nodevo:settings:cache"
```

BullMQ queue names also include the prefix:
```typescript
new Queue(`${prefix}:email`, { connection: redis });
new Queue(`${prefix}:notifications`, { connection: redis });
```

### PostgreSQL Connection Pool

`DATABASE_URL` must include `?connection_limit=N`. Recommended sizing:

| Environment | connection_limit | Reasoning |
|---|---|---|
| Development | `5` | Single developer, low traffic |
| Staging | `10` | Moderate load testing |
| Production | `20` | Express server + BullMQ workers combined |

PostgreSQL's `max_connections` (default 100) must be greater than all connection pools combined across all application processes. Monitor with `pg_stat_activity`.

### Rate Limiting — Redis-Backed Store

`express-rate-limit` with in-memory storage is per-process and breaks under multiple processes. Use `rate-limit-redis` for shared rate limit state:

```typescript
import RedisStore from 'rate-limit-redis';
import { rateLimit } from 'express-rate-limit';
import { RATE_LIMITS } from '../config/rate-limits';

export const authLoginLimiter = rateLimit({
  ...RATE_LIMITS.AUTH_LOGIN,
  store: new RedisStore({ sendCommand: (...args) => redis.sendCommand(args) }),
  keyGenerator: (req) => req.ip ?? 'unknown',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ code: 'NEC-API-4290', message: 'Rate limit exceeded' }),
});
```

All rate limiters in `shared/middleware/rate-limiter.ts` use Redis store.

### File Upload Size Limits

Configured in `config/upload-limits.ts`, enforced by multer:

```typescript
export const UPLOAD_LIMITS = {
  AVATAR:         { maxBytes: 2  * 1024 * 1024, allowedMimeTypes: ['image/jpeg','image/png','image/gif','image/webp'] },
  FEATURED_IMAGE: { maxBytes: 5  * 1024 * 1024, allowedMimeTypes: ['image/jpeg','image/png','image/gif','image/webp'] },
  ARTICLE_IMAGE:  { maxBytes: 5  * 1024 * 1024, allowedMimeTypes: ['image/jpeg','image/png','image/gif','image/webp'] },
  NAVBAR_LOGO:    { maxBytes: 2  * 1024 * 1024, allowedMimeTypes: ['image/png','image/svg+xml','image/webp'] },
  SITE_ICON:      { maxBytes: 512 * 1024,        allowedMimeTypes: ['image/png','image/x-icon','image/svg+xml'] },
  PLUGIN_PACKAGE: { maxBytes: 50 * 1024 * 1024, allowedMimeTypes: ['application/zip','application/octet-stream'] },
  STYLE_PACK:     { maxBytes: 10 * 1024 * 1024, allowedMimeTypes: ['application/zip','application/octet-stream'] },
} as const;
```

Uploads exceeding the limit return `NEC-STORE-7001` (file too large). Uploads with a disallowed type for the user's group level return `NEC-STORE-7002` (file type not permitted for your level).

### BullMQ Job Reliability

Each queue is configured with retry + dead-letter:

```typescript
const defaultJobOptions: DefaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { count: 100 },
  removeOnFail:     { count: 500 },  // keep failed jobs for inspection
};
```

Critical queues (email, license refresh) have a dead-letter queue and trigger a `system.job_failure` notification to admins after exhausting retries.

---

## 54. Plugin Engine — Operational Details

### Plugin onStartup — Route Re-registration

When the server starts (or restarts), the plugin engine reads all `installed_plugins` rows with `status = 'enabled'` and calls each plugin's `onEnable()` hook. This re-registers routes, permissions, nav items, notification types, and search content types for every enabled plugin.

```typescript
// core/plugin-engine/plugin-engine.ts — called once at server startup

async function initializeEnabledPlugins(): Promise<void> {
  const enabled = await prisma.installedPlugins.findMany({
    where: { status: 'enabled' }
  });

  for (const plugin of enabled) {
    await loadAndEnable(plugin);   // calls plugin's onEnable() hook
  }
}
```

**This must run before the HTTP server starts accepting connections.** If a plugin's `onEnable()` fails during startup (e.g., missing table), the engine logs the error, disables the plugin, and continues — the server stays up.

Without this, every server restart would silently drop all plugin routes, permissions, and nav items until someone re-enabled each plugin manually.

Plugins register Express routes at runtime without server restart. The plugin engine uses a dedicated Express `Router` per plugin, mounted on the master Express app:

```typescript
// core/plugin-engine/plugin-router.ts

class PluginRouter {
  private routers = new Map<string, Router>();   // pluginId → Router

  mount(app: Express): void {
    // Single middleware that delegates to enabled plugin routers
    app.use('/api/plugins-runtime', (req, res, next) => {
      const handler = this.routers.get(req.header('X-Plugin-Id') ?? '');
      handler ? handler(req, res, next) : next();
    });
  }

  register(pluginId: string, router: Router): void {
    this.routers.set(pluginId, router);
  }

  deregister(pluginId: string): void {
    this.routers.delete(pluginId);
  }
}
```

When a plugin is enabled, its router is added to the map. When disabled, it is removed. No server restart needed. Routes are checked per-request via the middleware chain.

### ACP Dynamic Page Registration

The plugin-sdk's `plugin.registerAcpPage()` writes to an in-memory registry. The frontend ACP sidebar fetches registered pages from:

```
GET /api/admin/registered-pages
→ returns: [ { pluginId, section, label, path, icon }, ... ]
```

The ACP sidebar calls this endpoint on load and merges plugin-registered pages into the nav structure. Pages are grouped under a plugin's declared `section` (e.g., "Forum" appears as a new top-level nav item).

### Plugin Permission Default Group Assignments

When a plugin registers permissions, it can optionally declare default group assignments. This solves the problem of forum permissions not being assigned to any group after install:

```typescript
// In plugin onEnable():
plugin.registerPermissions([
  {
    key:     'forum.thread.create',
    label:   'Create forum threads',
    domain:  'Forum',
    defaults: ['Member', 'Regular', 'Veteran', 'Moderator', 'Supermod', 'Administrator']
    // defaults = group NAMES that should receive this permission on first install
    // Only applied on first install — if admin later removes it, the default is not re-applied
  },
]);
```

The plugin engine checks `group_permissions` — if no row exists for `(groupId, permissionKey)`, it inserts the default. On subsequent enables (re-enable after disable), defaults are NOT re-applied. This prevents overriding admin-configured permissions.

### Plugin Permission Cleanup on Disable and Uninstall

- **Disable**: permissions remain in `permissions` table. Routes deregistered. ACP pages deregistered. Permission keys in `group_permissions` remain — users keep the permissions but the routes that check them are gone. Content is safe.
- **Uninstall**: plugin's permissions removed from `permissions` table → cascade deletes all `group_permissions` rows for those keys. All data tables (via plugin's down migrations) optionally reversed if admin chooses "remove data." Package file deleted from storage.

### Transaction Safety

Multi-step operations that must be atomic:

| Operation | Tables involved | Transaction required |
|---|---|---|
| Follow user | `user_follows` + `follower_count` + `following_count` | Yes — partial updates corrupt counts |
| Unfollow | `user_follows` + counters | Yes |
| Ban user | `moderation_bans` + `users.banned_until` | Yes |
| Lift ban | `moderation_bans.status` + `users.banned_until = null` | Yes |
| Issue warning + threshold check | `moderation_warnings` + potential `moderation_bans` + `users.banned_until` | Yes |
| Progression promotion | `users.group_id` + `audit_log` | Yes |
| Article publish | `articles.status` + `articles.published_at` + `users.article_count` | Yes |
| Plugin install | `installed_plugins` + plugin migration records | Yes |

All implemented via Prisma's `$transaction()`.

### Progression Engine Race Condition

The promotion BullMQ job could run concurrently for the same user (e.g., two likes received in rapid succession both trigger the job). Both jobs check counters, both find threshold met, both promote → double-promotion.

Fix: use a DB-level advisory lock or idempotent check inside a transaction:

```typescript
async function checkPromotion(userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Lock the user row for the duration of this transaction
    const user = await tx.$queryRaw`
      SELECT id, group_id, post_count, article_count, like_count_received
      FROM users WHERE id = ${userId} FOR UPDATE
    `;
    // ... rest of promotion logic inside the same transaction
    // Second concurrent job will wait on the lock, then find user already promoted → exits early
  });
}
```

### Search Visibility at SQL Level

The `userCanSeeNode()` JavaScript function is for request-level checks on a single node. For bulk search queries returning many articles, the access filter must happen in SQL to avoid N+1:

```sql
-- Article search: only return articles whose category the user can access
SELECT a.*, ts_rank(a.search_vector, query) AS rank
FROM articles a
JOIN article_categories c ON c.id = a.category_id
, plainto_tsquery('english', $1) query
WHERE a.search_vector @@ query
  AND a.status = 'published'
  AND a.deleted_at IS NULL
  AND (
    c.effective_visibility = 'public'
    OR (c.effective_visibility = 'members' AND $userLoggedIn = true)
    OR (c.effective_visibility = 'level'   AND $userLadderPos >= c.visibility_min_level)
    OR (c.effective_visibility = 'groups'  AND $userGroupId = ANY(c.visibility_groups))
  )
ORDER BY rank DESC
LIMIT $limit OFFSET $offset;
```

The search service receives the user's `{ isLoggedIn, groupId, ladderPosition }` and builds the WHERE clause appropriately. Articles with no category (`category_id IS NULL`) are treated as `public`.

---

## 56. Build Order (Phases)

Each phase lists what it **produces** and what it **depends on** from earlier phases. ACP pages are always built after the ACP shell (Phase 6). BullMQ workers are built alongside the feature that needs them — not deferred to hardening.

| Phase | Scope |
|---|---|
| **0** | **Repo bootstrap** — monorepo, pnpm workspaces, Turborepo. Initialize all packages: `contracts` (with pagination types, ThemeManifest, visibility mode constants, NEC error domain constants), `sdk`, `ui`, `plugin-sdk` (scaffolded; populated Phase 14), `config`. Docker Compose (PostgreSQL + Redis). ESLint, Prettier, base tsconfig. Vitest + Supertest setup. `config/rate-limits.ts`. **`scripts/seed-dev.ts`** — dev-only seed that creates test admin user + sample groups without going through the installer (run via `pnpm seed:dev`; never runs in production). |
| **1** | **Infrastructure skeleton** — Express app bootstrap with: `app.set('trust proxy', 1)` **(critical — must be first setting, before any middleware)**; `express.json({ limit: '4mb' })`; Helmet with CSP; CORS configured from `APP_URL` env var in production, `http://localhost:5173` in development; cookie-parser; Pino. React + Vite app bootstrap. Zod env validation (`apps/api/src/config/env.ts`). `GET /api/health`. `NodevoError` class + NEC type definitions + global error middleware. Redis connection. BullMQ queue infrastructure (worker process `worker.ts`, `defaultJobOptions`). `StorageProvider` interface + `LocalStorageProvider` + `/uploads` static route serving `avatars/`, `articles/`, and `themes/logo/` subdirectories only. `config/upload-limits.ts`. Three-tier CSS tokens. `ThemeRegistry` stub. `AppLayout` slot constants. `useTheme()` hook. Font registry. Slug utility (with deduplication: appends `-2`, `-3` etc. on conflict). `userCanSeeNode()` access check utility. |
| **2** | **Database + core auth** — Full Prisma schema: all tables from §49 (users with `search_vector`, groups, permissions, group_permissions, settings, installed_plugins, licenses, security_events, moderation tables, user_privacy_settings, error_log, style_history) + §43 `refresh_tokens` + **`password_reset_tokens`** + **`email_verify_tokens`** (both DB-backed single-use tokens, §17b) + §33 `article_comments` + §40 `profile_comments`, `profile_comment_likes` + §45 `article_likes`, `article_comment_likes` + §46 `articles` (body as TipTap JSON), `article_revisions`, `tags`, `article_tags` + §44 `article_categories` + §36 `user_follows`, `user_blocks` + §35 `username_history` + §38 `group_progression` + §37 `user_privacy_settings` + §41 `user_profile_fields`, `user_profile_field_values` + §29 `notifications`, `notification_preferences` + §47 `style_history` + §48 `audit_log` + §28 `nodevo_plugin_migrations` + `migration_runs` + **`nav_items`** (seeded with default Home + Articles items). **DB indexes** per §49. Auth routes (register, login, logout, refresh, password reset request/confirm, email verify). Refresh token rotation. Password change + reset both delete all user refresh tokens (§17b). `SameSite=Strict; HttpOnly; Secure` on refresh cookie. Security events on every auth event. Audit log + error log both wired from day one. RBAC middleware. Basic `NotificationService` (DB writes only). Bootstrap seeding functions (called by Phase 3 installer, not auto-run). Email service stub. |
| **3** | **Installer wizard + email** — Install-guard middleware (blocks all routes except `/api/install/*` if `settings` has no `site.id`). Installer backend: environment check, DB connection test, config write to `settings`, `prisma migrate deploy` (applies Phase 2 schema to the target DB), admin user creation, seeding functions called (groups, permissions, system profile fields), `site.id` UUID generated and stored, self-removal of installer routes. Installer frontend wizard (7 steps). **Email layer fully wired**: Nodemailer, BullMQ email workers with retry config, password-reset + email-verify + welcome templates. From this phase: email sends for real. |
| **4** | **User system — backend + public frontend only** (no ACP pages — those are Phase 6). User profiles public page. Profile comments wall (backend API + public frontend; owner soft-delete sets `deleted_at` + hides content, no tombstone yet — tombstone added in Phase 10). Custom profile fields (backend service + registration form + account settings Profile tab). Username change + history (backend + account settings Security tab). Follow/unfollow (backend + public frontend; counter updates synchronous in transaction for Phase 4 — BullMQ only if performance requires). Block/unblock (backend). Privacy settings (backend + frontend). Account settings: Profile, Security, Notifications (placeholder panel), Preferences, Privacy tabs. `social.new_follower` + `profile.comment_posted` notifications via Phase 2 basic service. |
| **5** | **Article CMS — backend + public frontend only** (no ACP pages). Articles CRUD backend. Article categories tree backend (using `userCanSeeNode()` from Phase 1). **Article category reorder + reparent endpoint** (backend, needed by Phase 6 ACP tree). Tags (auto-created on article save). Article revisions backend + BullMQ cleanup job. Article comments backend (basic owner soft-delete; tombstone in Phase 10). Article likes backend + synchronous counter update. Article comment likes backend + synchronous counter update. body stored as TipTap JSON; `body_plain` extracted by traversing JSON text nodes (§17b). **Search vector triggers as raw SQL** in Prisma migration files (Prisma doesn't support `CREATE TRIGGER` natively — use `prisma/migrations/*/migration.sql` custom SQL). TipTap editor frontend. Article list, article reader, article editor public pages. Featured image upload: MIME validated against magic bytes + size checked against `UPLOAD_LIMITS.FEATURED_IMAGE`. `article_count` incremented on publish. |
| **6** | **ACP shell + all ACP pages for content built in Phases 2–5.** ACP shell first: `AcpLayout.tsx` (sidebar, top bar, admin auth gate checks `admin.access` permission, nav framework, breadcrumbs). Build `GroupAccessPicker` component in `packages/ui/` (used here and in Phase 16). Then all ACP pages: Dashboard. Users → User List + User Detail + Profile Fields manager. Access Control → Groups (Progression tab config-only stub; engine Phase 7) + Permissions (group selector) + Progression page layout. Content → Articles table + Article Categories tree manager (drag/drop reorder + `GroupAccessPicker`). System → Settings + About. Permission cache invalidation on all group/permission mutations. |
| **7** | **User Progression System** — `group_progression` config backend CRUD. BullMQ promotion engine (triggered by `article_count` change from Phase 5; `post_count`/`thread_count` wired in Phase 16). Content limit middleware on article creation. ACP Progression page live (engine running, user counts per level). Completes Phase 6 Progression tab stub. `progression.promoted` notifications via Phase 2 basic service. |
| **8** | **Notifications — full** (depends on Phase 3 email infra + Phase 7). Upgrade `NotificationService`: add email routing through Phase 3's BullMQ email workers. In-app bell UI (real counts, mark read). Completes Account Settings Notifications tab (preference UI wired to `notification_preferences`). All existing Phase 4/5/7 notification dispatches now also email if user has email enabled for that type. |
| **9** | **Search** (can begin after Phase 5; placed after Phase 8 for team sequencing). Users `search_vector` trigger (raw SQL trigger on username + `COALESCE(display_name,'')` + `COALESCE(bio,'')`). Search module backend. **Search visibility**: article search queries JOIN `article_categories` and filter via `userCanSeeNode()` — hidden-category articles never appear in results for ineligible users. Plugin content type registry. `GET /api/search` endpoint. Search results frontend page (All / Articles / Users tabs; Forum tab added in Phase 16). |
| **10** | **Moderation system** (depends on Phase 8 for notifications). Moderation API: reports (all target types), warnings, bans, review cases, moderation log. Policy + threshold engine. Warning expiry BullMQ job. **Ban expiry BullMQ job** (sets `moderation_bans.status = expired` + clears `users.banned_until` for expired temporary bans, runs daily). **Security analysis BullMQ job** (runs every 30 min — scans `security_events` for suspicious patterns, creates `moderation_cases`, sends `mod.new_case` notification). Threshold recalculation job. **Full tombstone treatment** for profile comments + article comments — upgrades Phase 4+5 soft-delete with reason field, tombstone component in existing profile wall + article reader frontend. Moderation notifications via Phase 8 full service. ACP Moderation: Report Queue, Warnings, Bans, Review Cases, Moderation Log, Settings. |
| **11** | **ModCanvas** (depends on Phase 10). Floating trigger, canvas shell, all 6 sections wired to Phase 10 APIs. Live badge (polls `GET /api/moderation/summary`). Context-aware user prefill. `Shift+M` shortcut. |
| **12** | **Appearance system** (depends on Phase 6 for ACP shell). Style editor (semantic token editing + live preview iframe). `.nvstyle` upload + CSS variable validation + activation. Font loader. Style history save/restore. Token persistence in settings. **Frontend Nav Manager** — `nav_items` backend CRUD, `GET /api/nav-items` public endpoint (filtered by visibility + active), ACP → Appearance → Navigation (drag-drop tree, add/edit/toggle/delete). Seeded defaults (Home, Articles) already exist from Phase 2. ACP Appearance: Style Editor, Styles, Style History, Navigation. |
| **13** | **Error system ACP pages** (depends on Phase 6 shell; error infrastructure already Phase 1/2). ACP System → Error Reference (NEC code lookup). ACP System → Error Log (filterable `error_log` table). ACP System → Migration History (`migration_runs` table). |
| **14** | **Plugin engine + plugin-sdk** (depends on Phase 6 ACP). `core/plugin-engine/`: manifest validation, zip-slip protection, package storage, install/enable/disable lifecycle, **raw SQL migration runner** (reads `.up.sql`/`.down.sql` from plugin package, tracks in `nodevo_plugin_migrations`, verifies checksums). `packages/plugin-sdk/` populated: permission registration, notification type registration, search content type registration, route registration, ACP page registration, **nav item registration** (`plugin.registerNavItem()`), UI slot registration. Official plugin frontend strategy: Vite config includes a plugin that reads `plugins/official/*/web/index.tsx` entry points; enabled-plugin check gates route rendering at runtime. Community plugins: UI slots only, no full-page routes. **Plugin route middleware injected automatically** by engine (§17b): every plugin route group gets a leading middleware that returns 404 if plugin status !== enabled — routes are never truly deregistered from Express. Migration SQL validated as DDL-only before execution (§17b) — `NEC-PLUGIN-2010` on violation. ACP Extensions: Installed list + Upload wizard (drop → validate → install). |
| **15** | **Marketplace + License** (depends on Phase 14). License activation: POST to license server with `{licenseKey, siteId}` → receive RS256 JWT → verify with bundled public key (jose) → store in `licenses`. Daily BullMQ license refresh job. Entitlement check: reads `licenses.entitlement_jwt`, verifies, checks plugin ID in entitlements array. ACP Extensions: License page + Marketplace page. **Note**: Marketplace page calls `nodevo.io/api/marketplace/plugins` — external dependency requiring nodevo.io API to be live. During development, use a stub/mock server at this URL. |
| **16** | **Official Forum plugin** (depends on Phase 14 + 15). Plugin package with **raw SQL migrations** (not Prisma): `forum_nodes`, `forum_threads`, `forum_posts`, `forum_post_likes`, `forum_subscriptions`. All migrations registered via Phase 14 plugin migration runner. Forum node tree ACP registered via `plugin-sdk` ACP page API (appears as ACP → Forum → Categories). Forum frontend pages (categories, subforum, thread) included in `apps/web` via Phase 14's Vite entry-point plugin — active only when forum plugin is enabled. Thread posting runs through Phase 7 content limit middleware. `post_count` + `thread_count` counter updates now feed Phase 7 progression engine (BullMQ jobs on post create/delete). Forum search content type registered with Phase 9 registry. Forum notification types registered with Phase 8 service. Forum posts moderation via Phase 10 (tombstone). `GroupAccessPicker` (built in Phase 6) wired to forum node editor. Search results gain Forum tab (registered via plugin-sdk). |
| **17** | **Hardening**. Playwright e2e: install wizard, register + login, article create/publish, article comment, follow/unfollow, block, profile comment, forum install + thread post + reply, mod action (warn + ban), plugin upload + install + enable, license activation. Security audit: every endpoint's permission check, rate limit coverage, `SameSite=Strict` on refresh cookie confirmed, access token in memory (not localStorage) confirmed, hidden categories return 404 confirmed. Performance: EXPLAIN ANALYZE on critical queries, add missing indexes, Redis cache hit rates. BullMQ: retry + dead-letter config on all workers. API documentation. Docker production image. Changelog + versioning. |
| — | **Post-launch: `@nodevo/migrate-core` + Wave 1 adapters** (WordPress, XenForo, phpBB) — separate repository |
| — | **Post-launch: Wave 2 adapters** (vBulletin, WoltLab) — after Wave 1 is stable |

### Phase Dependency Map

```
Phase 0
  └── Phase 1
        └── Phase 2
              └── Phase 3 (installer + email infra)
                    └── Phase 4 (user system)
                    └── Phase 5 (article CMS)
                          │
                          ├── Phase 6 (ACP shell + all ACP pages up to here)
                          │         └── Phase 7 (progression engine)
                          │                   └── Phase 8 (full notifications) ◄── Phase 3 (email)
                          │                             └── Phase 9 (search)
                          │                             └── Phase 10 (moderation) ──── Phase 11 (ModCanvas)
                          │                             └── Phase 12 (appearance)
                          │                             └── Phase 13 (error ACP)
                          │                             └── Phase 14 (plugin engine)
                          │                                         └── Phase 15 (marketplace + license)
                          │                                                   └── Phase 16 (forum plugin)
                          │                                                             └── Phase 17 (hardening)
```

**Critical constraint:** Phase 6 (ACP shell) must complete before any ACP page resumes. Phases 4 and 5 build backend and public frontend only — zero ACP pages.

---

## 57. Definition of Done for v1

Nodevo v1 is complete when:

- A new instance installs through the 7-step wizard and the installer removes itself
- An admin can log in and access the ACP
- Users, groups, and permissions work end-to-end with Redis permission caching
- Username change cooldown enforced, history recorded, ACP override works
- Follow/unfollow between users works with notifications and denormalized counts
- Block/unblock works — automatically removes follow relationships, enforces privacy
- Privacy settings save correctly — email notification toggles, visibility controls, block list, profile comments toggle
- Profile wall comments work — self-comment and blocked-user prevention enforced server-side, owner can delete without reason, moderators soft-delete with tombstone, edit window enforced
- Custom profile fields configurable in ACP — system fields pre-seeded, admin can add/rename/reorder/delete non-system fields, date of birth display format configurable
- Custom fields appear at registration (if configured), in account settings with per-field privacy, on profile Information tab respecting privacy
- `nobody` privacy fields hidden from all public views including staff browsing profiles (visible only in ACP user detail to admin/supermod)
- Articles can be created, edited, published via TipTap editor with featured image, tags, SEO fields, and visibility setting
- Article categories work as a tree with drag-and-drop ACP, staff shorthand, and access inheritance
- Article revisions created on publish, retention policy enforced, restore works
- Article tags work end-to-end (create on write, filter in listing)
- Article category and forum category visibility model works — staff-only categories invisible (404 on direct access), access inheritance enforced server-side
- Audit log writes to DB for all defined events; schema in place for future viewer
- Reports can target articles, article comments, profile comments, users, and plugin content
- Article comments work (threaded, soft-delete with tombstone, moderation)
- Full-text search works across articles and users
- Notifications dispatch from core modules, appear in in-app bell, deliver via email queue
- Progression system promotes users correctly when thresholds are met
- Content limits enforced at API level per group progression config
- ACP Progression page shows full ladder, supports reorder and threshold configuration
- Moderation tools work (reports, warnings, bans, cases, log, threshold engine)
- ModCanvas is functional with all 6 sections
- Password reset and email verify send via queued email service
- Style editor modifies and saves light/dark semantic tokens
- Style packs upload, validate, and activate via `.nvstyle`
- Three-tier token CSS, `ThemeRegistry` stub, `AppLayout` slot constants all in place
- Font registry and `StorageProvider` interface in place
- Plugin packages upload, validate, install, enable, disable with separate migration tracking
- Official Forum plugin installs, enables, registers search content types and notification types
- License entitlement gates official plugin install/enable
- Core remains fully functional without premium plugins
- Frontend nav manager works — links can be added, toggled, reordered, visibility-controlled; plugin nav items auto-hide on plugin disable
- Per-group profile image constraints enforced (size + allowed types), with NEC-STORE-7002 for type violations
- Error system captures, codes, and surfaces errors in ACP
- `migration_runs` table exists and ACP Migration History shows empty state on fresh install
- Codebase is organised enough to extend without major refactoring

---

## 58. Versioning Roadmap

| Version | Key additions |
|---|---|
| v1 | Everything above |
| v1 post-launch | `@nodevo/migrate-core` + Wave 1 adapters: WordPress, XenForo, phpBB |
| v1.x | Wave 2 adapters: vBulletin, WoltLab Suite. `nodevo-messaging` official plugin. |
| v2 | `nodevo-subscriptions` (Stripe paywall). `nodevo-oauth` (social login). `nodevo-2fa` (TOTP). **GDPR data export** ("Download my data" — JSON archive of account, content, follows). **Image resizing on upload** (sharp/jimp — avatars resized to max 256×256 on save, featured images to max 1200px wide). `S3StorageProvider`. `.nvtheme` component overrides. Connected nodevo.io OAuth. Ban appeals. Plugin rollback/downgrade. `/api/v2` versioning prefix (first external API version). |
| v3 | `nodevo-advanced-moderation`. `nodevo-analytics`. `.nvtheme` layout slot overrides. Theme marketplace. Advanced plugin sandboxing. Marketplace economics. |

### Post-v1 Technical Debt to Address

These are known limitations in v1 that should be resolved in v2:

| Concern | v1 status | v2 fix |
|---|---|---|
| Image resizing | Raw uploads stored at full resolution | Process with sharp on upload, store at max dimensions |
| GDPR data export | No download-my-data feature | Account settings → "Download my data" → async ZIP job |
| API versioning | No version prefix (internal single-client) | `/api/v2` prefix when public API consumers exist |
| Social login | Email/password only | `nodevo-oauth` plugin |
| Two-factor auth | None | `nodevo-2fa` plugin |
| Webhook verification for payments | Interface defined, not implemented | Implemented in `nodevo-subscriptions` |

---

## 59. Design Prototype

The complete interactive UI prototype is available as a React artifact:
**`nodevo-complete.jsx`**

Covers all pages including full ACP. Built with the same token system defined in §24. Navigate between sections using the header, footer quick links, and ACP sidebar.

**To implement the frontend from this prototype:**
1. Use the token values in §24 as the three-tier CSS custom properties in `apps/web/src/styles/tokens.scss` (v1 ships SCSS tokens here, not in a `themes/default/` package)
2. Implement each page as a separate route view under `apps/web/src/pages/`
3. Extract shared components into `packages/ui/`
4. Wire API calls via `apps/web/src/lib/api.ts` (the browser fetch client; `@nodevo/sdk` holds shared helpers/types, not a web client) using the pagination contract from `packages/contracts/`
5. Implement ModCanvas as a standalone feature under `features/modcp/`
6. ACP is a separate layout shell — `layouts/AcpLayout.tsx` — with its own sidebar nav
7. TipTap editor lives in `features/articles/components/ArticleEditor.tsx`
8. `useTheme()` hook wires to `ThemeRegistry` — all components go through it, never raw CSS imports

---

## 60. Language / Internationalization (i18n) System

Nodevo ships multilingual from v1. The installer's language step sets the **site
default**; authenticated users may override it; plugins contribute their own
translations. English is the **source and fallback** locale.

### 60.1 Library & runtime
- **Frontend:** i18next + react-i18next. Namespaces, lazy-loaded locale bundles,
  ICU plural/format via i18next-icu.
- **Backend:** i18next (shared config, Node) — used ONLY for server-generated,
  user-facing content: emails, notifications, and NEC error-message catalogs.
- **Formatting:** native `Intl` (DateTimeFormat / NumberFormat / RelativeTimeFormat)
  keyed off the active locale + the user/site timezone. No moment/dayjs locale packs.

### 60.2 Core principle — the API is locale-agnostic
REST responses return stable machine keys and NEC codes, never localized prose.
UI strings, validation messages, and error text are translated client-side from
those keys. The ONLY server-localized output is email + notification content,
rendered in the recipient's resolved locale. This keeps responses cacheable and
the API a single contract regardless of language.

### 60.3 Locale resolution order (resolved into `req.locale`)
1. Authenticated `users.preferred_locale` (if set)
2. Anonymous cookie `nv_locale`
3. `Accept-Language` negotiation against enabled locales
4. Site default `settings['site.locale']`
   The frontend i18n provider mirrors the same chain client-side.

### 60.4 Storage
| Key | Meaning |
|---|---|
| `settings['site.locale']` | Site default locale — written by the installer (Phase 3) |
| `settings['i18n.enabledLocales']` | JSON array of enabled locale codes (ACP-managed) |
| `users.preferred_locale` | Nullable column; null = follow the resolution chain |
| cookie `nv_locale` | Anonymous selection (SameSite=Lax, 1y) |

### 60.5 Resource layout & namespaces
- Frontend: `apps/web/src/locales/<locale>/<namespace>.json`
- Backend:  `apps/api/src/locales/<locale>/<namespace>.json`
- Core namespaces: `common`, `auth`, `account`, `articles`, `acp`, `errors`,
  `email`, `validation`.
- Plugins: `plugins/.../locales/<locale>/<pluginId>.json`, registered as the
  namespace `<pluginId>`.
- `fallbackLng: 'en'`. Missing keys fall back to English; dev logs missing keys.

### 60.6 v1 bundled locales
`en` (source/fallback), `de`, `es`, `fr`, `pt`. Additional locales are
community-contributed post-v1. **LTR only in v1** (RTL deferred to v2).

### 60.7 Plugin contract
`packages/plugin-sdk` gains `plugin.registerTranslations(resources)` (see §10/§14).
A plugin ships a `locales/` directory; the plugin engine registers its namespace
on enable and deregisters on disable. Frontend bundles load through Phase 14's
Vite entry-point plugin; backend bundles through plugin-sdk. Theme-level locale
overrides are deferred to v2.

### 60.8 Installer role (Phase 3)
The wizard language step selects the site default, persisted as
`settings['site.locale']`. The wizard UI is itself fully translated and switches
live when a language is chosen — it is the first consumer of the i18n system and
dogfoods it before the rest of the app exists.

### 60.9 Server-rendered content
Email and notification jobs resolve the recipient's locale (`preferred_locale`
→ site default), render from the backend `email` / `notifications` namespaces,
and store the resolved locale on the queued job so retries stay consistent.

### 60.10 ACP (Phase 12)
ACP → Appearance → Localization: enable/disable locales, set the default, and
view per-namespace translation coverage (% of keys translated vs `en`). Per-user
language lives in Account → Preferences (§22).

### 60.11 Build-phase placement
- Phase 1: i18next provider + resolution chain + `common` namespace + cookie.
- Phase 3: installer writes `site.locale`; wizard translated + live-switching.
- Phase 4: `users.preferred_locale` column + Account Preferences language selector.
- Phase 8: emails/notifications localized to recipient.
- Phase 12: ACP Localization page.
- Phase 14: `plugin.registerTranslations`.

### 60.12 Deferred to v2+
RTL support (`dir` attribute + logical CSS properties), theme locale overrides,
in-ACP translation editor, machine-translation assist, locale-scoped SEO slugs.

*This document supersedes all prior notes. Update it when decisions change.*

WoltLab Suite (the closest match to what you're describing)
- You create an account at woltlab.com, buy plugins in the Plugin-Store, tied to your account.
- In the ACP you add the store as an authenticated package source — you authorize it with your account credentials / an auth code, exactly your "credentials act like a license" idea.
- Purchases are domain-bound: when you buy, you nominate the domain(s) it's licensed for. The store then authorizes downloads + auto-updates straight into the instance over that authenticated connection.
- Runtime: once installed, the plugin just runs. The teeth are at the download/update gate, server-side.

XenForo
- License bought on xenforo.com, bound to your board URL, tied to your account. Official add-ons (Media Gallery, RM…) are separate keyed licenses, downloaded from your account.
- Third-party add-ons via the Resource Manager are account-based downloads, then trust-on-install — they run once installed (some commercial ones add their own phone-home).
- Core does a URL-bound license validation; the add-ons mostly don't.

Invision Community (IPS)
- Account + URL-bound license key. The AdminCP connects to IPS with that key to browse/install Marketplace apps and pull updates through the authenticated channel.

The pattern all three share:
1. Account-based ownership on the vendor store.
2. Domain/URL binding recorded server-side (not unlimited-per-account).
3. The real chokepoint is the authenticated ACP→store download/update channel — you can only pull the artifact if your account + your domain owns it.
4. Runtime on the add-on itself is light or trust-on-install, because once the code is on the customer's server, DRM is theater anyway.