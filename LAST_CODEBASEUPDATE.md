# Last Codebase Update — 2026-07-21

## Architecture cleanup bundle (low-risk quick wins from the 2026-07-21 re-audit) — UNCOMMITTED

Source: `docs/architecture-review.md` addendum §A6 item 10 (2026-07-21 re-audit of the
codebase post-PR #34–#59). Four independent, behavior-preserving cleanups.

### 1. Shared `compareSemver` (dedup)
- NEW `apps/api/src/shared/utils/semver.ts` — the one numeric-core semver compare.
- `core/plugin-engine/plugin-engine.ts` — local `compareSemver` deleted, imports shared.
- `modules/admin/admin.controller.ts` — local `semverCompare` deleted, imports shared
  (used by `readReconciledUpdates` reconciliation filter).

### 2. `getOneSetting` no longer loads every setting
- `admin.controller.ts` `getOneSetting` now uses cached `getSetting(key, fallback)` with
  the same defaults-merge semantics as before (`adminService.SETTING_DEFAULTS[key] ?? null`)
  instead of `adminService.getSettings()` + find over all rows. Writers already bust the
  settings cache (`adminService.setSetting`), so reads stay correct after ACP saves.

### 3. Dead file removed
- `modules/permissions/permissions.repository.ts` deleted — empty file, zero imports.

### 4. Plugin lifecycle mutex
- `modules/plugins/plugin.service.ts`: install/update/enable/disable/uninstall are now
  serialized through one in-process promise chain (`withLifecycleLock`). Prevents two
  admins racing e.g. an update's disable→swap→re-enable sequence (filesystem-corrupting).
  Engine internals stay lock-free (updatePlugin calls disable/enable directly) — only the
  service entry points take the lock. A raced duplicate update fails cleanly afterwards
  with NEC-PLUGIN-2005 (version-not-newer). `validateOnly`/`list` (read-only) untouched.

### Docs
- `docs/architecture-review.md` (local-only): 2026-07-21 addendum §A1–A6 appended
  (full re-audit findings); A6 #10 marked done by this bundle.

Verification: `pnpm backbone:check` fully green (typecheck, lint, 21/21 API tests, build)
with docker infra up. Committed `142c853`, pushed to origin/development.

## Batch 2 — marketplace-service extraction (audit A1.1 / A6 #2) — same session

- NEW `apps/api/src/modules/admin/marketplace.service.ts` (294 lines) — owns ALL
  marketplace/update business logic formerly inline in admin.controller:
  `downloadAndVerifyArtifact` (chokepoint: authorize → stream download w/ 50 MB cap +
  byte progress → sha256 → manifest-id match), `readReconciledUpdates` (phantom-update
  reconciliation), `getUpdates`/`getStatusSummary` (per-admin visit-based acknowledgment),
  `connect` (+ best-effort license auto-activation), `authorizeDownload`,
  `installFromMarketplace` (install + best-effort refreshLicense + fire-and-forget
  processUpdateCheck), `updateFromMarketplace`. `ArtifactError` + `UpdateProgress`/
  `ProgressFn` exported from the service now.
- `admin.controller.ts` 817 → 543 lines; marketplace endpoints are thin: Zod parse +
  error→HTTP mapping (ArtifactError.status / err.message→400 — behavior preserved
  EXACTLY, incl. download-phase non-ArtifactErrors wrapped to 502 in the service) +
  the NDJSON stream plumbing for updateFromMarketplace.
- Dynamic `await import()` in admin.controller: 24 → 0. All converted to top-level
  (verified NO cycles: license-engine/marketplace-source/updateCheck/moderation.service
  import nothing from admin module; updateCheck has no import side effects — worker
  only created via startUpdateCheckWorker()). Also: license refresh/deactivate,
  paginatedRequestSchema, moderationService.banCaseUsers now top-level.
- Verification: backbone:check fully green + live boot smoke on dev :4000 — health 200,
  /admin/status-summary + /admin/marketplace/plugins both 401 (mounted + guarded, no
  runtime ESM-cycle breakage). Dev server killed cleanly after (port 4000 clear).

## Batch 3 — log retention + durable dialog acks (audit A1.2 + A4.1 / A6 #1) — same session

- NEW table `ncf_acp_visits` (model AcpVisit): (user_id, path) PK → last_visit_at.
  Migration `20260721120000_acp_visits` creates + BACKFILLS from existing page_visit
  rows (GROUP BY user,path MAX(created_at)) so earned acks survive. Applied to dev DB
  via psql + `prisma migrate resolve --applied` (NEVER migrate dev — drift gotcha).
- `activity.service.ts`: new `markVisit(userId,path)` fire-and-forget upsert (called
  from POST /activity/visit alongside the telemetry log); `hasVisitedSince` now reads
  AcpVisit by PK (O(1)) instead of scanning activity_log — retention can no longer
  un-acknowledge dialogs. marketplace.service consumers unchanged (same signature).
- NEW `jobs/logRetention.ts` + queue `log-retention` + SCHEDULED_JOBS entry (daily
  03:45 UTC default, min interval 1h) + workerBoot registration. Prunes: activity_log
  page_visit (30d) / acp_action (180d), error_log (90d), login_events (180d) — windows
  from `retention.*` settings (added to SETTING_DEFAULTS), 0 = keep forever.
- E2E (tsx script vs dev DB, 10/10 pass): mark/anchor semantics, one-row upsert, all
  4 windows prune exact cutoffs, 0-window skip, and **acks survive page_visit pruning**
  (the invariant motivating the split). backbone:check green (21/21 API tests).
