# Last Codebase Update — 2026-07-19

## Plugin updates: dedicated Updates page + §16.2 update-in-place — UNCOMMITTED

User reported the critical-update panel dialog was (a) marked "seen" on a bare page
reload without the admin acting on it, and wanted the reminder to persist across the
Extensions section until acted upon, plus a real place to apply updates. Decided:
dedicated Updates page + real update-in-place action.

### Dialog seen-hash fix (the reported bug)
- `features/admin/AcpLayout.tsx` `useUpdateAlert`: the `localStorage[nv-acp-updates-seen]`
  write moved OUT of render and INTO the dialog's `.then()` — the set is only remembered
  once the admin clicks View or Later. A bare reload no longer counts as acknowledgement,
  so the dialog re-fires on every fresh ACP entry until acted upon. View now navigates to
  `/admin/updates` (was `/admin/marketplace`).

### Persistent Extensions banner
- NEW `features/admin/components/ExtensionsUpdateBanner.tsx`: reads the shared
  `acp-marketplace-updates` query, renders a banner (danger styling if any critical)
  linking to `/admin/updates`, hides itself on the Updates page. Mounted on all four
  Extensions pages: Marketplace, Installed, Upload, License. Unlike the one-shot dialog it
  stays visible while updates are pending — a dismissed dialog can't hide a critical patch.

### Dedicated Updates page (Extensions → Updates)
- NEW `features/admin/pages/UpdatesPage.tsx`: lists pending updates (critical first),
  installed→latest, changelog, renewal warning; per-plugin Update button (disabled when
  `renewalRequired`). Route in `app/App.tsx` (`/admin/updates`), nav entry in
  `useAcpNav.ts` (Extensions, after Installed).

### §16.2 update-in-place (API + plugin-engine)
- `core/plugin-engine/migration-runner.ts`: NEW `runNewUpMigrations()` — runs only
  migrations NOT yet applied, matching by NAME across every version. The tracking id embeds
  the version (`${pluginId}_${ver}_${name}`), so naively re-running `runUpMigrations` on a
  new version would re-run historical migrations ("relation already exists"). Names are a
  one-time schema change per plugin lifetime → a name already tracked (any version) is
  skipped; new names run and track under the new version.
- `core/plugin-engine/plugin-engine.ts`: NEW `updatePlugin(buffer, userId)` +
  `compareSemver()`. Forward-only (rejects ≤ installed). Preserves state + data: an enabled
  plugin is disabled first (old bundle's onDisable + full deregistration against the still-
  in-place extracted dir), files swapped, new migrations run, DB record updated, then
  re-enabled against the NEW bundle. Old package file (version-named) deleted. Migrations are
  never rolled back — updates only add schema.
- `modules/plugins/plugin.service.ts`: `update()` → `updatePlugin`.
- `modules/admin/admin.controller.ts`: extracted `fetchMarketplaceArtifact()` helper shared
  by install + update (authorize at chokepoint → 120s/50MB fetch → sha256 verify → manifest-id
  match); `installFromMarketplace` refactored onto it; NEW `updateFromMarketplace` (coded
  NodevoErrors propagate to errorMiddleware for correct NEC/status).
- `modules/admin/admin.routes.ts`: `POST /admin/marketplace/update` (adminGuard + license
  limiter).
- `packages/contracts/src/nec.ts`: +PLUGIN_NOT_FOUND 2004, +PLUGIN_VERSION_NOT_NEWER 2005.
- `features/admin/pages/ErrorReferencePage.tsx`: +2 catalog entries (2004, 2005).
- Locales ×5 (`public/locales/*/acp.json`): +nav.updates, +updates block (title, banner
  singular/plural + critical variants, empty state, critical, renewalRequired, update/updating,
  toasts).

### Verification
- Web + API typecheck clean; web build clean; lint 0 errors (46 pre-existing `any` warnings).
- API tests: 17 pass; the 4 installer failures are environmental (default dev DB on :5432 not
  running — only the isolated test-instance DB on :5433 is up); unrelated to this change.
- **E2E on the test instance vs LIVE bplaced marketplace** (tsx driving the real modules):
  shoutbox 1.0.0 → 1.0.1 — authorizeDownload returned a real 89817-byte artifact, sha256 MATCH,
  manifest-id match, `updatePlugin` disabled+swapped+re-enabled (routes/permissions/NEC codes
  re-registered), DB → 1.0.1 still `enabled`, 5 existing migrations correctly skipped by name
  (none re-run), old 1.0.0 package file removed. Negative test: re-updating the same version
  threw NEC-PLUGIN-2005 (409). Update route mounted (401 adminGuard, not 404).
- Test instance RESET to a clean demo state for the browser walkthrough: shoutbox rolled back
  to 1.0.0 (artifact re-fetched, files + DB restored), `marketplace.updates` re-seeded with the
  real 1.0.1 critical entry, API restarted fresh and verified (plugin enabled at 1.0.0, route
  live). No worker on the test instance — the update cache was seeded via a manual
  `processUpdateCheck()` run.
