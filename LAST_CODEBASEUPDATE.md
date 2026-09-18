# Last codebase update — 2026-09-19

Installing a theme is no longer switching to it, a switch now replaces the previous
theme's stylesheet, and the style system has a developer guide. Built alongside
**Redline**, the first first-party `.xttheme` (package v2, dark, `#e22b2b`) — the theme
itself is not in this repo: it is free and ships from the marketplace.

## xentium (this repo)

| File | Why |
|---|---|
| `modules/themes/theme.service.ts` | `importTheme` applies only an UPDATE to the worn theme (`manifest.id === getInstalledTheme().id`); anything else is saved to the library inactive. `saveInstalledTheme` gains `{ activate }`. `ImportReport` gains `activated` + `current`. `applyTheme` always writes the theme token layer and stylesheet (`{}` / `""` when the theme has none) — the fix for CSS outliving a switch. Stale "everything is STAGED" comment corrected. |
| `modules/themes/theme.service.test.ts` | `putOn()` helper = import + activate (what an import used to be) so the application tests keep testing application; the mock's `setInstalledTheme` now also sets what the site wears. New suites: "installing is not switching" (6) and the stylesheet/tokens clear-on-switch test. |
| `modules/admin/marketplace.service.ts` | The marketplace theme install forwards `activated` + `current`. |
| `web/features/admin/hooks/themeSwitchPrompt.tsx` + `.scss` | **New.** `offerThemeSwitch` — the one "switch or keep" dialog, reading the library row for the screenshot and declared look; `outcomeFromStream` for the streamed installs. |
| `web/features/admin/pages/ThemesPage.tsx` | Upload asks; the report says "added to your library" when nothing was applied; invalidates the library too. |
| `web/features/admin/pages/MarketplacePage.tsx`, `components/OwnedLicenses.tsx` | Ask after a theme install, inside the mutation so invalidation sees a switch. |
| `web/features/admin/hooks/themeInstallResult.ts` | "installed" vs "now the active theme". |
| `web/public/locales/{en,de,es,fr,pt}/acp.json` | 10 new `themes.*` strings + `marketplace.themeInstalled`. |
| `docs/style-system.md` | **New** developer guide to the whole style system. |
| `docs/theme-packages.md` | Points at the guide; import semantics corrected (install ≠ switch, switch is live, one-level undo, switch replaces the layer). |

## xentium-marketplace

| File | Why |
|---|---|
| `catalog/themePreview.ts` | Reads `tokens.json` in either package shape (v1 keeps its light half, as the CMS does) through the CMS's `tokenMapSchema`; one page per template on the base palette. A v2 dark theme previewed as stock light before. |
| `catalog/ingest.service.ts`, `catalog.routes.ts` | Preview files are `<template>.html`; `?scheme` is ignored. |
| `web/pages/ThemeDetail.tsx`, `Detail.scss` | The light/dark preview switch is gone. |
| `scripts/ingest-official.ts` | Takes `.xttheme` as well as `.xtplugin` (kind from the extension); catalogue entry for Redline. |
| `themePreview.test.ts`, `ingest.e2e.test.ts` | One page per template; v2 palette; v1 light half. |

## Verified beyond the suites

`backbone:check` green; marketplace 282/282. In a real browser on the dev instance:
Redline uploaded → the prompt showed its screenshot and "Dark theme"; **Keep** left the
site on its theme with the report saying so; **Switch** made Redline active; re-uploading
the active theme applied it with no prompt. Local marketplace ingest produced eight
preview pages in Redline's own palette, `appearance: dark`, free, screenshot extracted.
