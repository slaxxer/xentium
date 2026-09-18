# The style system — a developer guide

How a Xentium site gets its look: tokens, layers, themes, the served stylesheet, and the
rules that keep them honest. Written for people changing core or building plugins and
themes.

| Also read | For |
|---|---|
| [`theme-packages.md`](theme-packages.md) | the `.xttheme` file format, byte by byte |
| [`plugin-blocks.md`](plugin-blocks.md) | registering blocks a layout can place |
| `d0cs/adr/0003`, `0005` (private) | region theming and block layouts — the *why* |

---

## 1. One look, one palette

**A site has ONE look, and it is the active theme's.** There is no light/dark toggle, no
`prefers-color-scheme` and no `[data-theme]` selector anywhere in what the site serves. A
theme author builds a dark theme *or* a light one and declares which
(`manifest.appearance`). A reader who wants a different look picks a different **theme**
(§6), not a mode.

Why: a visitor's OS used to override the theme author. A theme designed dark would be
served as its light half, which the author may never have tuned, and a theme that
shipped no dark tokens fell back to stock Xentium entirely. The listing showed one
thing and the site rendered another.

**The ACP and ModCP are the exception.** They are tools, not part of anyone's design:
they re-declare the whole palette on `body.xt-acp` and keep their own light/dark switch.
`useTheme` (`apps/web/src/hooks/useTheme.ts`) still writes `data-theme` on the root, and
only the admin panels read it.

---

## 2. Tokens

Components never use a raw colour. Everything reads a custom property, in three tiers
(`apps/web/src/styles/_tokenDefaults.scss`, emitted by `tokens.scss`):

| Tier | Example | Who edits it |
|---|---|---|
| 1 · primitives | `--primitive-blurple-600` | nobody — never referenced by components |
| 2 · semantic | `--c-bg`, `--c-accent`, `--c-fg-muted` | Style Editor, themes |
| 3 · component | `--card-bg`, `--nav-bg`, `--btn-radius` | themes; default to a tier-2 token |

Tier-3 tokens default to tier-2 ones (`--card-bg: var(--c-card)`), so recolouring the
palette moves every component with it. Overriding a component token breaks that link
for that one component, on purpose.

`HEARTH_DEFAULT_TOKENS` (`@xentium/contracts`) mirrors the **editable** subset of
`tokens.scss` so the API and the Style Editor agree on defaults. `tokens.scss` is still
the rendering source of truth; when an editable default changes there, change it here.

### Scopes

Tokens are stored **scope-keyed** (ADR-0003):

```jsonc
{
  "global":         { "--c-accent": "#e22b2b" },   // → :root, .xt-site-tokens
  "footer":         { "--c-bg": "#0e0e12" },       // → .xt-foot  (SCOPE_SELECTOR)
  "variant.accent": { "--surface-bg": "…" }        // → :root .xt-v--accent
}
```

`SCOPE_SELECTOR` in `packages/contracts/src/tokens.ts` maps each scope to its selector.
A token set in a region scope cascades only inside that region.

### Validation

Every token value is written **verbatim** into a served stylesheet, so it is validated
at the door by `tokenMapSchema`: names must be `--custom-properties`, and values may not
contain `{ } < > ;`, since a stray brace would close the block. The same schema guards the
Style Editor, the Layout Editor's variant panel, a `.xttheme` import and the
marketplace's preview renderer. Never write a second copy of it.

### Style variants

A block may carry `variant: surface | muted | accent | plain`. A variant is a named
**token bucket** rather than per-block colours. Its defaults live in `tokens.scss` in
palette terms, and a theme overrides them through the `variant.<name>` scope. `section`
is the block that paints (`--surface-*`); every variant aliases `--card-bg` & co. to the
same set, so one token moves both a section and a card. See `theme-packages.md` →
*Style variants*.

---

## 3. Layers — theme ⊕ admin

The served palette is two layers, merged **per token**:

```
theme layer   appearance.tokens.theme     what the installed theme shipped
admin layer   appearance.tokens           what the admin changed in the Style Editor
────────────
served        getEffectiveTokens() = theme ⊕ admin   (admin wins, token by token)
```

This is what makes a theme update non-destructive: if the admin recoloured one accent
and the theme's next version changes twenty tokens, they get the other nineteen and keep
theirs.

- `GET /api/appearance/tokens` returns `{ tokens, theme, installedTheme }` with the
  layers **separate**. Merging them there would make the editor write theme values back
  as admin overrides and destroy the inheritance.
