# Last Codebase Update — 2026-07-19 (session 3)

## Frontend navbar ACP status badge — UNCOMMITTED

User idea: a badge on the frontend navbar's ACP (gear) icon signalling that
something needs attention in the admin panel. Semantics (user-chosen): persists
until the update is applied, AND persists when the license is about to expire.
Framed as extensible "status updates" — plugin updates are the first source.

- **Backend aggregation** — `apps/api/src/modules/admin/admin.controller.ts`
  `getStatusSummary` + route `GET /admin/status-summary` (adminGuard). Reads the
  update-check cache (pending plugin update count + any critical) and the active
  license (`getActiveLicense().expiresAt`, threshold 30 days). Returns
  `{ pluginUpdates, criticalUpdate, licenseExpiringSoon, licenseExpired, total, urgent }`
  where `total` = pending updates + 1 if the license needs attention, and `urgent`
  = any critical update or license issue. Deliberately small + server-side so new
  signals (core update, stuck jobs, mod queue) OR in here — the badge stays dumb.
- **Frontend badge** — new `apps/web/src/components/AcpStatusBadge.tsx`: queries
  `/admin/status-summary`, renders the bell-style count badge (red `--c-danger`
  when urgent, else `--c-accent2`), nothing when total 0. Wired into the gear
  `NavLink` in `apps/web/src/layouts/PubNav.tsx` (only rendered for admins), which
  gained `--acp` modifier; `apps/web/src/layouts/AppLayout.scss` adds
  `&__icon-btn--acp { position: relative }` so the badge anchors (mirrors `--bell`).
  Badge is `aria-hidden` (decorative); the gear keeps its "Admin panel" label — no
  new i18n keys.

### Verification
- Both apps typecheck; lint 0 errors (pre-existing warnings only).
- Exercised the real `getStatusSummary` controller against the live test DB across
  three scenarios: 1 critical update → total 1 / urgent; +license expiring in 10
  days → total 2 / expiringSoon; license expired → total 2 / expired (license
  `expiresAt` restored after).
- Route mounted on the running instance (401 adminGuard); single clean API+web
  processes; web HMR picked up the component. Demo state (shoutbox 1.0.1 critical
  pending) → a logged-in admin sees a red "1" on the gear.
