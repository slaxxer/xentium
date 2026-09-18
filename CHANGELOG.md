# Changelog

## Installing a theme no longer changes the site — the admin is asked

### Changed

- **Installing is not switching.** A new theme — uploaded on Appearance → Themes, or
  installed from the Marketplace or an owned licence — now lands in the theme library
  **inactive**, and the admin is asked: *Switch to Redline* or *Keep My theme* (*Keep the
  default look* on a site without one). The prompt shows the theme's screenshot and its
  declared light/dark look. "Switch" is the ordinary library activation — live at once,
  with Undo. "Keep" changes nothing; the theme waits in the library.
- **An update to the theme the site is already wearing still applies on install**, with
  the usual inheritance (customised templates kept). Asking there would leave the
  library listing 1.1 while the site wore 1.0.
- An installed theme is offered in the reader theme chooser straight away, whichever
  answer the admin gave.
- The import report and the marketplace install result carry `activated` and `current`,
  and the report says "added to your library" when the site was not touched.

### Fixed

- **Switching to a theme without a stylesheet left the previous theme's CSS on the
  site.** The theme layer was written only when the incoming theme had tokens or custom
  CSS, so its fonts and rules kept painting a site that had switched away. A switch now
  replaces the theme layer outright — no tokens or no stylesheet clears the old one.
  (Layouts are unchanged on purpose: a template the new theme does not ship keeps what
  the site had.)

### Docs

- **New: `docs/style-system.md`** — the style system for developers in one place: one
  look / one palette, token tiers and scopes, the theme ⊕ admin layers and their storage
  keys (and the legacy-key fallbacks), the served stylesheet and CSS scoping, installing
  vs switching vs undo, reader-chosen themes, and the marketplace side.
- `docs/theme-packages.md` no longer claims an import "lands in the draft, never live" —
  switching has been live by design; it now says what install and switch each do.
