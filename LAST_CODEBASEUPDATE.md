# Last Codebase Update — 2026-07-19 (session 6)

## Marketplace-first plugin installs + license enforced by plugin id — UNCOMMITTED

User's monetization goal: core is free, plugins are the revenue. Decided (both confirmed):
keep manual upload but gate it (off by default), and fix the flag-trust so the paywall is
authoritative by plugin identity rather than the uploadable manifest flag. Unknown
(non-marketplace) ids are NOT gated — keeps the community ecosystem alive.

### Part 1 — upload gated (default off)
- New setting `plugins.allow_upload` (default false). `uploadGuard` middleware on
  `POST /plugins/upload` + `/plugins/validate` → 403 `NEC-PLUGIN-2006` when off (read via
  getFreshSetting so a toggle is immediate). Marketplace install is never gated.
- Web: `useUploadAllowed` hook (shared query); useAcpNav hides the Upload item; UploadPage
  guards (reachable by URL but API 403s); Installed page gets an "Allow manual uploads"
  toggle (`PUT /admin/settings/plugins.allow_upload`) + empty-state CTA → marketplace when
  off. Locales ×5, ErrorReference +2006.

### Part 2 — paid-status authoritative by id (fix flag-trust)
- `marketplace-source`: `fetchCatalog()`/`cachePaidIds()`/`refreshPaidPluginIds()` — caches
  the set of paid ids (licenseRequired=true in the catalogue) as `marketplace.paid_plugin_ids`;
  refreshed on listPlugins, in the update-check job (daily/boot), and after every upload.
  Export widened from the `MarketplaceSource` interface to the concrete class.
- `license-engine.pluginRequiresLicense(id)` — true iff id ∈ paid_plugin_ids. Ignores the
  manifest flag entirely.
- `plugin-engine.enablePlugin` — gates on `pluginRequiresLicense(id)` instead of
  `record.licenseRequired`. Upload route also corrects the stored flag if the id is paid.
- contracts nec.ts: +PLUGIN_UPLOAD_DISABLED 2006.

### Verification
- Both apps typecheck; lint 0 errors.
- E2E on the test instance vs live catalogue: paid ids = [nodevo-forum, nodevo-shoutbox].
  `nodevo-forum` (paid, NOT owned) → requires=true/entitled=false → **enable BLOCKED** (the
  repackage-as-free hole, now closed by id). `nodevo-shoutbox` (owned) → allowed. Unknown id
  → not gated. `plugins.allow_upload` unset → false → uploads blocked.
- Residual (as designed): a fully-disconnected instance has no catalogue → falls back to the
  manifest flag; unpreventable determined-pirate case on OSS self-hosted core, connected
  instances fully covered.
