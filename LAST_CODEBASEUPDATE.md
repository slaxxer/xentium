# Last codebase update

Announcements go back to the ACP-entry dialog, the Announcements page goes, and the instance
stops keeping a per-admin record: the first OK removes a notice from the site for everyone.

## API

- `prisma/schema.prisma` — `AnnouncementAck` model and the `User.announcementAcks` relation
  removed.
- `prisma/migrations/20260926150000_drop_announcement_acks/` — `DROP TABLE IF EXISTS
  "xcf_announcement_acks"`.
- `apps/api/src/jobs/announcementCheck.ts`
  - `DISMISSED_SETTING = "announcements.dismissed"`: ids only (no who, no when). Needed because
    the marketplace keeps serving a notice until it expires or is pulled, so without it the
    next check would bring a read notice back.
  - `withAnnouncementLock` — one transaction holding `pg_advisory_xact_lock(hashtext(
    'xentium.announcements'))`. The check and a dismissal both read-modify-write the cache and
    the dismissed list; a check that started before a click would otherwise write the notice
    back and drop its id. ⚠ It runs through `$executeRaw`: the function returns `void`, which
    `$queryRaw` cannot deserialize.
  - `dismissAnnouncement(id)` — removes it from the cache and records the id; an id the site
    does not hold is a no-op.
  - The check filters dismissed ids out of what it caches and prunes the dismissed list to ids
    the marketplace still serves, so the list never outlives the notices it names.
  - `readJson`/`writeJson` helpers; `readAnnouncementCache` takes an optional transaction.
- `apps/api/src/modules/admin/announcement.service.ts` — `list` returns what is still unread
  (no `acknowledged` field); `acknowledge` → `dismiss`.
- `admin.routes.ts` / `admin.controller.ts` — `POST /admin/announcements/:id/ack` →
  `/admin/announcements/:id/dismiss` (`dismissAnnouncement`). The ACP is its only caller.
- `apps/api/src/jobs/announcementCheck.test.ts` — the mock becomes a keyed settings store with
  a transaction; five tests for the dismissal rules (removed + id kept, not resurrected by the
  next check, a newer one still gets through, id forgotten once no longer served, unknown id
  ignored).

## Web

- `features/admin/AcpLayout.tsx` — the broadcast is back at the front of `useAcpAlerts`
  (restored from before `f95a13a`): `alert` dialog, severity badge, body + link, OK →
  `/dismiss` and refetch. The band mount is gone.
- `features/admin/AcpAnnouncement.scss` — the dialog's two rules (`.acp-announcement__body`,
  `__link`), which used to live in the page's stylesheet.
- Deleted: `components/AnnouncementBanner.{tsx,scss}`, `pages/AnnouncementsPage.{tsx,scss}`.
- `app/App.tsx` (route), `useAcpNav.ts` (rail/nav entry), `nav/AcpPanel.tsx` (comment).
- `public/locales/*/acp.json` — `nav.announcements` and the page-only keys removed; kept
  `announcements.{dialogNote,dialogOk,severity}`, with `dialogNote` reworded ("removes it from
  this site for every admin") in all five languages.

## Docs

- `README.md` (→ the generated concepts page) and `apps/docs/.../admin/announcements.md` —
  site-wide dismissal, no page, no record. Also corrects the admin page's claim that
  `important`/`critical` rank differently against licence and update dialogs: every
  announcement goes first, and always did.

## Verified

- `pnpm backbone:check` green: API 454/454, web 768/768, CLI 20/20.
- The lock and the dismissal run against the real dev Postgres: a second writer waits for the
  first (`A in → A out → B in → B out`), dismissal empties the cache and keeps only the id, and
  the acks table is gone after `migrate deploy`.
- In the browser, with two seeded notices: the `important` one opens first with its badge,
  body (line breaks kept), link and the new note; OK removes it on the server and the `info`
  one follows; after its OK a reload shows no dialog; no band, no nav entry, and
  `/admin/announcements` is the normal 404. The dev database's announcement settings were
  restored afterwards.
