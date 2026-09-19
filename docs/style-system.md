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
| 2 · semantic | `--c-bg`, `--c-accent`, `--c-fg-muted` | the Style Editor, themes |
| 3 · component | `--card-bg`, `--nav-bg`, `--btn-radius` | themes; each defaults to a tier-2 token |

Tier-3 tokens default to tier-2 ones (`--card-bg: var(--c-card)`), so when you recolour
the palette, every component follows. If you override a component token, you break that
link for that one component, which is usually what you want.

`HEARTH_DEFAULT_TOKENS` in `@xentium/contracts` mirrors the **editable** tokens from
`tokens.scss`, so the API and the Style Editor agree on the defaults. `tokens.scss` is
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
the Style Editor, the Layout Editor's variant panel, `.xttheme` imports and the
marketplace's preview renderer. Don't write a second copy of it.

### Style variants

A block can have `variant: surface | muted | accent | plain`. A variant is a named
**group of tokens**, not colours on one block. Its defaults live in `tokens.scss`, written
in palette tokens, and a theme overrides them in the `variant.<name>` scope. `section` is
the block that actually paints (`--surface-*`). Every variant also points `--card-bg` and
friends at the same values, so one token changes both a section and a card. See
[`theme-packages.md` → Style variants](theme-packages.md#style-variants).

---

## Layers: theme and admin

What we serve is two layers, merged **token by token**:

```
theme layer   appearance.tokens.theme     what the installed theme shipped
admin layer   appearance.tokens           what the admin changed in the Style Editor
────────────
served        getEffectiveTokens() = theme + admin   (the admin wins, token by token)
```

That's what makes a theme update safe. If the admin recoloured one accent and the
theme's next version changes twenty tokens, they get the other nineteen and keep their
accent.

- `GET /api/appearance/tokens` returns `{ tokens, theme, installedTheme }` with the two
  layers **kept apart**. If we merged them there, the editor would write the theme's
  values back as admin overrides, and the inheritance would be gone.
- **Reset** on a token goes back to the theme's value, not stock Xentium. *Reset
  appearance* clears the admin layer and keeps the theme.
- **Custom CSS** works the same way: we emit the theme's stylesheet
  (`appearance.custom_css.theme`) before the admin's own CSS, so the admin wins when
  specificity is equal.
- **Layouts** inherit per *template*, not per block. A template the admin changed away
  from the theme's version is kept on update. See
  [`theme-packages.md` → Inheritance](theme-packages.md#inheritance-updating-a-theme-without-losing-your-work).

### Draft and publish (Style Editor edits only)

The admin layer has a draft. Style Editor edits go into `appearance.tokens.draft` and go
live when you **publish** (now, or on a schedule through the `appearance-publish` job).
The editor previews `theme draft + admin draft` through
`GET /api/appearance/css?source=draft`.

**Themes don't use draft and publish.** Putting on a theme is one decision, not a batch
of edits; see [Switching is live](#switching-is-live).

### Where it's stored

| Key | What's in it |
|---|---|
| `appearance.tokens` / `.draft` | admin layer, live / draft |
| `appearance.tokens.theme` / `.theme.draft` | theme layer (the draft mirrors live) |
| `appearance.custom_css_light` | the admin's own CSS (the name is historical, see below) |
| `appearance.custom_css.theme` / `.theme.draft` | the theme's stylesheet |
| `appearance.custom_css_compiled` | both stylesheets, scoped and cached for serving |
| `appearance.theme.installed` | the manifest of the theme the site is wearing |
| `appearance.theme.rollback` | the one-step undo point (see [Undo](#undo)) |

Before we went to one look, many of these keys came in `.light` / `.dark` pairs. We still
**read the old keys as a fallback and delete them on the next write**, all through one
helper, `appearanceService.readStaged(key, legacyKey)`. Reading them is how existing
sites kept their look without a data migration. Deleting them stops a stale light value
from winning again for every token the new set doesn't have. `light` and `dark` are never
scope names, so if you see them at the top level of a stored value, you know it's the old
format.

`appearance.custom_css_light` keeps its misleading name because `appearance.custom_css`
is already taken by an even older version of the setting. Renaming it would mean a third
fallback, for nothing a user could notice.

---

## The stylesheet we serve

`GET /api/appearance/css` is public and gets hit a lot. `appearanceService.buildCSS()`
builds it from:

1. one block per scope (`global` first, so regions can override it), with `global` on
   **`:root, .xt-site-tokens`**;
2. the site font's rule, if one is set (see [Fonts](#fonts));
3. the compiled custom CSS, the theme's first and the admin's last.

We skip empty blocks. A site with no overrides gets an almost empty stylesheet and
renders with the bundled `tokens.scss`.

**Live updates.** Everything that writes to these settings bumps the style version.
Browsers follow it over `GET /api/appearance/stream` (SSE; `/version` is the polling
fallback) and refetch the stylesheet, so every open tab changes when a theme or a
published edit lands.

**`.xt-site-tokens`** brings the *site's* palette back inside something that opted out of
it. The ACP wraps the Layout Editor's variant probe in it, so the probe can measure what
the site would actually paint.

### How custom CSS is scoped

We scope the admin's CSS and the theme's CSS with postcss **when it's saved**, not on
every request:

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

The Style Editor font applies **to the whole site** (body and headings, `--ff-sans` and
`--font-display`). Users can override it on their profile. The ACP always uses Poppins
(`body.xt-acp` pins family, weight and size). A theme can ship its own font
(`@font-face` in `styles/custom.css`, the file in `assets/`) and point `--font-display` at
it with a token. Our Redline theme does exactly that with Oxanium.

---

## Themes on a site: install, switch, undo

A theme is **data**: layout documents, tokens, a stylesheet and images. There's no code,
so installing one can't run anything; plugins are where code goes. Installed themes live
in a **library** (`xcf_themes`, one row per theme, one of them active).

### Installing is not switching

| What you import | What happens |
|---|---|
| a **new** theme (any theme the site isn't wearing) | it's added to the library **inactive**, the site doesn't change, and we **ask** the admin |
| an **update** to the theme the site is wearing | it's applied right away, with the usual inheritance |
| an update to an **inactive** theme | its library entry is refreshed and it stays inactive |

The question comes from the **switch prompt** (`offerThemeSwitch` in
`features/admin/hooks/themeSwitchPrompt.tsx`). It shows the new theme's screenshot, its
light/dark look, and *"Switch to X" / "Keep Y"* (or *"Keep the default look"* on a site
without a theme). Every install path uses it: the upload on the Themes page, the
Marketplace grid, and the owned-licence rows. The import report tells you which case
happened through `activated` and `current`.

We ask because a site that changed its whole look when someone installed a theme to try
it out was answering a question nobody had asked. And it costs nothing: "Switch" is the
normal library activation.

### Switching is live

`POST /api/admin/themes/library/:id/activate` puts a theme on **live**: the theme layer,
the published layouts and their drafts all at once, plus a style-version bump. There's no
publish step.

- **A switch replaces the theme layer; it never merges.** If the new theme has no tokens
  or no stylesheet, the previous theme's are cleared, so its fonts and rules stop
  painting the site. (Until 2026-09-19 that wasn't the case: switching away from a theme
  with custom CSS left the CSS behind.)
- **Layouts work differently, on purpose.** A template the new theme doesn't ship keeps
  what the site had, and a template the admin customized is kept (see
  [Layers](#layers-theme-and-admin)).

### Undo

Every activation saves an undo point first, and `POST /api/admin/themes/discard` restores
exactly what it replaced (the layouts and both theme layers).

**It only goes back one step.** The next activation overwrites it, so after two switches
"undo" takes you back to the first, not the original. To go back further, activate the
old theme from the library.

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
- A reader wearing another theme gets it **as its author shipped it**, without the admin
  layer. The admin's overrides were picked for the site's theme and don't mean anything on
  another one.
- It's offered in the footer (`ThemeChooserBlock`) and in Account → Preferences. They're
  **the same choice**: same cookie, same strings (`themeChooser.*`), same reload, and the
  same rule that **with fewer than two installed themes, neither shows up**. If you change
  one, change both.
- Choosing the **site's own** theme **clears** the cookie instead of storing that theme's
  id. Otherwise the reader would stay on it after the admin switches.
- An installed theme is **offered to readers right away**, even if the admin kept their
  current one. We decided against a separate "offer to readers" setting.

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

- **No hardcoded visual values** in components. Always use a token. The Style Editor only
  edits semantic tokens.
- **Target blocks with `xt-b--<type>`** or your own `className` handle, not their inner
  classes. Never use `>`, `+` or `~` across a block boundary: every block sits in a
  `display: contents` wrapper, so the combinator quietly matches nothing.
- **Check the stylesheet we actually serve**, not the docs. `curl /api/appearance/css`
  tells you what visitors get.
- **A theme screenshot taken on a dev site includes that site's admin layer** on top of
  the theme. Neutralize the overridden tokens, or use a clean install.
- Anything that writes a theme layer, a stylesheet or a layout has to bump the style
  version, or open tabs keep the old look until they reload.
