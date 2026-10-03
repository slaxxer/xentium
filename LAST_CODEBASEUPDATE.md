# Last codebase update

ModCanvas × plugins (plugin report targets and queues):

- Plugin report targets: `plugin-sdk` `ReportTargetInfo`/`ReportTargetHandler` + optional
  `ctx.registerReportTarget`; `core/report-target-registry/` (new); plugin-context + engine deregister;
  `reportTarget.ts` resolves `plugin-content` through it (site-relative hrefs only) + `canRemoveTarget`;
  `modCanvas.service.ts` inspector returns `canRemove`, Remove calls the plugin's `remove` and logs
  `plugin_content.deleted`. Test `pluginReportTarget.test.ts`.
- Plugin queues: `slotRegistry.registerModQueue` (items + actions); `modcp/QueuePill.tsx` (new, reason field
  in the confirm dialog); `ModShield` lists queue items as rows (counted in the dot); `ModCanvas` runs queue
  sessions; links with a query (`?page=`) navigate correctly; `typeLabel` reads a plugin's kind ("post").
- `docs/plugin-registries.md`: both hooks documented. ACP mod-log label `plugin_content_deleted` (5 locales).

ModCanvas v1.0.0 (nodevo-redesign/Modcanvas v1.0.0 Redesign — 2a shield, 1a report pill, 2b case pill):

- RETIRED the draggable floating button + slide-over console (deleted `ReportsInspector.tsx`, `UsersSection.tsx`,
  `CasesSection.tsx`, `UserSearch.tsx`; `ModCanvas.scss` rewritten). Users / audit log / case list live in the ACP.
- `features/modcp/ModShield.tsx` (new): navbar shield beside the bell (in `NavNotifications`, PubNav) with a red
  dot and a dropdown of reports + security cases, oldest first; plugin sections (plugin queues) are a group
  that opens in a dialog; footer link to ACP moderation (admins).
- `ReportPill.tsx` / `CasePill.tsx` (new): bottom-centred action pills — report: Warn/Ban/Remove/Dismiss, premade
  text menu (opens upward, previews, suggested, 1–9 keys, ban durations), Send, n/total, next, close; case: linked
  account chips (switch profile), signals menu, Allow, Ban all.
- `ModCanvas.tsx` rewritten: the session root (navigates to each item's page, marks the reported item via
  `data-mod-target="<type>:<id>"` → `data-mc-reported`, hosts pills + plugin dialog, `?modcanvas=` + Shift+M open
  the shield). `modSession.ts` (store) + `modData.ts` (queries, case/report labels) new.
- `ModShield.tsx`: plugin section counts also refresh when the menu opens and when a plugin's dialog closes.
- `data-mod-target` added to the article body, article comments (ArticleReaderPage), profile wall comments
  (ProfilePage) and the profile identity block (profileBlocks).
- `plugins/slotRegistry.ts`: section/user-panel slot docs (user panels are no longer rendered).
  `docs/security-detection.md`, `docs/API.md` wording.

Legal documents replace custom pages:

- `prisma/schema.prisma` + migration `20261002120000_legal_documents`: new `xcf_legal_documents` (fixed keys,
  `draft_body` / `body` / `published_at`). Pages assigned to the terms/privacy/imprint slots are carried over; then
  `xcf_pages`, `xcf_nav_items.page_id`, `page.detail` layout rows, the slot settings and `page.*` permissions go.
- `packages/contracts/src/legal.ts` (new, replaces `pages.ts`): `LEGAL_DOCUMENTS`, `legalPath`, response types.
  `permissions.ts`: `LEGAL_MANAGE` replaces `PAGE_MANAGE`/`PAGE_PUBLISH`. `xec.ts`: `XEC-LEGAL-3501/3502`.
  `layout.ts`: `page.detail` template, its blocks and default removed; `VARIANT_TEMPLATES` is now empty.
  `siteFrame.ts`: `page.detail` override dropped, and `parseSiteFrame` strips retired override keys (one stale
  key used to reset the whole frame) + test.
- `apps/api/src/modules/legal/` (new, + `legal.service.test.ts`): public `/api/legal`, ACP `/api/admin/legal`
  (draft, publish, unpublish, discard). `modules/pages/` deleted. `purgeOrphanedUploads.ts` scans legal bodies
  instead of pages (carried-over images under `pages/` keep working).
