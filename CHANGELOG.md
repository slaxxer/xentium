# Changelog

## The Style Editor, redesigned around the site you are editing

ACP → Appearance → Style Editor was a list. A rail of fourteen sections down the
left, one card of rows in the middle, and the live preview pushed below the fold —
so the thing being changed and the thing showing the change were never on screen
together. It also never said what "Inherited" inherited *from*, which is the one
question an admin has while looking at a colour they did not set.

It is now a canvas: the site's palette across the top, the live preview and a token
inspector side by side underneath, and four tabs where the rail used to be.

### Added
- **A palette board.** Every colour the site is built from — surfaces, brand, text,
  feedback — as swatches at the top of the page, each showing its value and a dot
  when it is a value *you* set rather than one you inherited. Clicking a swatch opens
  its group, so the board is navigation as well as display. Typography sits with it:
  family, size and weight are palette decisions.
- **The preview sits beside the inspector**, full height, and the toolbar says what
  it wants from you — "Click any surface to edit it". **Outline editable areas**
  dashes every surface that responds, because "click any surface" only helps once
  you can see which ones those are.
- **The inherit chain, spelled out.** Every row now reads `--btn-bg ← --c-accent`
  rather than a bare "Inherited", and distinguishes four origins: your override,
  a value from Everywhere, a value from the installed theme, and the built-in
  default. Overridden rows carry an accent spine, so one glance down the rail
  separates what you set from what the site handed you.
- **"What Publish will change."** The Draft pill counts the unpublished tokens and
  opens a list of exactly which ones, with scope and theme — instead of a warning
  triangle that said only that *something* was pending.
- **Per-theme change counts on the light/dark switch**, so work waiting on the side
  you are not looking at is visible from the header.
- **"Already set in"** chips on component groups: the scopes that group is already
  overridden in, one click away. The answer to "why is the navbar different?"
- **Jump to…**, a flat list of all twelve groups, replacing the permanent rail.
- **A real shadow editor.** None / Soft / Strong could pick a shadow but not design
  one. A fourth option, **Custom**, opens the parts a shadow actually has: which way
  it falls (up, down, left, right — opposite sides cancel to centred), how far, how
  much **blur**, how much **spread**, its colour and opacity, and whether it is
  **inset**. A preview renders the shadow on the site's own surface colour, and the
  resulting `box-shadow` is shown as text underneath.
- **Custom CSS names what it overrides.** Custom CSS is applied after every token,
  so a `:root` variable there silently beats the inspector. The tab now lists those
  declarations beside the editor, so the two surfaces stop contradicting each other.
- **Branding accepts a drop**, and shows the wordmark as it will actually render.
- **Style history says what changed** — derived by diffing each snapshot against
  the one before it, since the stored label is only a timestamp. The list is now
  one component shared with ACP → Appearance → Style history, which had drifted
  into a second, plainer rendering of the same rows.

### Fixed
- **Region and component token names were never translated.** `TOKEN_REGISTRY`
  labels are English documentation, not translations, and the editor rendered them
  raw — so half of a German or French Style Editor was in English. All 40 now have
  keys in every bundled locale, with the registry label kept as the fallback so a
  plugin's own token still renders a readable name.
- **Three rows resolved to nothing and rendered their placeholder.** "Info" showed
  an empty swatch and "Button text" showed the literal `#rrggbb`, because
  `--c-info`, `--c-update` and `--c-on-accent` are reachable through the inheritance
  chain but had no value at the end of it. Every chain now terminates, and a test
  fails if a new one does not.
- **An untouched card shadow showed three unlit chips** instead of the Soft preset
  it actually had.
- **Every radius control was dead in the preview.** The selection ring rounded
  itself with `border-radius: 4px` — which set the radius of the element it was
  highlighting. Selecting Card pinned the card at 4px, and editing a radius is
  exactly when its group is selected, so dragging Button, Card, Field or Menu
  radius changed nothing you could see. The ring is an outline now, which follows
  the element's own border curve anyway.

### Notes
- Soft and Strong still store as `var(--shadow-card)` / `var(--shadow-pop)`, so a
  site set to "Soft" keeps following whatever the installed theme calls soft.
  Switching to Custom resolves that reference to real numbers once — the point at
  which the value stops tracking the theme.
- A shadow the controls cannot describe is **left alone**: stacked shadows, an
  offset whose two axes differ (`4px 12px`), or a colour outside hex/rgb. Those
  stay verbatim and are edited as text, rather than being silently rewritten into
  something the controls can express.
- Region tokens still store under `global`, not their own scope bucket. `--nav-bg`
  is consumed only by `.pub-nav`, so `:root` and `.pub-nav` render identically —
  while every install that has set a navbar colour has it under `global`. Reading
  the region bucket would show those existing overrides as "Inherited" and write a
  second copy.
- Every colour on the page is a semantic token, so it renders in both ACP themes.
  The design was drawn in light mode only.

## ACP settings: a stale tab no longer reverts everyone else's changes

Three defects in how ACP settings forms decide what to save. All were found
while verifying the maintenance editor, and all predate it.

### Fixed
- **A settings tab left open silently reverted changes made elsewhere.** The
  draft re-seeded on `[settings.length]` — the NUMBER of settings rows — so a
  refetch that brought new *values* never reached the form, while the
  "saved" side it is compared against went fresh. Autosave saw a difference and
  wrote the whole stale draft back. Each new server snapshot is now merged per
  key: a key nobody touched locally follows the server, a key with an unsaved
  local edit keeps it. Applies to System → Settings and Moderation → Settings.
- **An endless save loop on any object-valued setting.** Draft-vs-saved is a
  JSON comparison, and the saved side has been through Postgres `jsonb`, which
  stores object keys in its own order. `{icon,label,url}` and `{url,icon,label}`
  are the same settings but different strings, and saving could not make them
  agree — so the form saved, refetched, disagreed, and saved again forever. One
  click on "Add link" was measured at 84 PUTs. Comparisons now normalise key
  order (`stableStringify`), which fixes it for every autosaving ACP form.
- **A save wrote every setting on the page.** One toggle PUT all 42 keys, which
  is what made the stale-tab bug destructive instead of merely wrong. Saves now
  carry only the keys that actually changed — the same click is one PUT.
