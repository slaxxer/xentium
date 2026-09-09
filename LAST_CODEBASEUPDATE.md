# Last codebase update — 2026-09-09

Two pieces: the **Layout Editor rebuilt into three panes with a block catalogue**, and
**per-visitor themes** — a reader wearing an installed theme's colours *and* its
layouts, without changing anything for anyone else.

⚠ **The profile-page redesign built on 2026-09-06 is deliberately NOT in this push.**
Its scope is still being settled, so `profileCover` / `profileRank` / `profileLadder` /
`profileFollowers`, `profileAvatar.overlap`, the reshaped `DEFAULT_LAYOUTS.profile`, the
`GET /users/:id/progression` route and the `profiles.json` strings are all held back in
the working tree. Nothing here references them.

`pnpm backbone:check` green — typecheck 30/30, lint 0 errors, API **312** tests, web
**653**, build clean.

---

## The Layout Editor (`feat(layout)`)

| File | Purpose |
| --- | --- |
| `features/admin/pages/LayoutEditorPage.{tsx,scss}` | Three panes; Block Settings floats beside the selection |
| `features/admin/pages/LayoutTree.{tsx,test.tsx}` | The tree pane, split out of the page |
| `features/admin/pages/BlockCatalogue.{tsx,scss,test.tsx}` | Searchable, categorised block picker |
| `features/admin/pages/BlockBackground.{tsx,test.tsx}`, `BlockStyle.tsx` | Panels rehomed into the floating inspector |
| `features/admin/pages/layoutEditorStrings.test.ts` | Every block type has a label and a description |
| `components/SchemaFields.{tsx,scss}` | Field rendering for the new panel |
| `layout/blockArt.tsx`, `layout/blockIcons.ts` | Per-type illustration and glyph; category fallback |
| `layout/inspectorSide.{ts,test.ts}` | Which side the panel takes — a coverage threshold, not "any overlap" |
| `layout/blockRegistry.ts` | `editorMeta.icon`, so a plugin can name its own glyph |
| `layout/blockTree.{ts,test.ts}`, `layout/previewBridge.ts` | Tree ops + the hover/selected chips |
| `layout/blocks/coreBlocks.scss`, `blocks/chromeBlocks.scss` | Chip styling; the footer band |
| `layouts/AppLayout.scss`, `layouts/SiteFooter.scss` | ⚠ Scoped to `.app-layout`, not `.pub-head` — the footer's region is a direct child of the former |
| `locales/*/acp.json` | Catalogue strings + a sentence per block type |

## Per-visitor themes (`feat(themes)`)

| File | Purpose |
| --- | --- |
| `lib/viewerTheme.{ts,test.ts}` (web) | The cookie, and the `?theme=` qualifier every fetch carries |
| `modules/themes/themePublic.routes.ts` | `GET /api/themes/choices` — public, outside `/api/admin` |
| `modules/themes/theme.service.{ts,test.ts}` | `listThemesForVisitors`; reinstall busts the id's caches |
| `modules/appearance/appearance.{routes,service}.ts` | `?theme=` CSS; ⚠ no `X-Style-Version`, no revalidation |
| `modules/layouts/layout.{controller,service}.ts` + `viewerTheme.test.ts` | `?theme=` layouts; unknown id falls through to the site's |
| `app/app.ts` | Mounts the public router |
| `layout/blocks/ThemeChooserBlock.{tsx,scss}` | Icon + dialog in the brand row |
| `layout/blocks/chromeBlocks.tsx`, `layouts/SiteFooter.tsx` | `showThemeChooser` reaches `FooterBranding` |
| `layout/useLayout.ts` | ⚠ Theme in the QUERY KEY, or the layouts come from the previous theme's cache |
| `lib/liveStyle.ts` | ⚠ `refreshStyle` re-fetches the same half that was loaded |
| `contracts/src/layout.ts` | `branding.showThemeChooser` |
| `features/admin/pages/ThemeExportDialog.tsx` | The `description` textarea — the picker reads it |
| `locales/*/common.json` | `themeChooser.*` |