- `apps/web/src/features/admin/pages/LegalDocumentsPage.tsx` + `.scss` (new): ACP → Content → Legal, editing in the
  Composer (JSON mode, mentions off, Image node so carried-over images survive). `components/composer/Composer.tsx`:
  the Ctrl+Enter hint shows only when the surface has an `onSubmit`.
  `features/legal/LegalPage.tsx` + `.scss` (new): `/legal/:key`. `lib/legalApi.ts` (new): client + `useLegalLinks`.
- `layouts/SiteFooter.tsx` + `.scss`: legal links first in the footer bar; copyright always centred.
- `layout/blocks/ThemeChooserBlock.tsx` + `.scss`: the footer theme picker drops its Active/Site badges (the tick says it) and the "your choice, on this device" note.
- `features/account/AccountPage.scss`: the account header's bottom margin used the non-existent `--sp-7` (= no gap); now `--sp-5`, spacing both the title text and the "View my profile" button.
- `features/account/tabs/PreferencesTab.tsx`: theme cards keep "Active", drop the "Site" badge and the "your choice, on this device" note (`themeChooser.siteBadge` + `.note` removed from locales, unused `.acct-group__note` style removed).
- `features/account/tabs/SecurityTab.tsx`: the change-username card drops the "current username" line and the
  username history. `GET /api/account/username-history` removed (service, controller, route, docs) with its strings.
- `layout/blocks/profileBlocks.tsx` + `features/profiles/ProfilePage.scss`: previous usernames (still gated by the ACP
  setting + day window) are a chevron beside the profile name opening a dropdown of the last 3 names, no @ or date (`FormerUsernames`, closes on
  outside click / Escape) instead of a "Previously known as" line. Profile avatars get an opaque base under the
  gradient (`--c-accent-soft` is translucent, so the cover showed through).
- Profile age / birthday: `apps/api/src/modules/users/profileDob.ts` (new, + test) resolves it from the member's
  Privacy choice and the field's visibility (members-only now hidden from guests — it leaked before; a future or
  absurd date shows nothing) and sends `dob` = `{kind:"age",age}` | `{kind:"birthday",month,day}` (`dobLabel` kept).
  `profileBlocks.tsx`: meta line reads "Member since …, 20 years old" (new `profileIdentity.showAge` prop, default on);
  the Information tab formats the same value in the reader's language. `profiles.json` (5 locales): `yearsOld`,
  `birthdayOn`. Tests in `profileRedesign.test.tsx`.
- Username colour + glow everywhere: names drawn by hand now go through `<Username>` — home (me card, feed
  authors, suggested people), guest landing + `guestBlocks`, search authors, composer "writing as", account
  preview, navbar name chip, ACP user list / user detail / group members. `lib/groupBadge.ts`: `primaryBadgeColor`.
  `shared/utils/userRef.ts`: `withAuthorBadgeColors` (+ test) gives plugin feed/hot/search authors their colour
  (home + search services); `plugin-sdk` types note the optional `badgeColor`. `GroupDetailPage`: saving a badge
  invalidates `legend-groups` so a changed glow shows without a reload.
- Rank images: `prisma` + migration `20261002200000_group_rank_image` (`xcf_groups.rank_image`); setting
  `groups.rank_display` = badge (default) | image. API: `POST/DELETE /api/admin/groups/:id/rank-image`
  (`RANK_IMAGE` limit, stored as `groups/rank-<id>.<ext>`, + `groupRankImage.test.ts`); `/api/members/groups`
  returns `rankImage` only in image mode; purge job counts rank images as references. Web: `lib/rankImage.ts`
  (store filled by BadgeShadowSync) + `components/RankBadge.tsx/.scss` (host global `webRankBadge`) wrapping
  the group pill on home (me card + feed), navbar dropdown, article author, search users, members, account
  preview. On the profile the images get their own row UNDER the name (`.profile-rankimgs`); the footer legend
  always shows group name + colour, now with the group's username glow, as plain text (no pill, no dot). `.profile-identity`
  gets top padding so the name's glow is not cut off by the cover band. ACP: rank image card on a group's Identity tab (its live preview shows the image UNDER the name, or the
  badge beside it, as the site would). The Group icon card is gone and `GroupGlyph` always draws the default
  glyph (custom icons no longer shown; the icon API/column are still there, unused), "Rank display" in Settings.
  Token `--rank-image-height` (28px) with a Style Editor row.
