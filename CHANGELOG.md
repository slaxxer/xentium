# Changelog

## Themes that arrive through the marketplace, and a layout you can actually arrange

### Added

- **Paid themes.** A theme is an entitlement like a plugin: `marketplace.paid_theme_ids`
  as its own key and its own walk, entitlement grants generalised to `<kind>.<id>`, and
  a download pre-check that may only ever ADD refusals the marketplace would also make.
- **See a theme before installing it.** The marketplace renders each theme from the
  package at ingest — one page per template per scheme — and the storefront and the ACP
  both show that markup before the button.
- **A theme's dependency footprint**, derived from the package rather than declared:
  what templates and blocks it uses, and a warning on the theme card when this site
  cannot draw them.
- **A theme LIBRARY.** `ncf_themes`: installed is not active, as for plugins. Switching
  is a decision, not a re-import; uninstalling the active theme is refused, and anything
  installed before the table is reconstructed into it.
- **The footer is a block.** `chrome.footer` ships one band holding its four pieces, the
  peer of `navbar` rather than of the masthead — its background, its floor and the line
  above it are settings now instead of hardcoded CSS.
- **The rail is finished.** It sticks, `--rail-width` and `--sidebar-width` are editable
  in the Style Editor, and the block picker marks page-width blocks when the target is a
  rail.

### Changed

- **Applying a theme is LIVE.** No publish step: activating a theme is one atomic
  decision, and staging made it two-step and two-place. Open tabs repaint over the
  existing style stream.
- **The ACP no longer wears the site's theme.** Token defaults are re-declared on
  `body.nv-acp` and custom CSS is anchored under `body:not(.nv-acp)`; `.nv-site-tokens`
  is the opt-out for the surfaces that must show the site's colours.
- **A page is a body and a rail.** Page templates lost their own `header`/`footer`
  bands — those were the site's, and every default shipped them empty.
- **The site header is one block**: a 250px band with a gradient and an optional logo,
  with `chrome.header` shipping `[header, navbar]` so the order decides which is on top.

### Fixed

- **The site kept the old theme after a switch** — two causes: `/appearance/css` was
  cached for 60s, and the style stream compared each event to the previous one rather
  than to what the client is holding.
- **An empty track held the row's width open.** `:empty` could never match — every block
  is wrapped in a `display: contents` element — so a rail whose blocks drew nothing
  still reserved its width and left a hole beside the feed.
- **The layout preview showed a page the site never renders**: an empty region's
  placeholder had no region class, so an empty rail took half the row.
- **The Style Editor's Aside section did nothing.** Its scope pointed at two class names
  that were deleted when the home page was decomposed into blocks.
- **An autosave could write one template's blocks into another template's draft** — the
  picker's key changes a render before the document does, and the 700ms timer can land
  in between. Silent, and it overwrote a layout nobody was editing.
