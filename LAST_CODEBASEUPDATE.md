# Last codebase update

Four changes this session, all unpushed:

1. **Sign-in and registration redesign** (the `nodevo-redesign/Login and registration
   redesign` mock) with every method it shows: passkeys, sign-in links, Google/GitHub/
   Discord, "keep me signed in".
2. **Groups redesign.**
3. **Migration History redesign** (+ `xentium update` records deploys).
4. **Announcements:** back to the dialog, no page, no per-admin record.

# S. Sign-in methods

## Server (`apps/api/src/modules/auth/`)

- `auth.signin.ts` — `finishSignIn(userId, ctx, { method, persistent, pinVerified })`: the one
  last mile for every non-password method (active, ban, PIN, plugin guards, login event,
  session). A PIN returns a single-use Redis ticket (5 min, burns after 5 wrong PINs);
  `completePinStep` + `POST /auth/login/pin`. `respondSignIn` = the password endpoint's shape.
- `auth.tokens.ts` / `shared/http/cookies.ts` / migration `session_persistent` — "keep me
  signed in": `Session.persistent`; false = no cookie max-age + 12h server expiry, carried
  across every rotation. `POST /auth/login { remember }` (default true).
- `magicLink.service.ts` — HMAC-hashed Redis token, 15 min, `GETDEL` = single use; always
  200; email template `magic_link` (+ ACP label ×5). Landing page requires a click.
- `passkey.service.ts` — @simplewebauthn/server v14. RP = `APP_URL` host; available on https
  or localhost. Discoverable credentials (user handle = user id). Challenges in Redis, used
  once. Counter regression refused by the library. `userVerified` → skips the login PIN.
  Migration `passkeys_oauth`: `xcf_passkeys`, `xcf_oauth_accounts`.
