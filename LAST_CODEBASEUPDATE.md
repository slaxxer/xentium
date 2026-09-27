# Last codebase update

Composer click fix.

- `apps/web/src/components/composer/Composer.tsx`: a press on the body's empty area puts the caret at
  the end of the text. With `minHeight` the editable element stayed one line tall, so clicks in the rest
  of the box focused nothing. `EditorContent` gets `className="nvc-editor"` so a press on its wrapper
  counts too.
- `CHANGELOG.md`: Fixed entry for the above.

ACP Users redesign (nodevo-redesign/Admin user management redesign):
- `apps/api/src/modules/admin/adminUsers.service.ts` (new, + `adminUsers.test.ts`): the list (status, sort, search by
  name/email/id/IP, counts, last seen from sessions, online from Redis, flags), the member page with an explicit
  select (no password or PIN hash), known IPs/devices, and `patchUserGroups` (add/remove, never replace).
- `admin.service.ts`: `listUsers` / `getUserDetail` / `patchUserGroups` delegate to it.
- `admin.controller.ts` + `admin.routes.ts`: `status` and `sort` on `GET /admin/users` (status was silently dropped),
  `PATCH /admin/users/:id/groups {add, remove}`.
- `apps/web/src/features/admin/pages/UserListPage.tsx`: rebuilt (command bar, segments, table, selection, bulk bar).
- `apps/web/src/features/admin/pages/UserDetailPage.tsx` + `.scss`: tabs, risk banner, membership draft saved as a
  delta, security tiles, event table with device names, ban reason line.
- `apps/web/src/features/admin/pages/users/usersShared.tsx` + `Users.scss` (new): types, role/status/flag pills,
  the ban dialog with presets (one request per member).
- Locales x5: `acp.users.*`.
- `docs/API.md`: `GET /admin/users` query + response, `GET /admin/users/:id`, `PATCH /admin/users/:id/groups`.

Create/edit article redesign (nodevo-redesign/Create article redesign):
- `apps/web/src/features/articles/ArticleEditorPage.tsx` + `.scss`: rebuilt (top bar with save chip, full-width
  canvas, excerpt, the shared Composer as the body, inline publish requirements, Details slide-over). Status is
  Draft/Published (unpublish on switch back); "Review" removed (the API cannot store it). Local autosave only
  when the form differs from the last server save (fixes the false "unsaved draft" prompt after saving).
  New prefix `aed`.
- `apps/web/src/features/admin/pages/PageEditorPage.scss` (moved from `ArticleEditorPage.scss`): the ACP page
  editor keeps the old `aep` styles.
- `apps/web/src/components/composer/Composer.tsx` (+ tests): `initialJson` / `onChangeJson`, `extraExtensions`,
  `mentions`, `getJSON()` on the handle; `setEditable(…, false)` so mounting is not reported as an edit.
- Locales x5: `articles.editor.*` additions.

ACP Review Cases redesign (nodevo-redesign/MOD page Review Cases redesign):
- `prisma/schema.prisma` + `migrations/20260927140000_case_assignee`: `xcf_moderation_cases.assigned_to`.
- `apps/api/src/modules/admin/adminCases.service.ts` (new, + `adminCases.test.ts`): list with status/type/severity/sort,
  per-status counts, per-account registered/last login/last IP/status/willBeBanned, per-case IPs + shared identifiers
  (the old list attached one page-wide IP list to every case), `assignCase` (staff only, logged).
- `admin.controller.ts` / `admin.routes.ts`: new list query, `detection` status from the security-analysis job,
  `PATCH /admin/cases/:id/assign`, optional ban reason. Old `adminService.listCases` removed.
- `modules/moderation/moderation.service.ts`: `banCaseUsers(id, actor, reason?)` records the reason and now revokes
  sessions + in-flight access tokens (it left banned accounts signed in).
- `apps/web/src/features/admin/pages/ReviewCasesPage.tsx` + `.scss`: list + detail, filters, evidence, linked accounts,
  assignee, auto-saving note, ban previews (single + bulk), two empty states.
- Locales x5 (`acp.modCases.*`), `docs/API.md`.

ACP Mod Settings redesign (nodevo-redesign/Mod settings page redesign):
- The page saved eight settings nothing on the server read, and its warning thresholds were hard-coded rows that
  never saved. Everything on it is now enforced.
