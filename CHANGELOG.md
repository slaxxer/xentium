# Changelog

## Icons you choose — Pro kits, one style, or one icon at a time

### Added

- **FontAwesome Pro, per instance.** An admin with their own Pro subscription pastes
  their own kit id in `Appearance → Style Editor → Branding` and the whole site draws
  with it. Nodevo keeps shipping the free set: with no kit, a kit that fails to load,
  or a kit that is slow, every icon still draws exactly as before.
- **One icon style for the whole site** — Classic, Duotone, Sharp and Sharp Duotone in
  four weights each, plus the Pro+ families (Jelly, Slab, Vellum, Utility and the
  rest). Plugins follow it too, with no plugin change and no rebuild.
- **Change any single icon.** In the layout editor, turn on **Icons** in the preview
  toolbar and click any icon on the page: it opens a picker, and the choice is saved
  into the layout draft and reaches visitors when the draft is published. Individual,
  not global — the heart on an article card and the heart in the sidebar are separate
  icons and stay that way.
- **An icon picker anywhere an icon is data.** Badge glyphs use it, and any block —
  core or plugin — gets the same control by declaring `format: "icon"` on a prop. The
  `heading` block gains an optional icon as the first example.

### Changed

- **Badge glyphs are no longer limited to a curated list of 48.** A site with a kit
  can use anything the kit draws.
- **The admin panel keeps the free icons**, whatever the site is set to — the same
  separation that already pins its font and its token layer. Changing how your
  community looks should not change the tool you change it with.

### Fixed

- **The layout editor's preview could miss what the editor told it.** State is pushed
  when the iframe fires `load`, which happens *before* the app inside has mounted and
  subscribed — so that push was dropped. The document survived only because it is
  re-pushed on every change; anything sent once was lost. The preview now announces
  itself and the editor answers.