- **Reset** on a token falls back to the theme's value, not stock Xentium. *Reset
  appearance* clears the admin layer and keeps the theme.
- The same two-layer model applies to **custom CSS**: the theme's stylesheet
  (`appearance.custom_css.theme`) is emitted before the admin's console CSS, so the admin
  wins on equal specificity.
- **Layouts** inherit per *template*, not per block. A template the admin moved away
  from its theme baseline is kept on update. See `theme-packages.md` → *Inheritance*.

### Draft → publish (Style Editor edits only)

The admin layer has a draft: Style Editor edits stage in `appearance.tokens.draft` and go
live on **Publish** (now or scheduled via the `appearance-publish` job). The editor
previews `theme.draft ⊕ admin.draft` through `GET /api/appearance/css?source=draft`.

⚠ **Themes do not use draft→publish.** Putting a theme on is one decision, not a batch of
edits; see §5.

### Storage keys

| Key | Holds |
|---|---|
| `appearance.tokens` / `.draft` | admin layer, live / staged |
| `appearance.tokens.theme` / `.theme.draft` | theme layer (the draft mirrors live) |
| `appearance.custom_css_light` | admin console CSS — ⚠ the name is historical (see below) |
| `appearance.custom_css.theme` / `.theme.draft` | theme stylesheet |
| `appearance.custom_css_compiled` | both stylesheets, scoped, cached for the hot path |
| `appearance.theme.installed` | the worn theme's manifest |
| `appearance.theme.rollback` | the one-level undo point (§5) |

**Pre-collapse keys** (`…​.light`, `…​.dark`) are **read as a fallback and deleted on the
next write**, through one helper, `appearanceService.readStaged(key, legacyKey)`. Reading
them is what let existing sites keep their look with no data migration. Deleting them
stops a stale light half from winning again for every token the new set leaves absent.
`light`/`dark` are never scope names, so their presence at the top level of a stored
value is the unambiguous marker of the old shape.

`appearance.custom_css_light` keeps its misleading name because `appearance.custom_css`
is already taken by an older generation of the setting. Renaming it would need a third
fallback for nothing a user can see.

---

## 4. The served stylesheet

`GET /api/appearance/css` is public, sits on the hot path, and is built by
`appearanceService.buildCSS()`:

1. one block per scope (`global` first, so regions can override it), `global` emitted
   on **`:root, .xt-site-tokens`**;
2. the site font's rule, if one is set (see *Fonts*);
3. the compiled custom CSS, theme first and admin last.

Empty blocks are not emitted: a site with no overrides serves almost nothing and
renders the bundled `tokens.scss`.

**Live sync.** Every writer bumps the style version. Clients follow it over
`GET /api/appearance/stream` (SSE; `/version` is the polling fallback) and refetch the
sheet, so every open tab changes when a theme or a published edit lands.

**`.xt-site-tokens`** restores the *site's* palette inside a surface that opts out of it.
The ACP wraps the Layout Editor's variant probe in it so it can measure what the site
would paint.

### Custom CSS scoping

Console and theme CSS are scoped by postcss **at save time**, not per request:

- every rule is anchored under **`body:not(.xt-acp)`**, so site CSS never reaches the
  admin panel;
- `:root` / `html` rules stay document-wide (a root rule cannot be qualified by a class
  on its child), which is how a stylesheet sets tokens or `color-scheme: dark`;
- `@keyframes` steps and nested rules are left as authored.

A **theme's** stylesheet has two extra rules, enforced at import: no `@import`, and no
remote `url()`. It may reference its own `assets/…` (rewritten to wherever they land),
`data:` URLs and site-absolute paths.

### Fonts

The Style Editor font is **site-wide** (body and headings, `--ff-sans` + `--font-display`).
A user may override it per profile. The ACP is always Poppins (`body.xt-acp` pins
family, weight and size). A theme can ship its own face (`@font-face` in
`styles/custom.css`, file in `assets/`) and point `--font-display` at it through a token.
Redline does exactly this with Oxanium.

---

## 5. Themes on a site — install, switch, undo

A theme is **data**: layout documents, tokens, a stylesheet and images, with no code, so
installing one cannot run anything. Plugins are the code half. Themes are installed
into a **library** (`xcf_themes`, one row per id, one row active).

### Installing is not switching