- `apps/api/src/modules/moderation/moderationPolicy.ts` (new): `getModPolicy()` (one reader for expiry, ladder, ban
  range, override, reset-after-ban), `warningExpiry()`, `checkBanLength()`.
- `moderation.service.ts`: warnings get the policy's expiry; `countedWarnings()` skips expired warnings (nothing ever
  flips them to "expired") and, with reset on, those before the latest ban; a ladder step fires at EXACTLY its count
  (the 3-warning temp ban used to re-run on the 4th); new `notify` step + per-step moderator notice; `issueBan` checks
  the range and now signs the member out, as does `autoBan`. `moderation.types.ts`: `ThresholdRule` gains `notify` +
  `notifyModerators`.
- `admin.service.ts` `banUser`: range check + override noted in the mod log.
- `apps/api/src/modules/admin/modSettings.service.ts` (new, + `modSettings.test.ts`): Zod-validated
  `GET/PATCH /admin/mod-settings`, per-section writes, per-pattern plugin claim + cases in the last 7 days.
  `core/security/security-scan-registry.ts`: `claimant()`.
- `GET /moderation/ban-policy`; the ACP ban dialog (`users/usersShared.tsx`) and the ModCP ban form
  (`modcp/UsersSection.tsx`) open at the default length.
- `apps/web/src/features/admin/pages/ModSettingsPage.tsx` + `.scss` (prefix `ms-`): Warnings / Bans / Detection tabs
  (`?tab=`), lifetime banner, ladder rail + step editor, range validation, confirm dialogs, per-pattern case counts.
  Ban appeals left out: no appeal feature exists. Detection thresholds stay fixed in core.
- `ReviewCasesPage.tsx`: reads `?type=` / `?status=` so "See them" opens pre-filtered.
- Locales x5 (`acp.modSettings.*` replaced), `docs/API.md`.

Theme flash on load (the default look painted before the site's theme):
- `apps/api/src/app/serveWeb.ts`: `injectThemeCss()` inlines the visitor's stylesheet (the live sheet, or their own
  `xt_theme` choice) into the served index.html as `<style id="xentium-custom-tokens" data-style-version>`, so the
  first paint is the theme. It used to arrive from a React effect after the bundle mounted. Best-effort: a sheet that
  cannot be built leaves the page as before. `</style` is escaped; the replacer is a function so `$&` in CSS survives.
  Test: `serveWeb.test.ts`.
- `apps/web/src/lib/liveStyle.ts`: adopts the inlined sheet's version before the startup fetch, so the stream can
  reconcile it. A visitor wearing their own theme no longer refreshes layouts on the stream's connect echo (it
  refetched `/layouts` on every load).
- Layouts, same fix: `serveWeb.ts` `injectLayouts()` inlines the published documents (the viewer's theme set when
  they wear one) as `<script id="xentium-layouts" type="application/json" data-theme>`; `layout/useLayout.ts`
  `takeInlinedLayouts()` seeds the layouts query once, only when the theme matches, never for a draft preview.
  Pages used to render the code-default arrangement until `/layouts` answered. Tests: `serveWeb.test.ts`,
  `layout/inlinedLayouts.test.ts`.

ModCanvas redesign (nodevo-redesign/ModCanvas redesign options, split inspector):
- Shell (`features/modcp/ModCanvas.tsx` + `.scss`): a 940px slide-over from the right with one tab strip in the header
  (Reports, Cases, Users, plugin sections, Audit log). The centred modal, nav rail, dashboard and footer
  are gone. Shift+M / Esc / draggable trigger kept.
- Reports (`ReportsInspector.tsx`): list | detail. Reports about one thing are one row (×N); detail shows the snapshot,
  every reporter, the author's standing and the ladder step the next warning hits; a composer with Warn / Ban /
  Remove / Dismiss, premade-text chips (1-9), editable message, duration, notify toggle. J/K walk the list. Claim,
  bulk resolve/dismiss, Undo (8s) for dismissals. Below 780px: list, tap, detail with a back button.
- Templates are managed in the ACP, not the canvas: `features/admin/pages/ModTemplatesPage.tsx` + `.scss`
  (ACP → Moderation → Templates, `/admin/mod-templates`, `?id=` selects): grouped list, autosaving editor, variables
  insert at the cursor (append when the field is not focused), live preview, duplicate, delete, "Restore defaults".
  Locales x5 (`acp.modTemplates.*`, `nav.modTemplates`). ModCanvas only READS the texts (`GET /moderation/templates`);
  its "Manage templates" link opens the ACP page and is shown to admins only. `modTemplates.ts` (+ test) is shared.