- `features/auth/doorway/RegisterPanel.tsx`: consent box for published terms and/or privacy policy.
- Removed: `PagesPage`, `PageEditorPage`, `PageReaderPage`, `pageDetailBlocks`, `pagesApi`; the layout editor's
  per-page picker (`LayoutEditorPage.tsx`) and `page.detail` from `SiteFramePopover`, block icons/art and tests.
- Locales (all five): `legal` blocks in common + acp, `door.reg.agree*` in auth, `nav.legal`, error codes;
  `pages` and the variant-picker strings removed. `docs/API.md`, `docs/theme-packages.md` updated.

ACP dashboard redesign (nodevo-redesign/ACP Dashboard Index Redesign):

- `apps/api/src/modules/admin/dashboard.service.ts` + `.controller.ts` (new, + `dashboard.test.ts`):
  `GET /admin/dashboard/overview?range=7|30|90`: four metrics with previous period (active = distinct
  members who signed in or opened a page), newest members, attention items, setup steps + milestones
  (a site under 30 days old with steps left), top articles, platform summary.
- `modules/admin/marketplace.service.ts`: `getDashboardSignals()` (reconciled plugin updates, pending core,
  licence attention), reusing the badge's rules.
- `apps/web/src/features/admin/pages/DashboardPage.tsx` rebuilt + `dashboard/` (new): `dashboardModel.ts`,
  `PulseChart.tsx`, `DashboardCards.tsx`, `Dashboard.scss`. Removed `DashboardPage.scss` and `components/DashCharts.tsx`.
- `apps/web/src/features/modcp/ModCanvas.tsx`: `?modcanvas=<section>` opens the panel there.
- `apps/web/public/locales/*/acp.json`: the `dashboard` block rewritten in all five languages.

Error log redesign (nodevo-redesign/Error protocol page redesign):

- `prisma/schema.prisma` + migration `20260930120000_error_log_groups`: `method`, `url`, `group_key` on
  `xcf_error_log` (+ indexes); new `xcf_error_log_groups` holding only a group's resolve mark.
- `apps/api/src/shared/errors/errorGroupKey.ts` (new): code + normalized message → group key.
- `packages/errors/src/errorMiddleware.ts`: entries carry `method`/`url`; uses `originalUrl`.
  `apps/api/src/shared/errors/errorMiddleware.ts` + `jobs/jobFailure.ts` store them and the key (jobs as `JOB`).
- `apps/api/src/modules/admin/errorLog.service.ts` + `.controller.ts` (new, + `errorLog.test.ts`): groups, stats,
  occurrences, resolve/reopen, delete group/entry; rows without a key are filled in on read.
  Routes in `admin.routes.ts`; clearing and log retention prune orphaned resolve marks.
- `apps/web/src/features/admin/pages/ErrorLogPage.tsx` rebuilt + `errorLog/` (new): `errorLogModel.ts`,
  `Overview.tsx`, `GroupTable.tsx`, `ErrorDrawer.tsx`, `ErrorLog.scss`.
- `apps/web/public/locales/*/acp.json`: the `errorLog` block rewritten in all five languages.

ACP Permissions redesign (nodevo-redesign/Group preferences redesign):

- `packages/contracts/src/permissions.ts` (+ `permissions.test.ts`): `PERMISSION_IMPLIES`, `expandImplied`,
  `impliersOf`. Four core implications (`*.any` → `*.own`, `revisions.restore` → `revisions.view`), one level deep.
- `apps/api/src/shared/middleware/requirePermission.ts`: the effective set (and its Redis cache) is expanded
  through the implications, so every guard sees them.
- `apps/api/src/modules/permissions/permissions.service.ts`: `userHasPermission` also accepts a key that implies
  the one asked for. `modules/articles/article.controller.ts`: `viewerPerms` expanded the same way.