| What is imported | What happens |
|---|---|
| a **new** theme (any id the site is not wearing) | added to the library **inactive**; the site is untouched; the admin is **asked** |
| an **update** to the theme being worn (same id) | applied immediately, with the usual inheritance rules |
| an update to an **inactive** theme | its library row is refreshed, still inactive |

The question is the **switch prompt** (`features/admin/hooks/themeSwitchPrompt.tsx`,
`offerThemeSwitch`): the new theme's screenshot, its declared look, and *"Switch to X" /
"Keep Y"* (or *"Keep the default look"* on a stock site). Every install path uses it:
the Themes page upload, the Marketplace grid and the owned-licence rows. The import
report says which case happened with `activated` and `current`.

Why ask: a site that changed its whole look because somebody installed a theme to try it
was answering a question nobody had asked. It also costs nothing: "Switch" is the
ordinary library activation.

### Switching is live

`POST /api/admin/themes/library/:id/activate` applies a theme **live**: the theme layer,
the published layouts and their drafts together, plus a style-version bump. There is no
publish step.

- **A switch REPLACES the theme layer, never merges it.** A theme with no tokens or no
  stylesheet clears the previous theme's, so its fonts and rules stop painting the
  site. (Before 2026-09-19 they did not; a switch away from a theme with custom CSS left
  that CSS behind.)
- **Layouts differ on purpose:** a template the new theme does not ship keeps whatever
  the site had, and a template the admin customised is kept (§3).

### Undo

Every activation records an undo point first; `POST /api/admin/themes/discard` restores
exactly what it replaced (layouts and both theme layers).

⚠ **It is ONE level deep.** The next activation overwrites it, so "undo" after two
switches returns to the first, not to the original. The way back further is the
library: activate the old theme.

---

## 6. Readers choosing a theme

A reader may wear any **installed** theme instead of the site's own. It is their choice
alone and changes nothing on the server.

- Stored in the `xt_theme` cookie (`apps/web/src/lib/viewerTheme.ts`) — not
  `localStorage`, because both the layout and stylesheet fetches need it before first
  paint, and guests must have it too.
- Sent as `?theme=<id>` to `/api/appearance/css` and `/api/layouts`; the API validates it
  against the library, and an id naming nothing falls back to the site's own.
- A reader wearing another theme gets it **as its author shipped it**, with no admin
  layer. The admin's overrides were chosen against the site's theme and mean nothing on
  another one.
- Offered in the footer (`ThemeChooserBlock`) and Account → Preferences. They are **one
  decision**: same cookie, same strings (`themeChooser.*`), same reload, same rule that
  **below two installed themes, neither renders**. Change one, change both.
- ⚠ Choosing the **site's own** theme **clears** the cookie instead of storing its id, or
  the reader would stay pinned to it after the admin switches.
- Installing a theme **offers it to readers immediately**, even if the admin kept their
  current one. There is no separate "offered to readers" flag, by decision.

---

## 7. The marketplace side

- A listing's **light/dark badge** is `mkt_products.appearance`, read from the package's
  `manifest.appearance` at ingest. It is **declared, never inferred**: luminance off
  `--c-bg` breaks on mid-grey, sepia and duotone palettes. A package that does not say
  gets no badge.
- **The preview** (`catalog/themePreview.ts`) renders one page per template **at ingest**,
  from the package's own layouts and `global` tokens over the base palette, which is how
  the CMS serves it. It reads both package shapes (a v1 `{ light, dark }` file keeps its
  light half, as the CMS importer does) and goes through the CMS's own `tokenMapSchema`.
  Because previews are rendered at ingest, **a renderer fix only reaches a listing when
  its release is re-ingested.**
- First-party themes are stocked with `scripts/ingest-official.ts`, which accepts
  `.xttheme` alongside `.xtplugin`.

---

## 8. Rules of thumb

- **No hardcoded visual values** in components; always a token. The Style Editor edits
  semantic tokens only.
- **Target blocks through `xt-b--<type>`** or your own `className` handle, not their inner
  classes. Never use `>`, `+` or `~` across a block boundary: every block sits in a
  `display: contents` wrapper, so the combinator silently matches nothing.
- **Verify against the served sheet**, not the docs:
  `curl /api/appearance/css` is the truth about what visitors get.
- **A theme screenshot taken on a dev site shows that site's admin layer** on top of the
  theme. Neutralise the overridden tokens, or use a clean instance.
- Anything that writes a theme layer, a stylesheet or a layout must bump the style
  version, or open tabs keep the old look until a reload.
