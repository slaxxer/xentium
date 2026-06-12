# Changelog

All notable changes to Nodevo are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · Versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Added
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

### Fixed
- Forum thread page crash (`tsvector` deserialize) — `getThread` no longer selects `search_vector`.
- `BOOTSTRAP_OFFICIAL_PLUGINS` defaults off → fresh cores install plugins on demand.
- **`security-analysis` job crash** (`NEC-QUEUE-5000` / Postgres `42703`): two raw queries used
  `"eventType"` but the column is `@map("event_type")`. Corrected to `"event_type"`.

### Security
- Audit pass: confirmed every endpoint's permission check, `SameSite=Strict`/`HttpOnly`/`Secure`
  refresh cookie, access token in memory only, and hidden-category 404 behavior. See
  `UPDATES/UPDATE Phase 17 Security + Rate-Limit Audit ...md`.

## [1.0.0] — 2026-05-31

Initial Nodevo v1 — extensible CMS/community platform (TypeScript, Express 5, React 19, PostgreSQL 17,
Prisma 7, Redis/BullMQ). Highlights:

### Added
- Installer wizard; auth (RS256/refresh rotation, sessions); RBAC groups + permissions with Redis
  cache; users/profiles, follows, blocks, privacy, custom profile fields, username history.
- Articles CMS (TipTap, categories tree, revisions, comments, likes); full-text search.
- Notifications (in-app + email); user progression; moderation (reports/warnings/bans/cases/log) +
  ModCanvas; appearance/style editor + style packs + nav manager + branding.
- Plugin engine + license engine + marketplace; official **Forum** plugin.
- NEC error system, audit log, security-event telemetry, i18n.

REMAINING STEPS --TO BE CONTINUED TOMORROW;

What remains

- Task 5 — the ACP. The largest surface by far: dozens of admin pages (dashboard, users, groups, permissions, progression, content, moderation, appearance, extensions, system, error pages…). This is its own multi-turn
  grind.
- Task 6 — backend i18n: localized emails/notifications (apps/api/locales), the ACP → Appearance → Localization page (enable/disable locales, set default, coverage %), and forum-plugin registerTranslations.

Say continue and I'll start the ACP (task 5) — I'd begin with the ACP shell/nav + Dashboard, then work through the pages section by section. Or if you'd rather, I can do task 6's backend email/notification i18n first
since it's more self-contained.