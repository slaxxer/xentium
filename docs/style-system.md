# The style system

How a Xentium site gets its look: tokens, layers, themes, the stylesheet we serve, and
the rules that keep it all consistent. It's for you if you work on core or build plugins
or themes.

| See also | For |
|---|---|
| [`theme-packages.md`](theme-packages.md) | the `.xttheme` file format in detail |
| [`plugin-blocks.md`](plugin-blocks.md) | registering blocks a layout can place |

---

## One look, one palette

**A site has one look, and it's the active theme's.** There's no light/dark toggle, no
`prefers-color-scheme` and no `[data-theme]` selector anywhere in what the site serves.
When you build a theme, you build a dark one *or* a light one and say which in the
manifest (`manifest.appearance`). A reader who wants a different look picks a different
**theme** (see [Readers choosing a theme](#readers-choosing-a-theme)), not a mode.

Why: a visitor's OS used to override the theme's author. A theme designed as dark would
be served in its light variant, which the author may never have tuned, and a theme that
shipped no dark tokens fell back to stock Xentium completely. The marketplace listing
showed one thing and the site rendered another.

**The ACP and ModCP are the exception.** They're tools, not part of anyone's design. They
declare the whole palette again on `body.xt-acp` and keep their own light/dark switch.
`useTheme` (`apps/web/src/hooks/useTheme.ts`) still sets `data-theme` on the root element,
and only the admin panels read it.

---

## Tokens

Components never use a raw colour. Everything reads a CSS custom property, in three tiers
(defined in `apps/web/src/styles/_tokenDefaults.scss`, emitted by `tokens.scss`):

| Tier | Example | Who changes it |
|---|---|---|
| 1 · primitives | `--primitive-blurple-600` | nobody; components never reference them |
| 2 · semantic | `--c-bg`, `--c-accent`, `--c-fg-muted` | Theme Studio, themes |
| 3 · component | `--card-bg`, `--nav-bg`, `--btn-radius` | themes; each defaults to a tier-2 token |

Tier-3 tokens default to tier-2 ones (`--card-bg: var(--c-card)`), so when you recolour
the palette, every component follows. If you override a component token, you break that
link for that one component, which is usually what you want.

**Theme Studio reaches every token.** Each token `_tokenDefaults.scss` declares has a
row: the palette, regions and components, plus tints and states, typography, spacing,
corners, shadows, page layout and the base palette. The editor reads each token's
starting value from `_tokenDefaults.scss` itself, and `foundationCoverage.test.ts` fails
when you add a token to that file without registering it in `TOKEN_REGISTRY`
(`packages/contracts/src/tokens.ts`).

`HEARTH_DEFAULT_TOKENS` in `@xentium/contracts` mirrors the **editable** tokens from
`tokens.scss`, so the API and Theme Studio agree on the defaults. `tokens.scss` is
still what actually renders, so when you change an editable default there, change it in
`HEARTH_DEFAULT_TOKENS` too.

### Scopes

We store tokens **by scope**:

```jsonc
{
  "global":         { "--c-accent": "#e22b2b" },   // → :root, .xt-site-tokens
  "footer":         { "--c-bg": "#0e0e12" },       // → .xt-foot  (SCOPE_SELECTOR)
  "variant.accent": { "--surface-bg": "…" }        // → :root .xt-v--accent
}
```

`SCOPE_SELECTOR` in `packages/contracts/src/tokens.ts` maps each scope to its selector. A
token set in a region's scope only applies inside that region.

### Validation

We write every token value **as is** into the stylesheet we serve, so we validate it on
the way in with `tokenMapSchema`: names have to be `--custom-properties`, and values can't
contain `{ } < > ;`, because a stray brace would close the block. The same schema guards
Theme Studio (its token editor and the Layout mode's variant panel), `.xttheme` imports and the
marketplace's preview renderer. Don't write a second copy of it.

### Text sizes

Text sizes work the same way: components use a size token, never a pixel value. The
scale is in `rem`, so it follows the text size a visitor set in their browser (the root
is `font-size: 100%` for that reason), and nothing on the site goes below 12px.

| Token | Size | For |
|---|---|---|
| `--fs-2xs` | 12px | uppercase labels, count badges, the smallest meta |
| `--fs-xs` | 13px | timestamps, captions, "by …" |
| `--fs-sm` | 14px | secondary text, buttons, dense lists |
| `--fs-md` | 15px | text on cards and rows |
| `--fs-base` | 16px | body text, form fields |
| `--fs-read` | 17px | long reading: articles, forum posts, messages |
| `--fs-lg` … `--fs-3xl` | 18–30px | headings |

Every step is `calc(<size> * var(--fs-scale))`. Theme Studio's text size (Typography,
shown as a percentage) sets `--fs-scale`, so one control makes all text on the site
bigger or smaller together. The ACP pins the scale to 1 and keeps its own sizes.

Plugins use the same tokens in their inline styles (`fontSize: "var(--fs-sm)"`). A plugin
that sets its own pixel size won't grow with the rest of the site. On touch screens, form
fields never go below 16px, because anything smaller makes iOS Safari zoom the page when
you tap into it.

### The logo icon

Every install ships with the Xentium icon (`apps/web/public/brand`, plus `favicon.ico` and
`manifest.webmanifest` at the root). It is the default logo in the header, on the sign-in,
maintenance and 404 pages, and the default favicon. An admin's uploaded logo or favicon
(Theme Studio, Branding) replaces it. The ACP and the installer always show the Xentium icon.

`--logo-icon-from` and `--logo-icon-to` colour the default icon's box (its gradient;
the same colour twice makes it flat). They do nothing to an uploaded logo, and the ACP
and the installer ignore them. Two more tokens dress the site's logo, whichever it is:
`--logo-icon-border` and `--logo-icon-shadow` (Theme Studio, Colours & type, Logo icon).
Both default to `transparent`. They are drawn with `drop-shadow`, so they follow the logo's shape: a
round PNG gets a round ring. A theme can set them like any other colour.

### Icon size

`--icon-scale` (1 = stock) scales every icon on the site without touching the text size
(Theme Studio, Colours & type, Icon size: 70% to 200%). Site icons carry the `xt-ico`
class from the shared icon component and are scaled with `zoom`, so icons that set their
own size inline scale too, kit icons included. The admin panel never carries the class.

### Style variants

A block can have `variant: surface | muted | accent | plain`. A variant is a named
**group of tokens**, not colours on one block. Its defaults live in `tokens.scss`, written
in palette tokens, and a theme overrides them in the `variant.<name>` scope. `section` is
the block that actually paints (`--surface-*`). Every variant also points `--card-bg` and
friends at the same values, so one token changes both a section and a card. See
[`theme-packages.md` → Style variants](theme-packages.md#style-variants).

### Theme style: colourway, corners, glow

The Studio's Layout inspector has two tabs. **Block** holds what belongs to the selected
block: its settings, who sees it, and its edge art. **Theme style** holds the look the
whole theme wears, plus the block's style variant, since a variant's colours are theme
tokens too.

Everything on the Theme style tab is a named set of tokens (`themeStyle.ts` in
contracts). Choosing one patches the theme's appearance draft through the same
`PATCH /appearance/tokens/scope/global` Theme Studio uses, so it is staged, published
and exported like any other token edit:

| Control | Tokens it writes |
|---|---|
| Colourway | whatever the theme's manifest lists for it (see [Colourways](theme-packages.md#colourways)) |
| Corners: Rounded / Chamfered / Sharp | `--radius-sm/md/lg/xl`, `--corner-cut`, `--corner-cut-sm`, `--clip-card`, `--clip-sm` |
| Glow on accent elements | `--glow-accent` |

A value the theme already ships is **cleared, not copied**, so a later update of the
theme can still move it (`patchFor`). The editor reads which choice is current from the
tokens (`cornerModeOf`, `wears`). Corners set by hand to something else show no choice
selected, and the tab says so.

Chamfered corners are a `clip-path`, which is why they have their own tokens instead of
riding on the radius: `--clip-card` and `--clip-sm` default to `none`, because any clip,
even a plain rectangle, cuts off a card's shadow. Card surfaces read `--clip-card`;
buttons, pills and tabs read `--clip-sm`; a painted `section` reads it through its
variant (`--surface-clip`) and drops it while it carries edge art, which hangs outside the
box. Surfaces that hold popovers (the composer, modals) don't clip at all, since a
dropdown hanging outside the card would be cut off. Primary buttons wear `--glow-accent`.

The preview serves the published stylesheet, so the page injects the theme's staged
global tokens into it (`themeDraftCss`), on both tabs, beside the variant CSS.

---
---

## Every theme keeps its own work

Each installed theme, and the built-in **Core** theme, carries its own appearance:

- layouts (every template, plus per-page layouts),
- token overrides,
- custom CSS,
- the site font,
- the site frame (boxed, floating and so on).

You edit one theme at a time, and switching the site's theme only changes **which one
visitors see**. Nothing is copied or merged between themes, so switching back to a theme
gives you exactly the work you did on it.

Core is the look Xentium ships with: the bundled `tokens.scss` and the built-in layouts.
It's what the site wears when no installed theme is active, and you can edit it like any
other theme.

### Theme keys

A **theme key** names the theme a read or write is about: `''` for Core, otherwise the
installed theme's id. In a query string Core is `_core`, which can't collide with a theme
id because ids start with a letter or a digit.

- **Theme Studio** edits one theme. The theme lives in the page URL as `?theme=<key>`, so
  **Open in Theme Studio** on the Themes page opens it on that theme and a reload keeps
  it; the header names it (`ThemeScopePicker`). Without the parameter, the Studio works
  on the active theme.
- Every admin endpoint behind the editors takes the same `?theme=`. On the API,
  `resolveEditingKey()` (`apps/api/src/modules/themes/themeKey.ts`) turns it into a key,
  uses the active theme when it's missing, and refuses an id that isn't installed.
- The editors' preview iframes are real site routes, so they carry the choice as
  `__theme=<key>` and render that theme's draft and stylesheet
  (`apps/web/src/lib/editingTheme.ts`). You can edit and preview a theme the site isn't
  wearing.
- Both editors remount when you change the picker, and every React Query key they use
  includes the theme. The query cache outlives the remount, so a key without the theme
  would show another theme's data.

### A theme's package is the layer underneath

What a theme **ships** (its library row's `payload` in `xcf_themes`) sits under your edits
to it:

```
what the theme ships    xcf_themes.payload            read-only, replaced by an update
your edits              per-theme settings and rows   what the editors write
──────────────────────
served                  shipped + your edits
```

- **Tokens** merge token by token: `getEffectiveTokens(key)` is the shipped set with your
  overrides on top. If you recoloured one accent and the theme's next version changes
  twenty tokens, you get the other nineteen and keep your accent.
- **Custom CSS**: we emit the theme's stylesheet first and yours after it, so you win
  when specificity is equal.
- **Layouts** resolve per template: your row for that page, then your row for the
  template, then what the theme ships, then the built-in default. A template you never
  touched therefore follows the theme, including its updates.
- **The site frame** resolves the same way: your frame, then the theme's `frame.json`,
  then full width.

`GET /api/appearance/tokens?theme=<key>` returns `{ tokens, theme, installedTheme }` with
your overrides and the shipped set **kept apart**. If we merged them there, the editor
would write the theme's values back as your overrides and the theme underneath would stop
mattering.

What the reset buttons do:

| Button | What it does |
|---|---|
| **Reset** on one token | back to the theme's value (Core: the bundled default) |
| **Reset appearance** | clears your tokens, fonts and custom CSS **for this theme** and keeps the theme |
| **Reset** on a template (Theme Studio, Layout mode) | removes your layout, so the page shows what the theme ships (Core: the built-in default) |
| **Revert to theme** on a template | stages the theme's version as a draft you can preview and publish |

### Draft and publish

Token edits and layout edits go into a **draft for the theme you're editing**. Theme
Studio has **one Publish**, and it always puts both live together, the layouts and the
colours they were designed with (`POST /api/admin/themes/studio/publish?theme=<key>`).
The bar beside it counts both halves (`GET /api/admin/themes/studio/status`). The
scheduled publish job does the same for every theme. Fonts, custom CSS and branding save
live, as they always have.

The previews read the draft: `GET /api/appearance/css?source=draft&theme=<key>` for the
stylesheet, and `GET /api/admin/layouts?theme=<key>` for the layouts.

Putting on a theme doesn't use draft and publish. It's one decision, not a batch of
edits; see [Switching](#switching).

### Where it's stored

Per-theme settings are suffixed `@<themeId>`. **Core keeps the plain keys**, which is why
a site that never installed a theme reads exactly what it always stored.

| Key (Core / an installed theme) | What's in it |
|---|---|
| `appearance.tokens` / `appearance.tokens@<id>` | your live token overrides |
| `appearance.tokens.draft` / `…@<id>` | your token draft |
| `appearance.custom_css_light` / `…@<id>` | your own CSS (the name is historical, see below) |
| `appearance.custom_css_compiled` / `…@<id>` | the theme's and your CSS, scoped and cached for serving |
| `appearance.font.family`, `.weight`, `.size` / `…@<id>` | the site font |
| `xcf_layouts` rows with `theme_key` | your layouts and site frame (`@site-frame`), draft and published |
| `xcf_style_history` rows with `theme_key` | published token snapshots, 20 per theme |
| `appearance.theme.installed` | the manifest of the active theme; absent means Core is live |
| `appearance.theme.rollback` | the one-step undo point (see [Undo](#undo)) |

Before we went to one look, some of Core's keys came in `.light` / `.dark` pairs. We
still read those as a fallback **for Core only** (installed themes never had them) and
delete them on the next write. `light` and `dark` are never scope names, so if you see
them at the top level of a stored value, you know it's the old format.

`appearance.custom_css_light` keeps its misleading name because `appearance.custom_css`
is already taken by an even older version of the setting. Renaming it would mean another
fallback, for nothing a user could notice.

**Upgrading.** Sites from before per-theme storage had one layer of edits over whichever
theme was active. On the first start after upgrading, `perThemeMigration.ts` moves that
layer onto the theme that was active (or leaves it on Core when none was), so the live
site looks exactly as it did. Every other installed theme starts as its package shipped
it. A theme installed before the library existed gets a library row built from what it
left behind.

---

## The stylesheet we serve

`GET /api/appearance/css` is public and gets hit a lot. It serves the **active** theme's
stylesheet, built per theme by `appearanceService.buildCSS()` from:

1. one block per scope (`global` first, so regions can override it), with `global` on
   **`:root, .xt-site-tokens`**;
2. the site font's rule, if that theme has one (see [Fonts](#fonts));
3. the compiled custom CSS: the theme's first, yours last.

We skip empty blocks. A site on Core with no overrides gets an almost empty stylesheet
and renders with the bundled `tokens.scss`.

The built stylesheet is cached per theme against the style version, so a request costs
one settings read until something changes.

**Live updates.** Everything that changes what a theme looks like bumps the style version.
Browsers follow it over `GET /api/appearance/stream` (SSE; `/version` is the polling
fallback) and refetch the stylesheet, so every open tab updates when a switch or a
published edit lands.

**`.xt-site-tokens`** brings the *site's* palette back inside something that opted out of
it. The ACP wraps the Studio's Layout variant probe in it, so the probe can measure what
the site would actually paint.

### How custom CSS is scoped

We scope your CSS and the theme's CSS with postcss **when it's saved**, not on every
request:

- every rule gets anchored under **`body:not(.xt-acp)`**, so site CSS never reaches the
  admin panel;
- `:root` / `html` rules stay document-wide (you can't qualify a rule on the root element
  with a class on its child), which is how a stylesheet sets tokens or
  `color-scheme: dark`;
- `@keyframes` steps and nested rules stay as written.

A **theme's** stylesheet has two extra rules, which we enforce on import: no `@import`,
and no remote `url()`. It can reference its own `assets/…` (we rewrite those to wherever
the files end up), `data:` URLs and paths on the same site.

### Fonts

Theme Studio font belongs to the theme you're editing and applies to **that theme's
whole site** (body and headings, `--ff-sans` and `--font-display`). Users can override it
on their profile. The ACP always uses Poppins (`body.xt-acp` pins family, weight and
size). It's stored per theme and saved through `GET`/`PUT /api/appearance/font?theme=<key>`.

A theme can also ship its own font (`@font-face` in `styles/custom.css`, the file in
`assets/`) and point `--font-display` at it with a token. Our Redline theme does that with
Oxanium.

---

## Themes on a site: install, switch, update, undo

A theme is **data**: layout documents, tokens, a stylesheet, a site frame and images.
There's no code, so installing one can't run anything; plugins are where code goes.
Installed themes live in a **library** (`xcf_themes`, one row per theme). One of them is
active, or none, in which case Core is live.

### Installing is not switching

| What you import | What happens |
|---|---|
| a **new** theme | it's added to the library **inactive**, the site doesn't change, and we ask whether to switch |
| a new version of a theme you already have | that theme is **updated** (see [Updating](#updating)); if it's the active one, visitors see the update right away |

The question comes from the **switch prompt** (`offerThemeSwitch` in
`features/admin/hooks/themeSwitchPrompt.tsx`). It shows the new theme's screenshot, its
light/dark look, and *"Switch to X" / "Keep Y"* (or *"Keep the default look"* on a site
on Core). Every install path uses it: the upload on the Themes page, the Marketplace grid,
and the owned-licence rows. The import report tells you which case happened through
`activated` and `current`.

You don't have to switch to a theme to work on it. Open it from the Themes page (or pick
it in the editors) and get it right before visitors see it.

### Switching

`POST /api/admin/themes/library/:id/activate` makes a theme the live one, and
`POST /api/admin/themes/core/activate` goes back to Core. A switch is live straight away
(there's no publish step) and bumps the style version.

Nothing is written apart from which theme is active. Every theme already holds its own
layouts, tokens, CSS, font and frame, so a switch can't leave the previous theme's
stylesheet or fonts behind, and it can't overwrite anything you did to the next one.

### Updating

When you import a new version of an installed theme:

- templates you **never changed** (or changed back to exactly what the old version
  shipped) follow the new version;
- templates you **changed** are kept, and the import result lists them under `kept`;
- tokens and custom CSS follow the new version wherever you didn't override them, because
  your overrides sit on top of whatever the theme ships;
- the site frame follows the same rule as a template.

This is decided against the **old** package before it's replaced
(`layoutService.releaseUntouched`), because after the update "the same as what it ships"
would compare against the wrong version. See
[`theme-packages.md` → Updating](theme-packages.md#updating-a-theme-without-losing-your-work).

### Undo

`POST /api/admin/themes/discard` undoes the last theme change:

- after a **switch**, it switches back to the theme that was live before (Core if that
  theme has since been removed);
- after an **update**, it puts back the old version of the package and that theme's
  layouts as they were before the update.

**It only goes back one step.** The next switch or update overwrites the undo point. To go
back further, activate the old theme from the library.

### Removing a theme

Removing a theme deletes its package, its files and **every edit you made to it**, after a
confirmation. If it's the active theme, the site switches to Core first.

---

## Readers choosing a theme

A reader can wear any **installed** theme instead of the site's own. That's their choice
alone and changes nothing on the server.

- It's stored in the `xt_theme` cookie (`apps/web/src/lib/viewerTheme.ts`), not in
  `localStorage`, because both the layout request and the stylesheet request need it
  before the first paint, and guests need it too.
- It's sent as `?theme=<id>` to `/api/appearance/css` and `/api/layouts`. The API checks
  it against the library, and an id that doesn't match anything falls back to the site's
  own theme.
- A reader wearing another theme gets it **as you've made it**: what the theme ships with
  your published edits to that theme. Your edits to the active theme don't come along;
  they were made for a different theme's surfaces.
- It's offered in the footer (`ThemeChooserBlock`) and in Account → Preferences. They're
  **the same choice**: same cookie, same strings (`themeChooser.*`), same reload, and the
  same rule that **with fewer than two installed themes, neither shows up**. If you change
  one, change both.
- Choosing the **site's own** theme **clears** the cookie instead of storing that theme's
  id. Otherwise the reader would stay on it after you switch.
- An installed theme is **offered to readers right away**, even if you kept your current
  one. We decided against a separate "offer to readers" setting.

---

## The marketplace side

- A listing's **light/dark badge** comes from the package's `manifest.appearance`, read
  when the release is added. It's **declared, never guessed**: measuring the brightness of
  `--c-bg` breaks on mid-grey, sepia and duotone palettes. A package that doesn't say gets
  no badge.
- **The preview** is rendered once per template **when a release is added**, from the
  package's own layouts and `global` tokens on top of the base palette, which is how the
  CMS serves it. It understands both package formats (an old `{ light, dark }` file keeps
  its light half, as the CMS importer does) and validates with the CMS's own
  `tokenMapSchema`. Since previews are rendered when a release is added, **a fix to the
  renderer only reaches a listing once its release is added again.**

---

## Rules of thumb

- **No hardcoded visual values** in components. Always use a token. Theme Studio only
  edits semantic tokens.
- **Target blocks with `xt-b--<type>`** or your own `className` handle, not their inner
  classes. Never use `>`, `+` or `~` across a block boundary: every block sits in a
  `display: contents` wrapper, so the combinator quietly matches nothing.
- **Check the stylesheet we actually serve**, not the docs. `curl /api/appearance/css`
  tells you what visitors get, and `curl '/api/appearance/css?theme=<id>'` what a reader
  wearing that theme gets.
- **Exporting a theme exports your edits to it.** `POST /api/admin/themes/export` packs
  the active theme as you've made it (or the one in `?theme=`), so a screenshot or export
  from a dev site includes whatever you changed there.
- **Anything that writes a theme's tokens, stylesheet, font, frame or layouts has to bump
  the style version**, or open tabs keep the old look until they reload.
- **Pass the theme key.** Any new admin endpoint that reads or writes appearance takes
  `?theme=` through `resolveEditingKey()`, and any new editor request goes through
  `withTheme()`. A call without it quietly edits the active theme instead of the one on
  screen.
