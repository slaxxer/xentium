# Changelog

## A Layout Editor you can work in, and a theme each reader chooses for themselves

### Added

- **The Layout Editor has three panes.** The tree, the preview, and a Block Settings
  panel that floats beside the selection instead of pinning to one side — the side is
  chosen from how much the panel would cover, with a threshold so it does not flip on
  every click.
- **A block CATALOGUE.** Adding a block is a searchable, categorised picker with an
  illustration and a sentence per type saying what it is for, in place of a flat
  select. Plugins may name their own glyph (`editorMeta.icon`) — the one case a core
  icon map cannot cover.
- **Per-visitor themes.** A reader can wear any installed theme — its colours AND its
  layouts — while everyone else keeps the site's own. The choice is a cookie: no
  account, no request, and nothing changed for anyone else.
- **`GET /api/themes/choices`**, the public half of the theme library: name, version,
  description and screenshot. The vendor, the manifest and the install record stay in
  the admin's inventory.
- **A theme picker in the brand row** — an icon and a dialog, a prop on `branding`
  rather than a block of its own. It draws nothing below two installed themes.
- **Export writes a theme's `description`.** It is what the picker shows under the
  name and what a marketplace listing reads.

### Changed

- **The preview's chips say different things.** Hover names the block's TYPE — the word
  a `.nvtheme` and the docs use — and the selected chip carries its actions, because by
  then the question is answered.
- **The footer band reaches the window edges.** `.nv-region`'s centred column moves onto
  the block's own `.nv-foot__inner`, exactly as the header already does it.
- **Reinstalling a theme id busts its CSS and layout caches**, which are keyed by id
  alone and would otherwise outlive the payload they were built from.

### Fixed

- **The reader's chosen theme could be undone by the staleness machinery.** The themed
  CSS response carries no `X-Style-Version` and no revalidation — a stamp let the
  reconciler read the visitor as stale and pull them back to the site's theme on the
  next stream tick.
- **A theme switch changed the colours but not the layouts.** The theme is in the
  layouts QUERY KEY as well as the URL now, and `refreshStyle` re-fetches the same half
  that was loaded — draft, a visitor's theme, or the site's own.
- **Compare mode removed.** It was built, and had nothing to say that the two staging
  areas did not already say plainly.
