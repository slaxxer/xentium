# Changelog

All notable changes to Nodevo are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · Versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Added
- **Migration tooling (§34, Wave 1)** — free, open-source platform migration as a standalone CLI:
  - `@nodevo/migrate-core`: two-stage adapter architecture (adapters extract a platform-neutral
    model; the shared loader owns all Nodevo knowledge), `import_map`-backed **resumable** imports
    (re-runs skip what's done; same-email accounts map to existing users), HTML → TipTap
    conversion, per-row failure reporting, `--dry-run` mode, `migration_runs` logging.
  - `@nodevo/migrate-wp`: WordPress via a **WXR export file** — no WP install or DB needed.
  - `@nodevo/migrate-phpbb`: phpBB 3.1+ via direct MySQL — full forum import (node tree, threads,
    posts in both phpBB text formats: legacy `bbcode_uid` and 3.2+ s9e XML), founders → admin,
    global moderators → moderator. **Requires the `nodevo-forum` plugin enabled on the target** —
    checked before anything runs; refuses outright otherwise.
  - `@nodevo/migrate-xenforo`: XenForo 2.x via direct MySQL — node tree (categories/forums; pages
    and link forums skipped), threads (locked/pinned/views), XenForo-flavored BBCode → safe HTML
    (quotes with author metadata, mentions, media embeds become links), bcrypt hashes extracted
    from XenForo's PHP-serialized auth blobs so users keep their passwords. Same hard
    `nodevo-forum` precondition. Completes the §34 Wave 1 adapter set.
  - **Social graph migrates too**: XenForo reactions → post likes (every reaction type collapses
    to a like — lossy, declared), follows → follows (1:1), ignores → blocks; phpBB zebra foes →
    blocks (the friend flag is a private buddy list and is deliberately not turned into public
    follows). §36 rules enforced on load — a block suppresses follows in both directions — and
    all denormalized counters (post like_count, likes received, follower/following) recompute.
  - **Migrated users keep their passwords**: `users.password_scheme` + legacy verification
    (bcrypt incl. `$2y$`, phpass) on first login, then transparent argon2 rehash. No forced resets.
  - ACP → System → Migration History upgraded: Core/Import badges, status, summary counts,
    expandable error lists (×5 locales).
- **Setup-mode first run** — a fresh clone now installs entirely through the browser: with no
  usable `.env` the API boots a minimal setup server; the wizard collects DB credentials,
  verifies them, **generates all secrets and writes `.env` itself**, then hot-swaps to the full
  application in-process (no restart). The worker waits instead of crash-looping. Preconfigured
  `.env` setups behave exactly as before. Launcher committed as `./nodevo.sh` (runs
  `prisma generate` itself); quick start is now clone → `pnpm install` → `./nodevo.sh`.
- **SemVer adoption** — platform version `1.0.0-alpha.0`, lockstep across all workspace packages
  (`scripts/set-version.mjs`); prerelease bumps mark **cuts**, not commits. Version surfaced in
  `GET /api/health` + ACP → About; plugin manifest `min/maxNodevoVersion` is now actually
  enforced (`NEC-PLUGIN-2030`).
- **Block/mute from profiles** — action cluster on the profile card with server-side block
  enforcement across users/articles/comments (blocking now always hides content; the redundant
  privacy toggle was removed). New plugin slots: profile-action and header-widget (public nav +
  ACP topbar); plugin ACP pages can merge into core nav sections; plugin host gains
  `requirePermission`.
- **Standalone plugin runtime** — official plugins are now genuinely self-contained `.nvplugin`
  packages loaded at runtime (no plugin code in the core build):
  - Server bundle (tsup) loaded after the engine extracts the package; host services injected via
    `PluginHost` on `ctx.host` (no `apps/api` imports in plugin code).
  - Web bundle (UMD) loaded in the browser from `/api/meta/plugin-web/:id`, sharing the host's
    React/Router/Query/FontAwesome via `window.__NODEVO_HOST__`.
  - `scripts/package-plugin.mjs` (`pnpm plugin:package`) builds + zips a plugin.
- Plugin migration runner supports `CREATE [OR REPLACE] FUNCTION`/`TRIGGER` and is dollar-quote /
  comment aware.
- ACP config pages auto-save (debounced) with a toast + status indicator, via a shared
  `useAutosave` hook + `AutosaveStatus` (also exposed to plugins on the host bridge).
- Forum thread approval: server-side authoritative decision honoring `approval_excluded_groups`/`nodes`.
- **Phase 17 hardening:**
  - Rate limiting standardized on a Redis-backed store (§55); added limiters for refresh, follow,
    block, profile-comments (per-user), plugin upload, license activate, installer, and a coarse
    global per-IP API limiter (prod-only). All emit `NEC-API-4290`.
  - BullMQ reliability: per-worker failure handler → `error_log` (`NEC-QUEUE-5000`) on exhausted
    retries + `system.job_failure` admin notification for critical queues.
  - Production Docker images + compose (api, worker, web) and `.dockerignore`.
  - Performance + index audit: every §49 composite/GIN index cross-checked against the schema and
    live DB and proven usable for its hot-query shape. No migrations needed (see UPDATES).
  - **API reference** (`docs/API.md`) — hand-maintained REST contract: every core route group,
    auth levels, pagination + error envelope, rate limits. Closes the §56 Phase 17 docs track.
- **i18n foundation + initial UI translation** — finished the i18next plumbing: all namespaces
  registered, browser language detection with the §60.3 resolution chain (cookie → browser → site
  default), `supportedLngs` en/de/es/fr/pt. Added `User.preferredLocale` (migration) returned in
  `/auth/me` and settable via `PATCH /account/profile`; applied as the top of the chain on
  login/refresh. New language switcher in Account → Preferences. First surfaces externalized ×5
  (`common`: nav/actions/search; `account`: Preferences + tabs) and wired into the header (PubNav),
  Account page, and Preferences tab — switching language now visibly updates them. (Remaining UI
  externalization — auth, articles, profiles, errors, ACP, backend emails — is an ongoing track.)
- **Configurable scheduled tasks** — ACP → System → Scheduled Tasks lets admins set when each
  recurring (cron) job runs: the 4 timer jobs (`security-analysis`, `ban-expiry`,
  `warning-expiry`, `license-refresh`) get friendly presets (every 15/30/60 min, daily at
  HH:MM + timezone) with an advanced raw-cron escape hatch, a per-job enable toggle, and a
  "Run now" button. Backed by a job registry (`jobs/scheduledJobs.ts`); config stored in
  `settings` (`jobs.<key>`); schedules validated (cron + per-job minimum interval →
  `NEC-QUEUE-5001`) and applied **live** via `upsertJobScheduler` (shared Redis, no worker
  restart). Routes: `GET /api/admin/jobs`, `PUT /api/admin/jobs/:key`, `POST /api/admin/jobs/:key/run`.
- Frontend **forgot-password / reset-password** pages (`/forgot-password`, `/reset-password`)
  wired to the existing backend token flow; "Forgot password?" link on the login form.
- Error Reference catalog: added the missing `NEC-QUEUE-5000` (with wrapper-code guidance that
  points operators to the log entry's message/context), the `NEC-LICENSE-9xxx` family, and
  `NEC-AUTH-1007`; new Queue + License domains are browsable.

### Changed
- **Strict core table naming**: every core table is now `ncf_<snake_case>` (nodevo community
  framework) — one rename migration covers all 49 tables, including the legacy PascalCase ones
  (`"User"` → `ncf_users`, …), so raw SQL no longer needs quoted identifiers. The `ncf_`
  namespace is reserved for core; plugin tables keep their `<pluginid>_` prefix (e.g. `forum_*`).

### Fixed
- **Site default language is genuinely site-wide**: the installer-chosen language now applies to
  every visitor without an explicit choice (new public `GET /api/meta/site-locale`; chain:
  account preference → explicit cookie → site default → English). The language detector no longer
  auto-pins a cookie, so default-following visitors track later changes to the site default.
- Install wizard no longer "refreshes" away: the completion screen stays mounted (a background
  status refetch used to yank the user to `/`), and the beta gate no longer polls pre-install
  (console 503 spam) or renders over the wizard.
- Fresh-clone bootstrap: `prisma generate` works without a `.env` (placeholder datasource URL),
  `esbuild`/`@parcel/watcher` build scripts allowlisted, launcher script was gitignored and
  missing from the repo.
- Core nav links (Home, Articles, Members) are seeded during install, deletion-protected
  (deactivate-only, proper NEC error instead of a 500) and badged "Core" in the ACP; plugin nav
  links always append **below** existing links instead of inserting before core ones.
- Installer steps no longer crash on a truly fresh database (`installs` table missing).
- Forum thread page crash (`tsvector` deserialize) — `getThread` no longer selects `search_vector`.
- `BOOTSTRAP_OFFICIAL_PLUGINS` defaults off → fresh cores install plugins on demand.
- **`security-analysis` job crash** (`NEC-QUEUE-5000` / Postgres `42703`): two raw queries used
  `"eventType"` but the column is `@map("event_type")`. Corrected to `"event_type"`.

### Security
- Audit pass: confirmed every endpoint's permission check, `SameSite=Strict`/`HttpOnly`/`Secure`
  refresh cookie, access token in memory only, and hidden-category 404 behavior. See
  `UPDATES/UPDATE Phase 17 Security + Rate-Limit Audit ...md`.

## Pre-alpha baseline — 2026-05-31

The state of the platform when this changelog started (no release was cut or tagged — the first
tagged release will be `1.0.0-alpha.1`). Extensible CMS/community platform (TypeScript, Express 5,
React 19, PostgreSQL 17, Prisma 7, Redis/BullMQ). Highlights:

### Added
- Installer wizard; auth (RS256/refresh rotation, sessions); RBAC groups + permissions with Redis
  cache; users/profiles, follows, blocks, privacy, custom profile fields, username history.
- Articles CMS (TipTap, categories tree, revisions, comments, likes); full-text search.
- Notifications (in-app + email); user progression; moderation (reports/warnings/bans/cases/log) +
  ModCanvas; appearance/style editor + style packs + nav manager + branding.
- Plugin engine + license engine + marketplace; official **Forum** plugin.
- NEC error system, audit log, security-event telemetry, i18n.
