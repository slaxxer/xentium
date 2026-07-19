# Last Codebase Update — 2026-07-19 (session 4)

Two changes, pushed together.

## 1. License-expiry dialog on ACP entry (commit: feat)

- `admin.controller.ts` `getStatusSummary`: +licenseDaysLeft, licenseExpiresAt,
  licenseDomain, and per-admin `licenseAcknowledged` (visited /admin/license since
  the warning-window anchor `expiresAt − 30d`, via the ACP movement log).
- `AcpLayout.tsx`: the alert hook (`useAcpAlerts`) now shows a warning panel dialog
  for an expiring/expired license, prioritised above the plugin-update dialog (one
  dialog per ACP entry — a second openPanelDialog would pre-empt the first).
  Visit-based acknowledgement, re-warns each renewal cycle.
- Locales ×5: `license.expiryDialog*` (title/expired, domain, expires, in-days
  plural, expired marker, note, view).

## 2. Fix: phantom update alerts for uninstalled / already-updated plugins (commit: fix)

User-found: uninstalling a plugin via the ACP left the "update available" banner
(and dialog + badge) showing, because the alerts read the `marketplace.updates`
cache verbatim — that cache is only refreshed by the update-check job, so it lags
the real installed set. Marketplace side is fine (its `updates()` only iterates the
sent inventory); this was purely a core read-time gap.

- `admin.controller.ts`: new module-level `readReconciledUpdates()` — reads the
  cache and keeps an update only if its plugin is STILL installed AND its current
  installed version is older than the offered version (semverCompare); refreshes the
  installed version for display. `getMarketplaceUpdates` and `getStatusSummary` both
  route through it, so the banner, dialog, Updates page, and navbar badge are all
  reconciled. Cheap (one `findMany({ select: { id, installedVersion } })` per call).

### Verification
- API typecheck clean; backbone:check green.
- E2E on the test instance in the bugged state (0 plugins installed, cache still
  listing shoutbox 1.0.0→1.0.1): getMarketplaceUpdates → `updates: []`,
  getStatusSummary → pluginUpdates 0 (phantom gone; the legitimately-expiring
  license still counts, total 1). Positive case after reinstalling shoutbox 1.0.0:
  the 1.0.1 update reappears (pluginUpdates 1, total 2, urgent).
- License-dialog ack flow E2E (earlier this session): expiring detected, not-acked
  before visiting /admin/license, acked after.
