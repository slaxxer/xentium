# Last codebase update — 2026-09-18

Both repos. One change, in five slices: a site has ONE look, and it is the theme's.
The light/dark toggle was letting a visitor's OS override the theme author, so it is
gone — along with the paired storage, the paired package files, and the three controls
that drove it.

## xentium (this repo)

### Slice 1 — the storage collapse

| File | Why |
|---|---|
| `modules/appearance/appearance.service.ts` | ~20 of 36 methods. Seven paired setting keys become one each, each with the pre-collapse name as a **read fallback**; `buildCSS` loses its `for (const theme of …)` loop and emits one `:root, .xt-site-tokens`. New `readStaged(key, legacyKey)` is the one door to that fallback. |
| `modules/appearance/appearance.routes.ts` | Wire shape: `{ tokens, theme, installedTheme }` instead of `{ light, dark, … }`; `PUT /tokens`, `PATCH /tokens/scope/:scope`, `GET/PUT /custom-css` and the preview endpoint all take one map or one string. |
| `packages/contracts/src/appearance.ts` | `HEARTH_DEFAULT_TOKENS` is one palette. `TokenSet`, `ScopedTokenSet` and `scopedTokenSetSchema` survive as **deprecated aliases** so call sites still read — and so anything reaching for `.light` is a compile error, which is the point. |

⚠ Writers **delete** the pre-collapse rows. They are a read fallback, so a stale light
half outliving the thing that wrote it would win again for every token the new set
leaves absent.

### Slice 2 — the `.xttheme` format (package version 2)

| File | Why |
|---|---|
| `packages/contracts/src/theme.ts` | `THEME_PATHS` collapses to `css` + `custom`; new `THEME_PATHS_LEGACY` holds the four old names, **read on import, never written on export**. |
| `modules/themes/theme.service.ts` | Export writes one of each. Import prefers the new names, falls back to the old, and identifies a pre-collapse `tokens.json` by a top-level `light`/`dark` — neither is a scope name. What it cannot use goes into the new `ignoredFiles` report field. |
| `modules/themes/theme.routes.ts` | The export body accepts `appearance`. |
| `docs/theme-packages.md` | The format, the before/after table, and why the old one still installs. |

### Slice 3 — the manifest says which look it is

`themeManifestSchema` gains `appearance: "light" | "dark"` (default `light`), and
`ThemeExportDialog.tsx` asks for it as two buttons. Declared rather than inferred:
guessing from `--c-bg` breaks on exactly the palettes that need it most.

### Slice 4 — the Style Editor

| File | Why |
|---|---|
| `admin/pages/StyleEditorPage.tsx` | The mode switch, `Mode`, and every `tokens[mode]` go; the CSS console is one stylesheet; `TokenRow`, `ShadowControl` and `PreviewFrame` lose their `mode` prop and the preview stops stamping `data-theme`. |
| `admin/pages/BlockStyle.tsx` | `Patch` is one map, not a pair; the variant preview emits `:root .xt-v--<name>`. |
| `admin/components/StyleHistoryList.tsx` | Flattens one map, and recognises a two-palette snapshot. |
| `admin/pages/shadowValue.ts` | One seed pair. A dark theme that wants heavier shadows sets `--shadow-card` itself. |

### The three dead controls

`PubNav` lost its toggle in the first commit. `InstallerWizard.tsx` and
`PreferencesTab.tsx` lose theirs here, with their styles and locale strings: all three
set `data-theme`, which the site no longer reads. **`useTheme` survives** — its header
now says what it governs: the ACP and the ModCP, which opt out of the site palette on
purpose and are tools rather than part of anyone's design.

In its place, **Account → Preferences gains the theme chooser** — the same choice the
footer offers, through the same cookie and the same vocabulary. It hides itself below
two installed themes, for the same reason the footer one does.

## xentium-marketplace

| File | Why |
|---|---|
| `prisma/schema.prisma` + `20260918190000_theme_appearance` | `mkt_products.appearance`, nullable. Null means "the package did not say", which is true of every row predating the column. |
| `catalog/ingest.service.ts` | `extractAppearance` reads `manifest.json` **directly** rather than through `themeManifestSchema`, so it does not wait on a contracts republish. Rewritten on every release, including to null — a 2.0 that went dark must stop advertising itself as light. |
| `catalog/catalog.routes.ts`, `catalog/listing.routes.ts` | On the list (the buyer filters by it) and on the detail page. Omitted when null. |
| `web/components/ListingCard.tsx` + `.scss` | A pill in the card's top row — not over the picture, because a theme without a screenshot needs it just as much. Fixed colours: they name the theme being sold, not the marketplace's own ground. |
| `web/pages/ThemeDetail.tsx` | First fact in the list. |

## Verified beyond the suite

Against the real dev database: a pre-collapse `appearance.tokens.light` row is read and
served; a new `appearance.tokens` row wins over it; a `variant.accent` bucket emits as
`:root .xt-v--accent`. In the browser: the site renders its light palette **while
`data-theme="dark"` is still on the root element** — which is the proof the render path
no longer answers to it. The new preferences picker was driven through both branches:
choosing another theme writes the cookie and reloads; choosing the site's own **clears**
it, so the reader keeps following the site.
