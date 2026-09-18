# Changelog

## A site has one look, and it is the theme's

### Changed

- **The light/dark toggle is gone, everywhere.** A visitor's operating system used to
  override the theme author: `prefers-color-scheme` decided which palette the site
  painted, so somebody could buy a theme designed dark and have half their readers
  served its light half — which the author may never have tuned. A theme shipping no
  dark tokens fell all the way back to stock Xentium, so it did not appear at all.
  A theme is now ONE look, designed by its author and chosen by the admin.
- **A reader who wants a different look picks a different THEME.** The footer chooser
  already did this; it is now the only control, and the same choice is offered in
  **Account → Preferences** beside language and font.
- `tokens.scss` declares a single palette at `:root`, and the served stylesheet emits
  one root — `:root, .xt-site-tokens` — with no `[data-theme]` selector anywhere.

### Appearance storage

- `appearance.tokens.{light,dark}` and six more paired settings collapse to one key
  each. **Every pre-collapse name is still read as a fallback**, so an existing site
  keeps the look it has; the light half is what survives, because `:root` was always
  the light palette. Writers retire the old rows rather than leaving them, and
  `restoreHistory` recognises a two-palette snapshot and restores its light half.

### `.xttheme` — package version 2

- `styles/light.css` + `styles/dark.css` become **`styles/tokens.css`**;
  `custom-light.css` + `custom-dark.css` become **`styles/custom.css`**; `tokens.json`
  is the scope map itself rather than a `{ light, dark }` pair.
- **A version-1 package still installs.** The importer reads every old name and keeps
  the light half. The dark half is *reported*, not dropped in silence: the import
  result carries `ignoredFiles` and the ACP prints it.
- New manifest field **`appearance: "light" | "dark"`** (default `light`), asked for in
  the export dialog. Declared, never inferred — luminance off `--c-bg` works until a
  palette is mid-grey, sepia, or sets its background only in custom CSS.

### Style Editor

- The mode switch is gone and the editor edits one palette; the custom-CSS console is
  one stylesheet; the Layout Editor's variant panel writes one token map and its
  preview drops the `[data-theme="dark"]` prefix.

### Removed

- The navbar's theme toggle, the installer's, and the light/dark/system picker in
  Account → Preferences — all three set `data-theme`, which nothing on the site reads
  any more. The ACP and the ModCP keep their own dark mode: they deliberately opt out
  of the site's palette, and they are tools rather than part of anyone's design.

### Marketplace

- A theme listing says whether it is **dark or light**, taken from the package's
  manifest at ingest, shown as a badge on the card and as a fact on the detail page.
  Absent when the package did not declare it — a badge is a claim.

### Notes

- Saved layouts that placed the old `themeToggle` block still parse: the schema is
  kept and the block is simply not registered, so an admin's document is never
  rewritten out from under them. Pinned by a test.