- `apps/api/src/modules/permissions/impliedPermissions.test.ts` (new): both check paths honour an implication.
- `apps/web/src/features/admin/pages/PermissionsPage.tsx`: rebuilt. Draft kept as per-group EDITS over the server
  state (never a copy), saved as `PATCH /admin/groups/:id/permissions {grant, revoke}` per dirty group; sensitive
  grant confirm; Ctrl+S, `/`; beforeunload + router blocker; view and group in the URL.
- `apps/web/src/features/admin/pages/permissions/` (new): `permissionsModel.ts` (+ test), `SplitView.tsx`,
  `MatrixView.tsx`, `Permissions.scss`.
- `apps/web/src/features/admin/pages/groups/`: `GroupGlyph` gains `sm`, `PowerMeter` gains `compact`;
  `PermissionsTab.tsx` shows implied keys as held and locked.
- `apps/web/src/lib/permissions.ts`: labels + areas for every core key; Moderation and System in the area order.
- `apps/web/public/locales/*/acp.json`: the `permissions` block rewritten in all five languages.
- `CHANGELOG.md`: this push.

Site frame / centred layouts (nodevo-redesign/Xentium centered theme layout, parts 1–2):

- `packages/contracts/src/siteFrame.ts` (new, + test): `siteFrameSchema` (mode full|boxed|flush|framed|floating|overlap,
  box width/radius/shadow/overlap, body background colour|gradient|image, sticky navbar, phone edge|keep, per-page
  overrides for the six core page templates), `frameModeFor`, `frameBackgroundCss`, `SITE_FRAME_ROW_KEY`.
  `THEME_PATHS.frame` = `frame.json`.
- `apps/api/src/modules/layouts/layout.service.ts`: the frame is one row in `xcf_layouts` under `@site-frame`
  (draft/published/theme), so it rides draft-status, Publish, theme baseline and theme undo. `frame` on the
  published/draft/themed layout sets; `getFrameDraft`/`saveFrameDraft` (409 on a stale revision),
  `revertFrameToTheme`, `saveThemeFrame`, `isFrameCustomised`, `applyThemeFrame`. The concurrency write is now
  `writeDraftRow`, shared with `saveDraft`. Routes `GET|PUT /admin/layouts/frame`, `POST /frame/revert-theme`
  (+ `siteFrame.test.ts`).
- `apps/api/src/modules/themes/theme.service.ts`: `frame.json` exported (body image packed as an asset), validated
  and imported; applying a theme records the baseline and replaces an untouched frame, keeps a customised one; a
  theme without a frame means full width. Tests in `theme.service.test.ts`.
- `apps/web/src/layout/siteFrame.ts` (new, + test): page-template store (registered by `LayoutRenderer`), live
  preview frame (bridge message `frame`), `presentFrame`. `layouts/AppLayout.tsx` gains the unconditional
  `.app-frame` / `__body` / `__box` / `__foot` wrappers; `AppLayout.scss` holds the six modes and phone rules
  (all wrappers `display: contents` at full width; footer dissolve rule moved to `.app-frame__foot`).
- `apps/web/src/features/admin/pages/SiteFramePopover.tsx` + `.scss` (new): the Layout Editor's "Site layout"
  popover, autosaved, pushed live to the preview; wired into `LayoutEditorPage.tsx` beside Publish.
- `apps/web/public/locales/*/acp.json`: `layoutEditor.frame` in all five languages.

Edge art + composed header (same handoff, parts 3–4):

- `packages/contracts/src/layout.ts`: node-level `BlockNode.edges` (`edgeArtSchema`: slant|wave|peaks|drips|image,
  out|in, 1–2 colours, image + repeat|stretch, height 8–120, mirror, yearly `season`), `inSeason`; edge images are
  collected/rewritten as theme assets. `header` is a container (`CORE_CONTAINER_TYPES`) with `showMasthead`,
  `logoAlign`, `showTagline`; the default header holds a `logo` child. `navbar` gains `sticky`, `height`, `tone`;
  `branding` gains `linksAlign`, `textAlign`, `order`. Tests in `edgeArt.test.ts`.
