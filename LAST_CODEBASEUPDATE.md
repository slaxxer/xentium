# Last codebase update — 2026-10-08

## ACP button height

| File | Purpose |
|---|---|
| `apps/web/src/styles/buttons.scss` | `height: var(--btn-h, auto)` on the shared box; `body.xt-acp` sets `--btn-h` 38 / `--btn-h-sm` 28 / `--btn-h-lg` 46, nowrap |
| `apps/web/src/features/admin/AcpSaveBar.scss` | Discard/Review/Stay read the button tokens; Save takes `.btn-primary`'s box |
| `apps/web/src/features/admin/AcpLayout.scss`, `pages/ReviewCasesPage.scss`, `pages/users/Users.scss`, `pages/ScheduledJobsPage.scss` | bespoke ACP buttons use `--btn-h` / `--btn-h-sm` |
| `apps/web/src/components/DialogHost.scss` | dialog buttons take `--btn-h` where set |

## Permissions over group names

| File | Purpose |
|---|---|
| `apps/api/src/core/plugin-engine/plugin-context.ts` | `registerPermissions` applies default groups only when the permission is first created (was every boot, undoing ACP revocations) |
| `apps/api/src/shared/middleware/requirePermission.ts` | `effectivePermissions(userId)` |
| `apps/api/src/modules/auth/auth.controller.ts` | `/auth/me` returns `permissions` (effective keys) |
| `apps/web/src/lib/authStore.ts` | `AuthUser.permissions?`, `userCan(user, key)` |
| `packages/contracts/src/permissions.ts` | `moderation.protected` ("counts as staff") |
| `apps/api/src/bootstrap/registerCorePermissions.ts` (+ `.test.ts`) | defaults granted only for newly created keys; system groups never renamed back |
| `apps/api/src/shared/utils/staff.ts` | new: `groupKeysWith(key)`, `staffGroupKeys()` |
| `apps/api/src/modules/moderation/moderation.service.ts`, `standing.ts` | warn/ban/case-ban/auto-ban staff skip via `moderation.protected`; standing via warn/ban permissions; auto-ban attribution = oldest `admin.access` holder |
| `apps/api/src/modules/admin/adminCases.service.ts` | staff status via permission; case assignee needs `moderation.cases.manage` |
| `apps/api/src/modules/users/users.repository.ts` | members Staff filter/facet from permission |
| `apps/api/src/modules/auth/auth.signin.ts` | `isStaffUser` = `moderation.protected` |
| `apps/web/src/features/admin/AcpLayout.tsx`, `layouts/PubNav.tsx`, `features/errors/ErrorScreen.tsx`, `layout/previewSample.ts` (+ test), `features/modcp/{modData.ts,ModShield.tsx,ModCanvas.tsx,ReportPill.tsx}`, `features/articles/{ArticleReaderPage,ArticleEditorPage}.tsx`, `features/legal/LegalPage.tsx`, `features/profiles/ProfilePage.tsx` | group-key checks → `userCan(user, key)` |
| `apps/web/src/lib/permissions.ts` | label for `moderation.protected`; a registered human label wins over the key-derived one |

## Plugin permission check

| File | Purpose |
|---|---|
| `apps/api/src/shared/middleware/requirePermission.ts` | `hasPermission(userId, key)` (non-throwing, same effective set) |
| `apps/api/src/shared/middleware/hasPermission.test.ts` | new: holder vs non-holder, agrees with `assertPermission` |
| `apps/api/src/core/plugin-engine/plugin-context.ts`, `packages/plugin-sdk/src` | `host.permissions.has` (optional in the SDK type) |
| `docs/plugin-registries.md` | how to ask instead of refuse |

## Rich text: posted content mirrors the editor

