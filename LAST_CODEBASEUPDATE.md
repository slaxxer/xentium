# Last codebase update

Two pieces, two commits.

## feat(installer): two-column wizard with a marketplace add-ons step

The "Installer Wizard" redesign, integrated. Seven steps become eight; the new
**Add-ons** step links a marketplace account and picks plugins to install during the run.

- `packages/contracts/src/installer.ts` — `InstallStep.ADDONS`, the add-on DTOs and
  schemas, `SetupProbeResult`, `version` on `InstallStatusDto`.
- `apps/api/src/core/installer-engine/installState.ts` — mint `siteId` at row creation, not
  at finalize: the add-ons step talks to the marketplace and `getSiteId()` is what a licence
  binds to.
- `apps/api/src/modules/installer/` — the catalogue, the account link, the selection and the
  per-add-on install (the one route behind `requireAuth`). The link poll has its own
  rate-limit window; it is a timer, not a form submission.
- `apps/api/src/setup/setupServer.ts` — `POST /install/database/probe`: verify credentials
  with no side effects, so the database step tests as you type.
- `apps/web/src/features/installer/` + `styles/installer.scss` — rewritten. Schema creation
  moved to the database step's Continue, because the two steps after it need a database.
- Locales rewritten for all five languages.

## feat(announcements): receive signed broadcasts from the Xentium team

The instance half of a global alert channel, and the marketplace half in the
`xentium-marketplace` repo.

- `apps/api/src/jobs/announcementCheck.ts` — anonymous daily check beside the core update
  check, verifying each announcement's RS256 signature before anything is rendered.
  `announcementCheck.test.ts` pins the five failure modes that must not get through.
- `xcf_announcement_acks` — per-admin acknowledgement. OK is the acknowledgement here,
  unlike the update and licence dialogs, which want a page visit.
- `apps/api/src/modules/admin/announcement.service.ts` + routes — read and ack.
- `apps/web/src/features/admin/AcpLayout.tsx` — broadcasts go first in the dialog queue.
- `apps/web/src/features/admin/pages/AnnouncementsPage.tsx` — the record, at ACP →
  Announcements. Copy follows the admin's locale, then the site's, then English.
- Docs: `apps/docs/src/content/docs/admin/announcements.md` (hand-written wiki page) and a
  README section, mapped into the wiki through `sync-docs.mjs`.

## Notes

- The entitlement signing key is load-bearing for two things now. Rotating it invalidates
  every live announcement as well as every entitlement.
- Nothing has been broadcast. The capability is deployed; the channel is empty.