- Server: `xcf_moderation_templates` (migration `20260927180000_moderation_templates`, 13 starting texts);
  `modCanvas.service.ts` (+ `modCanvas.test.ts`): `GET /moderation/inspector`, `POST /reports/act|status|claim`,
  template reads. Template writes live in the admin API (`/admin/mod-templates`, + `restore-defaults`, which re-adds
  missing defaults from `DEFAULT_TEMPLATES` and never overwrites an edited one; `isDefault` on each row).
  `reportTarget.ts`: a report on core content now records its author and a snapshot (both columns
  existed and nothing filled them). `issueWarning`/`issueBan` take `notify`. `assertPermission()` for input-dependent
  checks. Suggestions tie toward the milder action; template order is stable.
- `docs/API.md`.

Level-up dialog (one-time, animated, when a member climbs a rung):
- `prisma/schema.prisma` + migration `20260927200000_level_ups`: `xcf_level_ups` (user, from/to group, seen_at).
- `jobs/checkPromotion.ts`: a promotion records the climb, only while "notify on promote" is on (turning notices
  back on must not replay old climbs). The notice setting is now read before the transaction.
- `progression.service.ts`: `getPendingLevelUp` (newest unseen climb, what that rung unlocks, the next goal; a climb
  to a deleted rung is spent quietly) and `markLevelUpsSeen`. Routes `GET /users/me/level-up`,
  `POST /users/me/level-up/seen`. Test: `progression/levelUp.test.ts`.
- `features/progression/LevelUpDialog.tsx` + `.scss`, mounted in `AppLayout`: medal in the rank's colour, conic
  ring, pulse rings, confetti burst, twinkles, staggered text; still under prefers-reduced-motion. Polls each minute
  and re-checks when the bell's unread count moves. Esc / overlay / button mark it seen. Locales x5
  (`profiles.levelUp.*`), `docs/API.md`.

Readable text sizes (the site ran at 11–13px):
- `apps/web/src/styles/_tokenDefaults.scss`: one type scale in rem (`--fs-2xs` 12px … `--fs-3xl`, new `--fs-2xs`,
  `--fs-md`, `--fs-read`); `--fs-xs` is now 13px. 12px is the floor.
- `styles/index.scss`: `html { font-size: 100% }` (was a fixed 16px, which ignored the browser's text size; never
  a token, because the Style Editor's size writes `--fs-base`). Touch screens: form fields at least 16px (iOS zoom).
- Every fixed px font size in `apps/web/src` (1,440) moved to the scale: <=11.5px → 12, 12 → 13, 12.5–13 → 14,
  13.5–14 → 15, 14.5–16 → 16; 17px and up keep their size in rem. Article body → `--fs-read`.
- Dashboard KPI labels stay on one line. `docs/style-system.md`: the text-size tokens.

Style Editor reaches every token, and a site-wide text size:
- `packages/contracts/src/tokens.ts`: `TOKEN_REGISTRY` gains every token the site declares that the editor could
  not reach (73): tints & states (`--c-accent-soft` …), shadows, corners, type steps + font stacks, spacing, page
  layout, button sizing, and the base palette (primitives). New groups, new `text` control.
- `apps/web/src/features/admin/pages/tokenDefaults.ts`: starting values read from `_tokenDefaults.scss` (`?raw`),
  so no row is blank; `resolveColor` shows rgba/var/color-mix defaults in the colour picker.
- `styleTokens.ts` + `StyleEditorPage.tsx`: seven new sections (kind `foundation`), the text control, resolved
  colours. `foundationCoverage.test.ts` fails when a stylesheet token has no editor row (it reads the file from
  disk: a `?raw` stylesheet import is empty under Vitest).
- Text size: every `--fs-*` step is `calc(<rem> * var(--fs-scale))`; the Style Editor's size (now shown as a %)
  sets `--fs-scale` (`fontScale()` in contracts) instead of only `--fs-base`. The ACP pins `--fs-scale: 1`.
- Locales x5: section names, `kFoundation`, `textSize`, and 79 token names (incl. the base palette). `docs/style-system.md`.