| File | Purpose |
|---|---|
| `apps/api/src/shared/sanitize/richText.ts` | allowlist = exactly the Composer's output: `text-align` (4 values, block tags only), sub/sup, h5/h6, task lists (`data-*`, label, read-only checkbox, div), mention attrs + known classes |
| `apps/api/src/shared/sanitize/richText.editor.test.ts` | new: every editor format survives unchanged; other styles, inputs, handlers, classes still stripped |
| `apps/web/src/styles/_richContent.scss`, `styles/rich.scss`, `styles/index.scss` | new shared `rich-content` mixin; global `.xt-rich` |
| `apps/web/src/components/composer/Composer.scss` | `.nvc-content` uses the shared mixin |
| `apps/web/src/components/composer/popovers.tsx`, `Composer.scss` | editor popovers portalled to body, fixed to their button (up, or down without room), clamped to the window, follow scroll |
| `apps/web/src/components/composer/Composer.{tsx,scss}`, `components/MiniEditor.tsx` | `renderPreview` option: a surface draws its own Preview (default preview also wears `xt-rich`) |
| `apps/web/src/components/composer/alignPerBlock.{ts,test.ts}` | new: Enter at the end of an aligned block starts the next at the default (mid-split keeps it); in Composer + `RICH_EXTENSIONS` |
| `apps/web/src/features/articles/ArticleReaderPage.tsx`, `profiles/ProfilePage.tsx`, `articles/components/ArticleContent.tsx` | displayed rich text wears `xt-rich` |
| `apps/web/src/layouts/AppLayout.scss` | `.app-main` gap named `--main-gap` (for flush page bars) |
| `apps/web/src/features/articles/components/ArticleEditor.tsx` | display-only Mention in `RICH_EXTENSIONS` (article mentions no longer dropped) |

## Site time zone and date/time format

