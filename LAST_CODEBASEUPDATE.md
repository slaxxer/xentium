# Last codebase update

Two changes this session, both unpushed:

1. **Migration History redesign** (the `nodevo-redesign/ACP migration history redesign` mock):
   master–detail page, live imports, recorded deploy failures.
2. **Announcements:** back to the ACP-entry dialog, the Announcements page goes, and the
   instance keeps no per-admin record (first OK removes a notice site-wide).

# 1. Migration History

## Data

- `prisma/schema.prisma` + `migrations/20260926170000_migration_run_progress` — `MigrationRun.
  progress` (JSONB): `{ at, current, entities: { key: { done, total } } }`. `at` is the
  heartbeat; a "running" row whose `at` is older than 2 min is shown as not responding.
- `apps/api/src/core/installer-engine/steps/runMigrations.ts` — a failed `migrate deploy` is
  now recorded too (`status: failed`, its output). Before this only successes were written,
  so every core row said "completed". Output keeps its head AND tail (the error is at the end).
- `packages/migrate-core/src/runner.ts` — the run row is created BEFORE extraction and kept
  current by `RunRecorder` (wraps the CLI's reporter): log lines, per-entity progress and the
  heartbeat, flushed at most once a second when dirty and every 5 s regardless; final state
  written on completion and on failure (extraction failures now land as `failed` too). Log
  capped at 64 KB, head + tail. Dry runs still write nothing.
- `packages/migrate-core/src/loader.ts` — every phase reports progress under the same key its
  count uses: categories/forumNodes (multi-pass, closed out when orphans fail), blocks/follows
  (in `finally` — a `continue` inside `try` skipped code after it), `post likes` → `postLikes`.
- `packages/migrate-core/src/cli.ts` — `maskedCommand` stores how the run was started with
  every connection string reduced to `scheme://…/db` (`--db` is always `postgresql://…`).
  ⚠ `maskUrl` requires a real `scheme://`: `user:pw@host/db` parses as scheme `user:` with the
  password in the path — caught by the new `cli.test.ts`.
- `apps/api/src/modules/admin/admin.service.ts` — `GET /admin/migration-history` returns
  `{ runs, schema }`. `schema` is read live (the shipped `prisma/migrations` folders against
  `_prisma_migrations`): total, applied, pending, failed. Needed because `xentium update`
  migrates through the CLI and never writes a history row.

## Web

- `features/admin/pages/migrationHistory/model.ts` (+ 16 tests) — pure rules: effective status
  incl. `stalled`, durations (a stalled run up to its last heartbeat), `packageOf` from the
  stored command, `entityKey` (counts are camelCase plurals, errors snake_case singulars),
  `inLoadOrder` (⚠ `jsonb` reorders keys shortest-first — never trust object order), core
  output analysis (found / applied / failed migration / error line), issue grouping, log
  tones + noise folding + search.
- `features/admin/pages/MigrationHistoryPage.tsx` — rewritten on the `pg-head` shell: stats
  strip, run list (search incl. output, type segment, status chips with a "Not responding" chip
  that only appears when needed, day groups), detail (meta, callouts, progress/imported
  counts, grouped issues, commands with copy, log viewer with find/hide noise/copy/download/
  full screen + Esc, follows the tail of a live log). Polls every 2 s only while an import is
  alive. The old output-regex "failed" guess is gone.
- `features/admin/pages/MigrationHistory.scss` — ACP tokens only; one status→colour map.
- `public/locales/*/acp.json` — `migrations.*` rewritten, 119 keys, all five languages.

## Docs

- `docs/API.md` — the endpoint's new shape. `README.md` (→ wiki guide) — imports can be
  watched live; commands come back without connection strings.

## Verified (migration history)

- The REAL runner against `xentium_test` with a fake adapter: row "running" before
  extraction, heartbeat during it, source filled in after, final row completed with counts,
  full log, final progress, masked command (no password/user/host). Probe data removed.
- In the browser with seeded runs + a simulated live import: every status, the failed-deploy
  callout and its Line jump, partial import, filters/search, full screen + Esc, live counts
  moving, and the live row turning "Not responding" 2 min after its last heartbeat without a
  reload. Seeded rows removed and the dev announcement restored afterwards.
- Not checked: phone width (the layout collapses at 900 px by media query), the Download
  button (it saves a file).

# 2. Announcements

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

## Verified (announcements)

- `pnpm backbone:check` green after both changes: API 454/454, web 784/784, migrate-core 10/10, CLI 20/20.
- The lock and the dismissal run against the real dev Postgres: a second writer waits for the
  first (`A in → A out → B in → B out`), dismissal empties the cache and keeps only the id, and
  the acks table is gone after `migrate deploy`.
- In the browser, with two seeded notices: the `important` one opens first with its badge,
  body (line breaks kept), link and the new note; OK removes it on the server and the `info`
  one follows; after its OK a reload shows no dialog; no band, no nav entry, and
  `/admin/announcements` is the normal 404. The dev database's announcement settings were
  restored afterwards.