- `packages/contracts/src/siteFrame.ts`: `stickyNav` removed — stickiness is the navbar block's.
- `apps/web/src/layout/edgeArt.tsx` + `.scss` (new): shape paths, masked layer portalled into the block's own
  element, season preview store. `LayoutRenderer.tsx` mounts it (callback ref in state: a ref object is still null
  in a child's first layout effect).
- `apps/web/src/layout/blocks/chromeBlocks.tsx` + `.scss`: composed header (brand column + action group, tagline,
  centred logo, hidden masthead); navbar tone/height/static and the masthead-hidden fallback (logo + account
  actions). `layouts/SiteFooter.tsx` + `.scss`: branding alignment/order; fixed "© {year} Powered by Xentium
  Community" line (`footer.poweredBy`). `site.service.ts`: `siteTagline` in the public config.
- Editor: `BlockEdgeArt.tsx` + `.scss` (inspector section on every block), `ChromePlacement.tsx` (search /
  account menu between masthead and navbar, via `placeBetween` in `blockTree.ts`), tree marker in
  `LayoutTree.tsx`, "Viewing on: Today / In season" canvas switch (bridge message `season`).
- Tests: `layout/composedHeader.test.tsx`, theme edge-image round trip in `theme.service.test.ts`.

Per-theme appearance (every installed theme and Core edited on its own):

- `prisma/schema.prisma` + migration `20261001120000_per_theme_appearance`: `theme_key` on `xcf_layouts` (in the
  unique index) and on `xcf_style_history`.
- `apps/api/src/modules/themes/themeKey.ts` (new): theme keys (`''` = Core, `_core` in a query), `themed()` setting
  keys, `activeThemeKey`, `resolveEditingKey` / `resolveViewingKey`, `themeBaseline` (a theme's package from its
  library row). `perThemeMigration.ts` (new, + test): boot carry-over of the single layer onto the active theme,
  backfilling a pre-library theme's row; wired in `boot.ts`.
- `appearance.service.ts`: storage half rewritten per theme — tokens (live/draft), custom CSS, fonts (new
  `GET|PUT /appearance/font`), history, reset, publish; the theme layer is read from the package; CSS memo per
  theme. Routes take `?theme=`; the scheduled publish job publishes every theme's draft.
- `layout.service.ts` rewritten per theme: resolution own row → shipped → code default; per-theme published cache;
  `releaseUntouched` for updates; `snapshotTheme` / `restoreTheme` / `forgetTheme`. Controller takes `?theme=`.
- `theme.service.ts` / `theme.routes.ts`: install never copies; switching = `setActive`; `POST /core/activate`;
  undo switches back (an update's undo restores payload + rows); uninstalling the live theme falls back to Core;
  export takes `?theme=`; `backfillLibrary` removed (now in the migration).
- Web: `lib/editingTheme.ts` (new), `ThemeScopePicker` (new) in both editors; Style Editor and Layout Editor keyed
  by theme with every call/query carrying it; previews carry `__theme=` (`useLayout`, `liveStyle`,
  `ThemePreview`); `BlockStyle`, `SiteFramePopover`, `StyleHistoryList` follow; Themes page gains a Core card,
  per-theme Layouts/Colours links, confirmed removal. Strings in five languages.
- Tests: `themeCssLayer.test.ts` and `variantScopes.test.ts` rewritten per theme; layout and theme tests updated.

Docs for per-theme appearance:

- `docs/style-system.md`: rewritten from "Layers" on — every theme keeps its own work, theme keys, the package as
  the layer underneath, per-theme draft/publish and storage, the upgrade carry-over, switching / updating / undo /
  removing, readers wearing a theme as edited, new rules of thumb.
- `docs/theme-packages.md`: `frame.json` in the file list; Importing and "Updating a theme without losing your
  work" rewritten for the per-theme model.
- `apps/docs/scripts/sync-docs.mjs`: links whose text contains a code span are rewritten too (they were left as
  raw `.md` hrefs and 404'd on the docs site).
- `apps/web/public/locales/*/acp.json`: the Layout Editor's Reset dialog says the page goes back to what the theme
  ships.

1:1 pass against the centred-theme handoff (header, navbar, footer, edge art) + bugs:

- Contracts: header defaults 200px, tagline on, mock gradient (#14162a→#5865f2, 150°); `backgroundMode` (image | gradient)
  and `showButtons` on `header`; `linksAlign` / `textAlign` / `order` on `footer`; new `footerLinks` and `footerText`
  blocks (`branding` retired: still renders, no longer offered). Default header = masthead with logo + bell,
  messages, admin, account, search; navbar = links. Default footer ends with footerLinks + footerText.
- `composedChromeMigration.ts` (new, + test, boot): stored headers become containers with the action group moved in;
  `branding` splits into links + text; untouched old defaults map onto the new defaults exactly; installed themes'
  packages are composed too, and `importTheme` composes old packages on the way in (`composeDocuments`).
- Web: masthead shade, white logo/tagline, the dark action pill (hairlines, username, guest Log in as plain items,
  search collapsing to an icon); Buttons off / masthead hidden carry the buttons into the navbar.
  `ChromeSettings.tsx` (+ scss): the Header / Navbar / Footer settings panels from the mock (replaces
  `ChromePlacement`). Inspector order is Settings, Who sees it, Style, Edge art. `BlockBackground` gains
  `only` / `bare`. Edge art: date-based "Viewing on: Today / <season start>" (bridge `previewDate`), mock labels,
  footnote. `blockRegistry` `retired` flag.
- Bug: a draft equal to the default it falls back to read as "pending publish" forever (jsonb key order vs source
  order). `layout.service` compares content order-independently (+ `layoutPending.test.ts`).

ACP nav: the Style Editor and Layout Editor are reached only through Themes:

- `features/admin/useAcpNav.ts`: their nav entries removed; a nav child's `within` lists pages reached through it
  (Themes stays highlighted in the editors, the breadcrumb reads Appearance › Themes › <editor>);
  `childMatches()` used by `HorizontalNav`, `AcpPanel`, `isNavItemActive`. The command palette leaves them out.
  Routes unchanged. Test in `useAcpNav.test.ts`.
- README, `docs/theme-packages.md`, `docs/icon-kits.md`: paths now go through Themes.

Edge art only on surfaces:

- `layout/blockRegistry.ts`: `editorMeta.surface` + `hasSurface()`. Set on section, header, navbar, footer,
  guestSurface, guestHero, guestRail, profileCard, profileCover. The inspector offers edge art only there (or where
  a block already has some, so it can be removed); stored art still renders. Test in `composedHeader.test.tsx`.

Footer bar + read-only theme label:

- Contracts: `footerBar` (copyrightSide left|right, showUptime, showThemeChooser) replaces the `footerLinks` +
  `footerText` pair (both retired: render, not offered); the footer block loses linksAlign/textAlign/order. Default
  footer ends with `f-bar`.
- `SiteFooter.tsx` `FooterBar` + `.xt-footbar` styles; chromeBlocks registers it; the footer's custom settings
  panel is gone (generic settings + background).
- `composedChromeMigration.ts` v2 (flag `layout.composedChromeMigrated.v2`): branding and the links/text pair become
  one `footerBar`, the copyright on the side it was put; untouched defaults map onto `f-bar` exactly. Tests updated.
- `ThemeScopePicker`: a read-only "Editing <theme> · live/not live" label; the editors are opened from Themes.

### Core block catalogue completeness (2026-10-02)
- `apps/web/src/layout/blockIcons.ts`, `blockArt.tsx`: every core block now has its own icon and catalogue picture (footerBar/footerLinks/footerText, plus older profile/members/home/guest pieces that had been falling back to their category). Exported `ICON_TYPES` / `SHAPE_TYPES`.
- `apps/web/src/layout/coreCatalogue.test.ts` (new): fails if any key of `blockPropSchemas` lacks an icon or picture.

### Block inspector: two tabs, Theme style (2026-10-02, handoff section 5 "Editor behaviour")
- `packages/contracts/src/themeStyle.ts` (new, + test): colourway schema, corner presets (rounded/chamfered/sharp), glow presets, `wears`/`cornerModeOf`/`patchFor` (clears values the theme already ships). `theme.ts`: optional manifest `colourways` (max 8). `tokens.ts`: `--corner-cut(-sm)`, `--clip-card`, `--clip-sm`, `--glow-accent`.
- `apps/web/src/styles/_tokenDefaults.scss`, `tokens.scss` (variants carry `--surface-clip`), `buttons.scss` (clip + glow on primary), `layout/blocks/coreBlocks.scss` (section clip, off while it has edge art), and card rules in Home/GuestHome/Members/Profile/Search/Articles/rank stylesheets read `--clip-card`/`--clip-sm` (default `none`, so stock sites are unchanged).
- `features/admin/pages/LayoutEditorPage.tsx`: inspector tabs **Block** (about line, Settings, Who sees it + Edge art as folds, icon picker) and **Theme style** (`ThemeStyle.tsx`: colourway tiles, corners, glow, the block's style variant, token readout). The preview gets the theme's staged global tokens (`themeDraftCss`) on both tabs. `InspectorFold.tsx` (new). `BlockVisibility`/`BlockEdgeArt` take `bare`.
- `apps/api/src/modules/themes/theme.service.ts`: export carries an installed theme's colourways.
- Locales (5): inspector tabs, Theme style strings, Style Editor labels for the new tokens, descriptions for the 53 core blocks that had none. `layout/coreCatalogue.test.ts` now also requires a description.
- Docs: `docs/style-system.md` (Theme style), `docs/theme-packages.md` (Colourways).

### Theme Studio: Layout Editor + Style Editor merged (2026-10-02)
- `apps/web/src/features/admin/pages/ThemeStudioPage.tsx` + `.scss` (new): one page per theme at `/admin/theme-studio?theme=&mode=`, modes Layout · Colours & type · Branding · Custom CSS · History, one draft bar and ONE Publish (layouts + styles together). Editors stay mounted once opened, so switching modes keeps undo/selection. `studioLinks.ts` (modes + `studioHref`), `StudioRedirect` for the retired `/admin/layout-editor` and `/admin/style-editor` (keeps `?theme=`, maps `?tab=`).
- `LayoutEditorPage.tsx` / `StyleEditorPage.tsx`: `embedded` prop (no header, tabs or Publish of their own).
- `ThemesPage.tsx`: one "Open in Theme Studio" button per theme. `ThemeStyle.tsx` links into the Studio. `useAcpNav.ts` + test, `App.tsx` routes.
- API `modules/themes/themeStudio.ts` (new): `studioStatus` (pending layouts + style change count), `publishTheme` (layouts then styles); routes `GET /admin/themes/studio/status`, `POST /admin/themes/studio/publish`. `jobs/appearancePublish.ts` + `scheduledJobs.ts`: the scheduled job publishes both, relabelled "Publish theme changes". Tests: `themeStudio.test.ts`, `themeStudioPublish.test.ts`.
- Locales (5): `studio.*`, `nav.themeStudio`, `themes.openStudio` (dropped `themes.editLayouts`/`editColours`).
- Docs: style-system, theme-packages, plugin-blocks, icon-kits, API, README, CLAUDE.md renamed to Theme Studio; draft and publish section rewritten.

### Header dropdowns behind the page (2026-10-02)
- `apps/web/src/layout/blocks/chromeBlocks.scss`: `.xt-header` gets `z-index: 110` (above the sticky navbar's 100). The masthead's action pill has a backdrop blur, which makes it its own stacking context and trapped the account, notification and messages dropdowns under the navbar and content.
- `apps/web/src/features/admin/pages/ThemeStudioPage.tsx`: the "Editing · <theme>" label is gone from the Studio header (the admin opened that theme from the Themes page).

### Footer bar: links + theme picker, copyright under them (2026-10-02)
- `packages/contracts/src/layout.ts`: `footerBar` loses `copyrightSide` (one arrangement now). `apps/api/.../composedChromeMigration.ts` (+ test) no longer writes it.
- `apps/web/src/layouts/SiteFooter.tsx` + `.scss`: `FooterBar` = a top row (footer links left, theme picker right; dropped when there is neither) and the copyright line under a hairline. `useFooterNavLinks` / `FooterLinkList` shared with the legacy `FooterLinks`. `chromeBlocks.tsx` passes the two remaining props. `footerBand.test.tsx` updated.
- Locales: the whole `footer` block in `common.json` translated for de/es/fr/pt (it existed only in English), plus `footer.linksLabel`.