| File | Purpose |
|---|---|
| `apps/web/src/lib/datetime.ts` | new: `formatDate` / `formatTime` / `formatDateTime` / `formatStamp` (Today/Yesterday in the site's zone) and `useDateTime()` |
| `apps/web/src/lib/datetime.test.ts` | new: clock, zone, date styles, day roll-over, today/yesterday decided in the site's zone |
| `apps/api/src/modules/site/site.service.ts` | site config `time: { zone \| null, timeFormat, dateFormat }`, normalised on read (`visitor` / unknown zone → null) |
| `apps/api/src/modules/admin/admin.service.ts`, `apps/web/src/features/admin/pages/SettingsPage.tsx` | `site.time_format`, `site.date_format` defaults + fields; timezone gains "Each visitor's own" |
| `apps/web/src/hooks/useSiteConfig.ts` | `time` on the config type |
| `apps/web/src/features/articles/ArticleReaderPage.tsx`, `components/ArticleCard.tsx` | published date + time, comment stamps, card dates through the formatter |
| `apps/web/src/plugins/host-globals.ts` | `webDateTime` host global |
| `apps/web/public/locales/*/acp.json` | settings fields + options for zone / time / date format |

## Icon size

| File | Purpose |
|---|---|
| `apps/web/src/components/Icon.{tsx,scss}` | site icons (never ACP scope) get `xt-ico`; `.xt-ico { zoom: var(--icon-scale, 1) }` |
| `apps/web/src/components/IconScale.test.tsx` | new: site icons scaled with the caller's class kept; ACP icons not |
| `apps/web/src/features/admin/pages/StyleEditorPage.{tsx,scss}` | Icon size stepper (70–200%, stock = no override) under Typography |
| `packages/contracts/src/appearance.ts` | `--icon-scale: 1` default |
| `docs/style-system.md` | the icon size section |
| `apps/web/src/layouts/PubNav.tsx`, `features/auth/doorway/SignInMenu.tsx`, `layouts/AppLayout.scss`, `doorway/Doorway.scss` | guest Register / Sign in as icons (faUserPlus, faRightToBracket) with aria-label + title |
| `apps/web/public/locales/*/acp.json` | `styleEditor.iconSize*` |

## Profile Warnings tab + local IP geolocation

| File | Purpose |
|---|---|
| `apps/api/src/modules/moderation/standing.ts` | new: `getStanding` (member or staff only), `effectiveStatus`, `ladderPosition` (next SANCTION step), staff-only bans + IPs with country and shared-account counts |
| `apps/api/src/modules/moderation/standing.test.ts` | new: access, member vs staff payloads, ladder position, date-based expiry |
| `apps/api/src/modules/users/users.{routes,controller}.ts` | `GET /users/:id/standing` (requireAuth) |
| `apps/api/src/infrastructure/geoip.ts` | new: local mmdb lookup (`countryOf`), monthly `refreshGeoip` with verify + atomic swap, `var/geoip` |
| `apps/api/src/jobs/geoipRefresh.ts`, `jobs/scheduledJobs.ts`, `infrastructure/queue.ts`, `workerBoot.ts` | new `geoip-refresh` job (monthly, Run now) |
| `apps/api/package.json` | `maxmind` (mmdb reader) |
| `apps/web/src/features/profiles/WarningsTab.{tsx,scss}` | new: alert, standing summary + ladder, warnings by status, staff bans + IP table, DB-IP credit |
| `apps/web/src/features/profiles/ProfilePage.tsx`, `layout/blocks/profileBlocks.tsx` | Warnings tab for the member and staff only; deep link falls back to Articles |
| `apps/web/public/locales/*/profiles.json` | `tabs.warnings`, `standing.*` |

## Chamfered profile card fix

| File | Purpose |
|---|---|
| `apps/web/src/features/profiles/ProfilePage.scss` | name row and actions share one line (`--profile-row-h`, same top offset); cover takes the top-right chamfer; a card under a cover gets an upward-open clip (avatar no longer sliced) keeping only the bottom-left cut; collapses to no clip when `--corner-cut` is 0 |

## One toggle switch across ACP and site

| File | Purpose |
|---|---|
| `apps/web/src/components/Toggle.{tsx,scss}` | new: `Toggle` (button role=switch, FA toggle glyph, accent on / muted off) + `ToggleGlyph` (glyph only, `implied` state); legacy `.sw` / `.account-toggle__btn` drawn as the same glyph via CSS mask |
| `apps/web/src/components/AcpControls.tsx` | re-exports `Toggle`/`ToggleGlyph` (host global `webAcpControls`) |
| `apps/web/src/features/account/components/AccountCard.tsx` | `AccountSwitch` renders `Toggle` |
| `apps/web/src/features/admin/pages/{ProgressionPage,NavigationPage}.tsx` | their hand-built icon toggles → `Toggle` |
| `apps/web/src/features/admin/pages/permissions/SplitView.tsx`, `Permissions.scss` | tile switch → `ToggleGlyph` (implied = half strength); `.pm-sw` removed |
| `apps/web/src/components/SchemaFields.{tsx,scss}` | compact boolean switch shows `ToggleGlyph` over the real checkbox |
| `apps/web/src/features/admin/pages/acpSystem.scss`, `account/AccountPage.scss`, `groups/Groups.scss` | old switch rules removed; layout rules target `.xt-toggle` |
| `apps/web/src/components/NotificationBell.tsx` | bell is `faBell` (fa-solid fa-bell) via the kit-aware icon, not an inline outline SVG |

## Header widgets and plugin pages for members only

| File | Purpose |
|---|---|
| `apps/web/src/components/MembersOnly.tsx` | new: `MembersOnly` (guest → `/login?returnTo=`, waits while the session restores) and `MemberWidget` |
| `apps/web/src/components/MembersOnly.test.tsx` | new: guest redirect with returnTo, member through, nothing while restoring, widget hidden for guests |
| `apps/web/src/layout/blocks/chromeBlocks.tsx`, `layout/slotBlocks.tsx` | every header-widget render path goes through `MemberWidget` (cluster, own block, navbar carry-over) |
| `apps/web/src/plugins/slotRegistry.ts`, `app/App.tsx` | `PluginRoute.requiresAuth`; public plugin routes with it are wrapped in `MembersOnly` |
| `docs/plugin-registries.md` | pages and header widgets: who sees them |

## Xentium icon as the default logo + logo border/shadow

| File | Purpose |
|---|---|
| `apps/web/public/favicon.ico`, `public/brand/*`, `public/manifest.webmanifest` | the shipped icon set (favicon, apple-touch, 192/512, tile + lockup SVGs) |
| `apps/web/index.html` | icon, apple-touch and manifest links |
| `apps/web/src/components/XentiumMark.{tsx,scss}` | new: the icon inline (unique gradient ids, small-size geometry, box colours from `--logo-icon-from/to`, `brand` keeps Xentium's); `.xt-logo-fx` border/shadow |
| `apps/web/src/components/XentiumMark.test.tsx` | new: gradient ids, small geometry, aria |
| `apps/web/src/components/SiteLogo.tsx` | new: uploaded logo, else the mark + wordmark |
| `apps/web/src/layouts/PubNav.tsx`, `AppLayout.{tsx,scss}` | NavLogo uses SiteLogo; uploaded favicon replaces EVERY icon link |
| `apps/web/src/features/auth/doorway/AuthDoorway.tsx`, `maintenance/MaintenancePage.*`, `pages/NotFoundPage.*` | SiteLogo instead of the generic placeholders |
| `apps/web/src/features/admin/nav/HorizontalNav.tsx`, `installer/InstallerWizard.tsx` | the Xentium mark |
| `apps/web/src/features/admin/pages/styleTokens.ts`, `StyleEditorPage.{tsx,scss}` | Logo icon group (border, shadow) on the board and as a section, with a live sample |
| `packages/contracts/src/appearance.ts` | `--logo-icon-from` / `--logo-icon-to` (brand gradient) and `--logo-icon-border` / `--logo-icon-shadow` (transparent) defaults |
| `docs/style-system.md` | the logo icon section |
| `apps/web/src/features/admin/pages/StyleEditorPage.{tsx,scss}` (Branding) | redesigned: `BrandingPreview` (masthead in the band colours, browser tab, home screen; staged logo colours), `BrandAsset` rows (default vs upload, Upload/Replace/Remove, drop), jump to the Logo icon section (`jumpTo` switches the Studio mode), Icons card; old `BrandingSlot` + `.se-drop` removed |
| `apps/web/public/locales/*/acp.json` | `styleEditor.secLogo*`, `rowLogoBorder`, `rowLogoShadow` |

## Error Reference redesign

| File | Purpose |
|---|---|
| `apps/api/src/modules/admin/errorLog.service.ts` | `codeOccurrences()` (one code, last 1/7 days, member or everyone, counts for both), `recentCodes()`, `findMember()`, `userId` group filter |
| `apps/api/src/modules/admin/errorLog.controller.ts`, `admin.routes.ts` | `GET /admin/error-log/lookup`, `GET /admin/error-log/recent-codes`, `?user=` on the grouped list |
| `apps/api/src/modules/admin/errorLog.test.ts` | lookup counts and scopes, range, unknown member, member filter, recent codes |
| `apps/web/src/features/admin/pages/ErrorReferencePage.{tsx,scss}` | rewritten: code + member lookup, suggestions, recently logged, unknown code with nearest codes, documentation with ACP page buttons, occurrences with context |
| `apps/web/src/features/admin/pages/ErrorLogPage.tsx`, `errorLog/ErrorLog.scss` | reads `?q=`, `?user=`, `?status=`; removable member chip |
| `apps/web/public/locales/*/acp.json` | new `errorRef.*` strings; the catalogue-browser strings removed; `errorLog.clearMember` |

## Sign in and registration redesign

| File | Purpose |
|---|---|
| `apps/web/src/features/auth/doorway/SignInForm.tsx` | new: every way in + the PIN step, ONE implementation for the page and the dropdown |
| `apps/web/src/features/auth/doorway/SignInMenu.tsx` | new: the masthead's Sign in dropdown, portalled to body and placed by the button |
| `apps/web/src/features/auth/doorway/SignInMenu.test.tsx` | new: opens, wrong password marks fields, signs in without leaving the page, Escape closes |
| `apps/web/src/features/auth/doorway/SignInPanel.tsx` | /login on top of SignInForm; `?mode=link` opens the sign-in-link request |
| `apps/web/src/features/auth/doorway/AuthDoorway.tsx` | brand-band shell: masthead background + logo, corner link, stats strip, centred card, footer |
| `apps/web/src/features/auth/doorway/{RegisterPanel,RecoveryPanels,pieces}.tsx` | corner per state; icon-only providers, short passkey label, invalid password field |
| `apps/web/src/features/auth/doorway/Doorway.scss` | band, strip, card, footer, dropdown styles |
| `apps/web/src/layouts/PubNav.tsx` | guest Sign in is the dropdown |
| `apps/web/src/hooks/useBranding.ts` | new: the branding query, shared by the header and the doorway |
| `apps/web/src/layout/blocks/sectionBackground.ts` | new: background helpers moved out of coreBlocks (re-exported there) so the doorway avoids an import cycle |
| `apps/web/public/locales/*/auth.json` | `door.corner.*`, `door.menu.*`, `door.passkey.short`, `door.forgotShort` |

## Activity Log redesign

| File | Purpose |
|---|---|
| `apps/api/src/modules/activity/activity.service.ts` | filters (q, user, ip, since, methods, result), tab `counts` across categories, `actors` (avatar + top group), `targets` (user and group ids in paths named), `facets()` |
| `apps/api/src/modules/activity/activity.routes.ts` | list query schema, `GET /admin/activity/facets` |
| `apps/api/src/shared/middleware/acpActivityLogger.ts` | keeps a failed action's `{code, message}` in `meta.error` |
| `apps/api/src/modules/activity/activity.test.ts` | new: counts across tabs, every filter, named targets, captured error |
| `apps/web/src/features/admin/pages/ActivityLogPage.{tsx,scss}` | rewritten: tabs with counts, search + filter menus, day groups, actor runs, folded page views, method badges, result pills, error notes, phone layout |
| `apps/web/src/features/admin/pages/activityHumanize.ts` | route → sentence table, `VERB_KEYS`, `browserOf()` |
| `apps/web/src/features/admin/pages/activityHumanize.test.ts` | new: sentences, targets, fallback, browser parsing, every verb in every locale |
| `apps/web/public/locales/*/acp.json` | `activity.*` UI strings and `activity.verb.*` |

## Create user from the ACP

| File | Purpose |
|---|---|
| `apps/api/src/modules/admin/admin.service.ts` | `createUser()`: uniqueness checks (XEC-AUTH-2001/2002), picked or default group, argon2 hash, verified flag, one transaction |
| `apps/api/src/modules/admin/admin.controller.ts`, `admin.routes.ts` | `POST /api/admin/users` (admin.access), Zod body matching registration's rules, 201 |
| `apps/api/src/modules/admin/adminUsers.test.ts` | create: active + verified + group + real hash, unverified, taken email/username, unknown group |
| `apps/web/src/features/admin/pages/users/CreateUserDialog.tsx` | new: the dialog (live validation, show/generate password, group select, verified toggle) |
| `apps/web/src/features/admin/pages/UserListPage.tsx` | Create user button in the header, opens the member after creating |
| `apps/web/src/features/admin/pages/users/Users.scss` | dialog + button styles |
| `apps/web/public/locales/*/acp.json` | `users.create.*` in all five languages |

## Visitor colourways in the footer theme chooser

A theme that ships more than one colourway now offers them to readers. The chooser lists
them as chips under the theme; the pick is a cookie (`xt_cw`), validated server-side
against the worn theme's manifest and laid over its global tokens.

| File | Purpose |
|---|---|
| `apps/api/src/modules/appearance/appearance.service.ts` | `getColourways(key)`, `parseColourwayId()`; `getCssFor` / `getLiveCss` / `getThemeCss` take a colourway; memo keyed per colourway, `bustThemeCss` clears all of a theme's entries |
| `apps/api/src/modules/appearance/appearance.routes.ts` | `/css?colourway=`; the live sheet keeps its version stamp with one |
| `apps/api/src/app/serveWeb.ts` | the index.html inliner reads the `xt_cw` cookie |
| `apps/api/src/modules/themes/theme.service.ts` | `/themes/choices` carries each theme's colourways (swatch only) and the one it wears |
| `apps/web/src/lib/viewerTheme.ts` | colourway cookie helpers, `viewerStyleParam()`; a theme switch clears the colourway |
| `apps/web/src/lib/liveStyle.ts` | stylesheet fetches carry the colourway |
| `apps/web/src/layout/blocks/ThemeChooserBlock.{tsx,scss}` | colourway chips; in place on the worn theme, reload when switching theme |
| `apps/api/src/modules/appearance/colourway.test.ts` | new: merge, unknown id, per-colourway memo, id parsing |
| `apps/api/src/app/serveWeb.test.ts`, `cssFreshness.test.ts` | cookie pass-through; mock gains `parseColourwayId` |
| `docs/theme-packages.md` | colourways for visitors |

## Moderation tool split out of the notification bell

The ModCanvas shield was drawn inside the `notifications` block, so the editor and the
header's action pill treated shield + bell as one item. It is now its own core block,
`modTool`; a one-time carry-over gives every existing header one just before its bell.

| File | Purpose |
|---|---|
| `packages/contracts/src/layout.ts` | `modTool` block schema; the default header places `h-mod` before `h-notif` |
| `apps/web/src/layouts/PubNav.tsx` | `NavModTool`; `NavNotifications` draws the shield only with `withModTool` |
| `apps/web/src/layout/blocks/chromeBlocks.tsx` | `modTool` block; the bell keeps the shield for a document that places no `modTool`; navbar carry + account types |
| `apps/web/src/layout/blockIcons.ts`, `blockArt.tsx`, `public/locales/*/acp.json` | editor icon, art and description (5 locales) |
| `apps/api/src/modules/layouts/composedChromeMigration.ts` | `splitModTool()` in `composeHeader` (rows + installed theme packages + theme imports); flag → `.v3` |
| `apps/web/src/layout/modToolBlock.test.tsx` (new), `sectionBackground.test.tsx`, `composedChromeMigration.test.ts` | split, fallback, migration placement/ids/idempotence/package import |

## Edge art: more core shapes, and a plugin extension point

Core gains curve, zigzag and scallops, plus optional `count`, `opacity` and `mobileHeight`
(all optional with no default, so stored edges parse unchanged). Everything else an edge
can do beyond that now comes from plugins through a registry: plugin shapes are named
`<namespace>.<name>`, plugin settings live under `ext.<namespace>` (opaque to core, size
capped), and an edge whose shape is not registered draws its `fallback` core shape or
nothing, and is kept.

| File | Purpose |
|---|---|
| `packages/contracts/src/layout.ts` | `CORE_EDGE_SHAPES` (incl. `blank`: no outline, plugin art only), `PLUGIN_EDGE_SHAPE`, `edgeExtSchema` (4 KB cap), `fallback`, optional `count`/`opacity`/`mobileHeight` |
| `apps/web/src/layout/edgeRegistry.ts` (new) | `registerEdgeShape` (throws on bad/taken ids), `registerEdgeExtension` (`render`, `InspectorTop`, `Inspector`), `deregisterEdgeFor` |
| `apps/web/src/layout/edgeArt.tsx` | core shapes registered through the registry; `resolveEdgeShape` (fallback); `edgePath`/`edgeMask` with `count`/`phase`/`period`; exported `edgePlacement`, `edgeStyle`, `edgeFill`, `edgePaint`, `edgeClassName`, `unitRand`; extensions asked first (handed `now`: the visitor's clock or the previewed date and hour), core draws otherwise |
| `apps/web/src/layout/edgeArt.scss` | box, fill, phone height; `.xt-edge-layer` hidden in forced colours |
| `apps/web/src/layout/blocks/{chromeBlocks,coreBlocks}.scss` | host rules exempt `.xt-edge-layer` as well as `.xt-edge` |
| `apps/web/src/plugins/host-globals.ts` | `webEdgeRegistry`, `webEdgeArt` |
| `apps/web/src/features/admin/pages/BlockEdgeArt.{tsx,scss}` | shapes from the registry, extension sections (also on a side with no edge), fallback picker, "plugin is off" notice; "None" keeps an edge that still carries plugin art as `blank`, with a remove button; generic chip/wrap classes for extension sections |
| `apps/web/src/features/admin/pages/LayoutEditorPage.{tsx,scss}` | "Viewing on" follows the season start instead of keeping a stale date; "Viewing at" hour picker when an extension's `usesTime` says an edge follows the clock |
| `apps/web/src/layout/previewBridge.ts` | `previewHour` message → `setPreviewHour` |
| `apps/web/public/locales/*/acp.json` | shape names, fallback + missing-plugin strings (5 locales) |
| `apps/web/src/layout/composedHeader.test.tsx` | core shapes, legacy parse, phone vars, plugin shape registration, fallback, `ext` bounds, extension render, repeat `period` |
| `docs/plugin-edge-art.md` (new), `docs/plugin-blocks.md` | the extension contract; link from the blocks guide |

## ACP save bar (replaces autosave)

| File | Purpose |
|---|---|
| `apps/web/src/hooks/useDraft.ts` (new) | draft store + `useDraft`, `saveAll`/`discardAll`, `DraftFailure`, epoch remount, settle for fire-and-forget saves, autosave fallback without a bar |
| `apps/web/src/hooks/autosaveCompare.ts` (new) | `stableStringify` / `sameValue`, shared |
| `apps/web/src/hooks/useAutosave.ts` | `useAutosave` → `useDraft`; old behaviour kept as `useDebouncedSave` |
| `apps/web/src/features/admin/AcpSaveBar.{tsx,scss}` (new) | the floating bar: review list, per-change revert, guard (`useBlocker` + beforeunload), ⌘S, shake, states; follows the content column |
| `apps/web/src/features/admin/AcpLayout.tsx` | mounts the bar; keys the page on the draft epoch |
| `apps/web/src/components/SaveChip.tsx`, `pages/acpSystem.scss` | status chip from the store (clean/dirty/saving/error); `autosave` prop for draft-and-publish pages; row markers, secnav dots, field errors |
| `pages/SettingsPage.tsx` | per-key describe/revert, saves per key so failures name the setting, jumps to it |
| `pages/{ModSettings,Composer,SignInProvidersPanel,Email,ModTemplates,Progression}Page*`, `groups/GroupDetailPage.tsx` | drafts with `mutateAsync` + `onDiscard`; validation fails the save; email/mod templates keep all edits in one map draft; progression toggles become a draft |
| `pages/{LayoutEditor,StyleEditor,SiteFramePopover,LegalDocuments}Page*` | stay on `useDebouncedSave` (own Publish) |
| `apps/web/src/plugins/host-globals.ts` | `webUseDraft` |
| `apps/web/public/locales/*/acp.json` | `savebar.*`, new settings subtitle (5 locales) |
| `apps/web/src/hooks/useDraft.test.tsx` (new) | dirty count, save, failure + field, settle, discard/remount, no-bar autosave |
| `docs/plugin-acp-autosave.md`, `README.md`, `CLAUDE.md` | the save bar for plugin authors |

## Themes page redesign

| File | Purpose |
|---|---|
| `apps/api/src/modules/themes/theme.service.ts` | `summarize(key)` (palette from tokens with `var()` resolved, colourways + worn, last edited), `labelOf`, `applyColourway`, `wearColourway`; `activateTheme(id, user, colourway?)`; undo restores colours; rollback state says whether it undoes an update |
| `apps/api/src/modules/themes/theme.routes.ts` | `GET /overview`, `POST /colourway`, activate takes `{ colourway? }` |
| `apps/api/src/modules/appearance/appearance.service.ts` | `patchLiveScope` (live + draft in one step, returns the before), `restoreTokens`; `ThemeRollback.tokens` |
| `apps/api/src/modules/themes/theme.service.test.ts` | colourway patch vs shipped, unknown colourway, undo restores colours; mocks for the new lookups |
| `apps/web/src/features/admin/pages/ThemesPage.{tsx,scss}` | rewritten: live hero with mock, facts, variant preview/apply, undo; library cards with mocks, variant dots, inline remove confirm; install in the header |
| `apps/web/src/features/admin/pages/MarketplacePage.tsx` | `?kind=theme` opens on themes |
| `apps/web/public/locales/*/acp.json` | new `themes.*` strings (5 locales) |
