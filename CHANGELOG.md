# Changelog

## Typography that stays on the site, and a header that separates state from controls

Follow-up to the Style Editor redesign, all of it found by using the page.

### Fixed
- **The site font was re-typesetting the admin panel.** The served stylesheet applies
  the site font as `body, input, textarea, select, button { font-family; font-size;
  font-weight }`, and the ACP opts out by re-pinning those properties on
  `body.nv-acp` — but it only ever pinned the **family**. `body.nv-acp` is a body, so
  the site's size and weight went straight through: setting the site to 13px/700
  changed the ACP with it. All four properties are pinned now.
- **The font weight had no effect in the live preview.** The preview built its own
  font CSS instead of the one the API serves, and the two had drifted: it never
  emitted the weight at all, it sized the page with `html { font-size }` (which
  rescales every rem, something production never does), it used a different font
  stack, and it injected an ACP override into the preview iframe, where nothing is
  the ACP. So the one typography control with no visible effect was the one you were
  most likely to reach for.

  The font CSS now lives in `@nodevo/contracts` (`fontRootDecls` / `fontBodyRule` /
  `FONT_STACKS`) and **both** the API's `buildCSS` and the preview build from it, so
  they cannot diverge again. The served stylesheet is byte-identical to before.
- **A token edit rewrote all three font settings.** Every autosave PUT
  `appearance.font.family`, `.size` and `.weight` from whatever the tab held in
  memory — the same defect fixed for System → Settings in the previous release,
  still present here. An editor left open would write its stale font back over
  whoever had changed it since. Only a font that actually changed is written now;
  recolouring a button writes zero font settings.

### Changed
- **Appearance → Style History is retired.** It is the Style Editor's History tab,
  beside the editor the snapshots came from. `/admin/style-history` redirects rather
  than 404s, and the Style Editor's tab now lives in the URL (`?tab=history`) so the
  redirect lands on it — which also makes every tab linkable and refresh-safe.
- **The Style Editor header separates what the page knows from what you can do.**
  The draft state and the autosave indicator move to their own line above the
  light/dark switch, Reset all and Publish — readings and controls were sharing a row
  where nothing said which was which. The state line reserves its height so the
  header does not jump when the draft pill appears.

### Notes
- The ACP opts out by re-pinning the custom properties rather than by narrowing the
  server's selector: the admin panel is the only surface that opts out, and it is the
  one that knows it. A test asserts every declaration in that rule resolves through a
  `var()`, since a literal value there would silently re-break the opt-out.