- `oauth.service.ts` — Google/GitHub/Discord, auth code + PKCE S256; state in Redis (10 min,
  single use) AND pinned to the browser by a signed Lax cookie (login-CSRF). Match by
  provider id only; an existing member's email is NOT auto-linked (AUTH_OAUTH_EMAIL_TAKEN);
  unverified email never creates an account; `beforeRegister` guards + registration mode
  apply (guard refusal code passed through). Provider-created accounts: password hash
  `!oauth:…` (never verifies — the importers' convention). Secrets encrypted (secretBox),
  write-only. `handleCallback` takes injectable exchange/profile for tests.
- `signInMethods.service.ts` — `assertKeepsASignInMethod`: never remove the last way in.
- `auth.methods.controller.ts` + routes: `/auth/methods`, `/auth/doorway` (1-min cache;
  members-only profiles excluded from joiners), passkey, oauth, `/auth/sign-in-methods`;
  ACP `/admin/auth-providers`. `/auth/register/check-invite` (auth.controller).
- `packages/contracts/src/xec.ts` — AUTH_LINK_INVALID 1011, PASSKEY_FAILED 1050,
  PASSKEY_UNAVAILABLE 1051, OAUTH_FAILED 1060, OAUTH_EMAIL_TAKEN 1061, OAUTH_UNAVAILABLE 1062,
  LAST_SIGNIN_METHOD 1063 (+ Error Reference entries, translated ×5).
- Tests: `signInMethods.test.ts` (7), `oauth.test.ts` (9), `passkey.test.ts` (5).

## Web

- `features/auth/doorway/` replaces LoginPage/RegisterPage/ForgotPasswordPage/
  ResetPasswordPage (+ their SCSS, aurora-layout) — all deleted. `AuthDoorway` (shell,
  welcome side, tabs, language menu), `SignInPanel` (+ `MagicLinkRequest`), `RegisterPanel`
  (invite-first screen, 3 steps, done; keeps profile fields, name, terms, plugin-worded closed
  screens; passkey made AFTER the account exists), `RecoveryPanels` (forgot, reset, link
  landing, `/login/complete`), `pieces`, `signInClient`, `authErrors`, `Doorway.scss` (site
  tokens only). Routes `/login/link`, `/login/complete`. + `doorway.test.ts` (12).
- `features/account/tabs/SignInMethodsCards.tsx` — Passkeys (inline rename), Connected
  accounts (reports `?connected`/`?oauthError` once), `SetPasswordHint` for password-less
  accounts; wired into SecurityTab.
- `features/admin/pages/SignInProvidersPanel.tsx` under Settings → Login (autosave toggle +
  client id via functional updates — a same-tick edit used to overwrite the toggle; secret
  Set/Remove explicit; callback URL copy; passkey status). Styles in acpSystem.scss.
- Deps: @simplewebauthn/browser, @fortawesome/free-brands-svg-icons pinned 7.2.0 (must match
  free-solid, or the icon types clash).
- Locales: auth `door.*` (137 keys, old login/register/forgot/reset/closed/pin removed),
  account `signin.*` (32), acp `signInProviders.*` (16) — all ×5.

## Docs

- `apps/docs/.../admin/sign-in.md` (new), `docs/API.md`.

## Verified (sign-in)

- Browser: doorway vs mock; wrong password; provider error from the URL (re-worded on
  language change); full registration with PIN via the dev code; password + PIN with
  "keep me signed in" off → session `persistent=false`, 12h; sign-in link → Continue →
  ticket PIN (wrong then right) → signed in, link dead afterwards; forgot page; completion
  page's stuck state; provider start URL (PKCE S256, state, callback) and a forged callback
  → `/login?error=XEC-AUTH-1060`; ACP panel incl. the stale-closure fix; account cards.
- NOT verified in a browser: a real passkey ceremony (the prompt is a native modal and no
  virtual authenticator is attached) and a real Google/GitHub/Discord round trip (needs a
  registered app). Server logic for both is unit-tested.
- Test data removed. The dev site's announcement was dismissed during testing; its
  dismissal is cleared, so it returns on the next successful announcement check.

# 0. Groups

## API

- `groups.service.ts` / `.controller.ts` / `.routes.ts`
  - `PATCH /groups/:id/permissions` `{ grant, revoke }` → `patchPermissions`: changes only
    those keys (`skipDuplicates`, a key in both lists is revoked), busts the permission
    cache. ⚠ WHY: the page first saved by `PUT` (replace the whole set) from a copy taken
    at mount, and while testing it lost a real grant (`forum.moderate`) that way. The exact
    trigger was never reproduced, but the class is plain: any grant made after the page
    opened is reverted by the next click. `PUT` stays for callers that mean "replace".
  - `DELETE /groups/:id/icon` → `removeIcon` (idempotent, deletes the file).
  - `uploadIcon` now takes the DETECTED extension (`req.file.detectedExt`, never the
    client's filename) and deletes the previous file when the extension changed.
- Tests: `groupPermissionsPatch.test.ts` (untouched keys survive), `groupIcon.test.ts`
  (in-memory storage mock: never writes to a real upload dir).

## Web

- `pages/GroupsPage.tsx` — the list: `pg-head`, filter, inline create card (key follows
  the name until edited), stats, precedence table. Reorder is optimistic via
  `PUT /groups/reorder`; native drag and a keyboard path (Alt+↑/↓ on the handle); disabled
  while filtering (precedence of a filtered subset is ambiguous).
- `pages/groups/GroupDetailPage.tsx` — `/admin/groups/:id?tab=…`, remounted per id (drafts
  are seeded once). Group form + progression autosave through `useAutosave`; permissions
  are NOT a draft: optimistic cache update → PATCH delta → refetch, one mutation `scope`
  so clicks arrive in order, `cancelQueries` first. One `SaveChip` = own mutations +
  `useAnySaving()` (plugin panels).
  ⚠ `editableProgression()` reduces the progression row to editable fields: the PATCH
  response carries `updatedAt`, and comparing whole rows would autosave forever.
- `groups/IdentityTab.tsx` (colour = swatches + picker + hex, hex-only because the column
  is 20 chars and colours get alpha-suffixed; glow incl. custom glow colour; preview uses the
  signed-in admin; icon card; delete card with `openDialog` confirm), `PermissionsTab.tsx`
  (domains, sensitive markers, fill bars, grant/revoke all), `ProgressionTab.tsx`,
  `MembersTab.tsx` (users API filtered by group; add/remove send the user's FULL group set
  because `PUT /users/:id/groups` replaces it), `PluginPanelTab.tsx` (error boundary,
  off-ladder warning, owner via `slotRegistry.ownerOf`).
- `groups/groupModel.ts` (+ 7 tests) — types, `powerOf`, `isSensitive` (core list + the
  `admin./plugin./system.` / `.manage` / `.settings` rule for plugin keys), `reorder`,
  `glowShadow`, `editableProgression`. `groups/groupParts.tsx`, `groups/Groups.scss`.
- `components/AutosaveStatus.tsx` — `SaveChipHost` context: inside it, `AutosaveStatus`
  reports via `useReportSaving` and renders nothing. Shipped plugin panels (the forum's
  renders `AutosaveStatus`) therefore report to the group page's chip with no rebuild.
  + `AutosaveStatus.test.tsx`.
- `App.tsx` route `groups/:id`; `AcpLayout.scss` — dead `.acp-perm-row`, `.acp-groups-grid`,
  `.acp-group-card` removed (checked: no core or official-plugin use).
- `locales/*/acp.json` — `groups.*` rewritten, 135 keys, five languages.

## Docs

- `docs/API.md` (new endpoints), `docs/plugin-acp-autosave.md` + `README.md` (panels are
  tabs of the group page; report, don't draw a chip).

## Verified (groups)

- Browser: list vs mock; keyboard reorder persisted dense 1..N; Identity autosave (three
  edits → one save, no repeat); permissions delta with a grant made directly in the DB
  while the page was open: kept after a toggle on the page; members add (kept the user's
  admin group) / remove via confirm; a test groupConfigPanel as a tab, its save report
  driving the page chip; create → lands on the new page; delete via confirm. Dev data
  restored by targeted updates afterwards (no TRUNCATE: other tables reference groups).
- Not checked: drag with a real mouse (CDP drags don't fire HTML5 dnd; the drop calls the
  same `move()` the keyboard path does), phone width, an icon upload (unit-tested).
- Noticed, not fixed: `slotRegistry._activePlugin` is never cleared after plugin loading,
  so anything registered outside a plugin later is attributed to the last plugin loaded.

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

## `xentium update` records deploys (follow-up, same session)

- `packages/cli/src/release.ts` — `migrate` returns its output and throws `MigrateError`
  carrying the full output. `recordDeploy(site, record)` inserts a core row through `psql`
  (the CLI has no DB driver; psql ships with the pg_dump the backup already needs). Every
  value is a psql variable quoted by psql (`:'name'`), which only works in a script file, not
  `-c` — hence a 0600 temp file in `shared/backups`, removed in `finally`. Times written as
  UTC explicitly (the columns are zone-less, a DB default would use the session zone); `id`
  is `gen_random_uuid()::text` (no DB default). Best effort: false on no psql / no URL /
  failed write. Verified against `xentium_test` with hostile output (quotes, backslashes,
  `:'version'`, `'); DROP TABLE …`): stored byte for byte, table intact, times exact.
- `packages/cli/src/update.ts` — records only when migrations ran. Success: after the health
  check (or right away for a non-systemd site). Migrate failure: AFTER the automatic restore,
  because the restore rewinds the history table too. Health-check rollback: recorded as
  `failed` with a line saying whether the restore worked (`restoreQuietly` now returns it).
- `MigrationHistoryPage.tsx` — a deploy with `adapterVer` (only `xentium update` sets it)
  shows `v<version>` in the list and detail, and its Command is `xentium update <version>`.

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

- `pnpm backbone:check` green after all changes: API 483/483, web 800/800, migrate-core 10/10, CLI 21/21.
- The lock and the dismissal run against the real dev Postgres: a second writer waits for the
  first (`A in → A out → B in → B out`), dismissal empties the cache and keeps only the id, and
  the acks table is gone after `migrate deploy`.
- In the browser, with two seeded notices: the `important` one opens first with its badge,
  body (line breaks kept), link and the new note; OK removes it on the server and the `info`
  one follows; after its OK a reload shows no dialog; no band, no nav entry, and
  `/admin/announcements` is the normal 404. The dev database's announcement settings were
  restored afterwards.
