# `.xttheme` — the theme package format

> Companion to ADR-0005. `docs/plugin-blocks.md` covers the other half of the split:
> a **theme is data, a plugin is code**. Nothing in a `.xttheme` executes, which is why
> installing one needs no trust review — it is validated against a schema, and an
> unknown block is skipped rather than run.

A package is a zip. Rename it `.xttheme`; nothing checks the extension.

```
manifest.json            required
tokens.json              full scope-keyed design tokens (the lossless copy)
styles/light.css         global tokens as `:root` custom properties
styles/dark.css
styles/custom-light.css  the theme's own stylesheet (optional)
styles/custom-dark.css
layouts/<template>.json  one document per template
assets/                  images and fonts the documents reference
```

## `.xtstyle` is this format now

A `.xtstyle` was a manifest plus a `:root`-only light/dark pair — a theme with no
`layouts/` and no `assets/`. The two were never really two formats, so as of
**2026-08-15 they are one**: the theme importer accepts a `.xtstyle` unchanged, and the
separate upload endpoint, its parallel validator and its ACP page are gone. Two
ingestion paths for untrusted CSS was one more than a site needs.

What differed was never the files but the paperwork: a theme manifest requires `id`,
`vendor`, `version` and `minXentiumVersion`; a style pack carried only `name`. Those are
filled in on import — `id` derived from the name, `vendor` defaulted to `community` —
and **only for a package that is unmistakably a style pack**: no `layouts/`, no
`tokens.json`, and a stylesheet present. A real theme with a malformed manifest still
gets the strict error it deserves rather than an invented id.

To produce one, export with **Colours only** (`tokensOnly`), which omits `layouts/` —
and therefore `assets/`, since the only assets an export collects are the ones layouts
reference. The result is a `.xttheme` that changes nothing but the palette.

## manifest.json

```jsonc
{
  "id": "midnight",              // kebab-case, and the directory assets unpack into
  "name": "Midnight",
  "version": "1.2.0",            // semver
  "vendor": "Someone",
  "minXentiumVersion": "1.0",     // refused below this
  "maxXentiumVersion": "2.0",     // optional
  "description": "…",            // optional, ≤500 chars

  "schemaVersion": 1,            // layout schema authored against
  "packageVersion": 1,           // this package format

  // Distribution metadata — what a marketplace listing needs.
  "license": "MIT",              // optional
  "homepage": "https://…",       // optional
  "authorUrl": "https://…",      // optional
  "screenshot": "assets/preview.png"   // optional, asset-relative
}
```

`schemaVersion` is **surfaced, not enforced**: a document written against a newer
catalogue still imports, and the blocks this install cannot render are reported and
left in place.

## Tokens

`tokens.json` is the one to write. It is the full scope-keyed set (ADR-0003):

```jsonc
{
  "light": {
    "global":        { "--c-accent": "#5865f2" },
    "chrome.header": { "--c-bg": "#111827" }     // re-scoped for one region only
  },
  "dark": { "global": { "--c-accent": "#818cf8" } }
}
```

The two `:root` stylesheets can only carry `global`, so they exist for `.xtstyle`
compatibility. **When both are present `tokens.json` wins.** Token names must look like
custom properties and values may not contain `{ } < > ;` — the values are emitted into a
served stylesheet, and a stray brace would close the block early.

`styles/custom-*.css` is the escape hatch for a look tokens cannot express. It is *not*
`:root`-restricted; the importing site scopes it at save time, exactly as the ACP's own
custom-CSS console does. ⚠ It is the one part of a theme that applies **live** rather
than to the draft — the console has no draft of its own — and the importer says so.

## Layouts

One file per template, named for the key it declares:

```
layouts/home.json  article.index  article.detail  page.detail
       profile.json  members.json  chrome.header.json  chrome.footer.json
```

Each file is a layout document: `{ templateKey, schemaVersion, regions: { … } }`, where
every region is a tree of blocks. Ship every template — a package that carries only the
ones it edited silently inherits whatever the target site had.

**Per-page layout variants are deliberately not exported.** One is keyed by a page slug,
and slugs are a site's content, not a theme's: carried elsewhere they would either miss,
or hijack a same-named page the author never saw.

> ⚠ Two different things are called a *variant*. A **layout variant** is one instance of a
> template — the layout for one specific page — and it keys a row in `xcf_layouts`. A
> **style variant** (below) is a named look a block opts into. They never appear in the
> same position: the first is part of a layout SELECTOR, the second a field on a BLOCK.

## Style variants

A block may name a **variant** — `surface`, `muted`, `accent`, `plain` — and the theme
says what that variant looks like. Both halves are in the package:

- the layout document carries `"variant": "accent"` on the block;
- `tokens.json` carries the `variant.accent` scope, emitted by the receiving site as
  `:root .xt-v--accent`.

```jsonc
// layouts/home.json — the block picks a look
{ "id": "hero", "type": "section", "props": {}, "variant": "accent" }

// tokens.json — the theme says what the look IS
{ "light": { "variant.accent": { "--surface-bg": "#efe7ff", "--surface-border": "#d9c9ff" } } }
```

This is deliberately not per-block colours. A variant keeps every block using it in step,
survives a palette change, and works in both themes — because a variant's *default* is
written in palette tokens (`--surface-bg: var(--c-card)`), so it follows the site it lands
on until a theme overrides it.

Three rules worth knowing when authoring:

- **`section` is the block that paints.** It reads `--surface-bg`, `--surface-border`,
  `--surface-border-width`, `--surface-radius`, `--surface-shadow`, none of which have a
  global definition — an unstyled section paints nothing. A card-painted block (the
  profile card, a plugin panel) follows the same colours, because every variant aliases
  `--card-bg` and friends to the `--surface-*` set.
- **Variants cascade.** They are custom properties on a `display: contents` wrapper, so a
  card inside an `accent` section is accented too. `plain` is the explicit reset.
- **An unknown variant is refused on import**, unlike an unknown block: there is no class
  for it and no way to render "the look it meant", so it fails validation rather than
  landing as a silent no-op.

## CSS handles — `className` and linked images

A variant covers "which named look", not "this one tile". For that a block carries an
optional **`className`**: your own handle, which custom CSS can select on.

```jsonc
// layouts/chrome.header.json — an image navbar
{ "id": "t1", "type": "image", "className": "nav-tile",
  "props": { "source": "assets/forum.png", "ratio": "auto", "href": "/forum" } }
```

```css
/* styles/custom-light.css */
.nav-tile > *          { width: 120px; }
.nav-tile img          { border-radius: 8px; transition: filter .15s; }
.nav-tile:hover img    { filter: brightness(1.15); }
```

Three things decide how you write that CSS:

- **Style *through* the handle, not on it.** It is stamped on the same
  `display: contents` wrapper the variant uses, so it generates no box:
  `.nav-tile { background: … }` paints nothing, while `.nav-tile > *`,
  `.nav-tile img` and `.nav-tile .xt-image` all work. This is the price of the handle
  being safe on **every** block — including a plugin's, which never had to opt in —
  and of never breaking the flex and grid parents that size the real element.
  Descendant and `:hover` selectors behave normally, because `:hover` matches an
  ancestor of the hovered box whether or not that ancestor generates one.
- **`xt-` is reserved.** A handle is 1–4 CSS identifiers, letters/digits/`-`/`_`, and
  may not begin with `xt-` — that prefix is core's own class contract, and a document
  that could mint one could impersonate a core class or hand itself a variant.
- **`image.href` makes artwork a link**, which is what an image navbar needs:
  `navLinks` renders text, so before this there was no way to say "this tile goes to
  /forum". Relative paths and `http`/`https`/`mailto` only — a `javascript:` or
  `data:` URL is refused at validation, so it cannot arrive in a package either.
  There is deliberately no `hoverSource`: a hover swap is CSS the handle already
  expresses, and every block prop is permanent.

## Assets

An asset reference inside a document is a path into the receiving site's uploads —
which means nothing on another machine. So export **copies the bytes into the package**
and rewrites the reference to `assets/<file>`; import unpacks them to
`uploads/themes/<manifest id>/` and rewrites it again to the new path.

- Images and fonts only, checked by **magic bytes**, not by extension. SVG is the one
  exception (it is XML), so `/uploads/themes/` is served with `nosniff` and a sandbox
  CSP: an SVG cannot execute even when opened directly.
- Names are flattened to a basename, so a traversing entry cannot escape.
- Limits: 100 files, 5 MB each, 40 MB total.
- An absolute `http(s)` URL is left alone — a theme may point at a CDN.

## Import semantics

- Lands in the **draft**, never live — layouts, tokens and the stylesheet alike. A theme
  rewrites every page at once, which is exactly the change to preview before committing.
  One "Publish appearance" promotes the staged theme, and the layout draft publishes as
  usual. (The stylesheet used to be the exception — applied live, and into the admin's own
  keys. See *Inheritance* below.)
- **All-or-nothing**: every layout, token, stylesheet and asset is validated before a
  single byte is written, so one bad file leaves the site untouched.
- **Unknown blocks are kept, not dropped.** They are reported to the admin, skipped by
  the renderer, and reappear the moment the plugin that provides them is enabled.

## Inheritance — updating a theme without losing your work

A theme is a **layer underneath** the admin's own changes, not a wholesale overwrite. This
is the difference between taking an update and having to choose between the update and
your customisations, which is the trade XenForo and WoltLab both leave you with.

**Tokens inherit per token.** An import writes the *theme layer*; the admin's edits live
in their own layer on top. The served stylesheet is theme ⊕ admin, so if you recoloured
one accent and the theme's 1.1 changes twenty tokens, you get the nineteen and keep yours.
In the Style Editor a token you have not touched shows the theme's value as *Inherited*,
and **Reset** on an overridden token falls back to the theme rather than to stock Xentium.
`Reset appearance` clears your overrides and leaves the theme installed.

**Layouts inherit per template.** A block tree cannot be merged sensibly — a three-way
merge of moved blocks produces layouts nobody designed — so the unit is the template, and
the rule is explicit:

| Template state | On import |
|---|---|
| Nothing stored, or identical to its baseline | **Updated** to the theme's version |
| Moved away from its baseline (you edited it) | **Kept**, and reported in the result |

The *baseline* is what the theme shipped last time, or the code default before any theme
was imported — so a layout you hand-built before installing your first theme also counts
as customised and is kept.

Every import records the new baseline either way, so:

- the next update compares against the version you actually received, and
- **Revert to theme** (per template, in the Layout Editor) can hand you the theme's
  current version of a page you had customised. It lands in the draft, like every other
  layout change. `Reset` is still separate and still means the *code* default.

The import result names all of it: `templates` (applied), `kept` (yours, untouched),
`replaced` (the version that was installed before).

**The stylesheet inherits as a layer.** `styles/custom-*.css` lands in the theme's own
layer and is emitted **before** the admin's console CSS, so on two rules of equal
specificity the admin still wins — the same relationship their tokens have with yours.
`Reset appearance` clears the admin's stylesheet and leaves the theme's in place.

> ⚠ Before 2026-08-29 an import called the admin's own `saveCustomCss`, so installing a
> theme **destroyed whatever CSS the admin had written** — no baseline, nothing to
> recover from, and applied live. A package carrying only `custom-light.css` blanked
> their dark stylesheet too, because both keys were always written together.

## The class contract

A theme is CSS plus data — it cannot register a block or change a component — so every bit
of design control it has runs through class names. Three things are promised, and it is
worth knowing which is which, because they are not equally strong.

**1. `xt-b--<type>` on every block.** Always present, on every instance, for core, plugin
and future blocks alike:

```css
.xt-b--boardStats .stat-value { font-family: "Bebas Neue"; }
.xt-b--profileCard            { --card-radius: 0; }
```

This is the hook a *downloaded* theme relies on. `className` is per instance and only an
admin can set it, so a theme that does not control the site's layouts had nothing to aim
at — and roughly fifty blocks render into their parent's markup and emit no class of their
own at all. A plugin's dotted type is flattened for the selector:
`forum.recentThreads` → `.xt-b--forum-recentThreads`.

**2. Root classes**, for the blocks that own a root element:

| Block | Root class | | Block | Root class |
|---|---|---|---|---|
| `section` | `.xt-section` | | `image` | `.xt-image` |
| `columns` | `.xt-columns` | | `guestHero` | `.ghero` |
| `column` | `.xt-column` | | `guestBody` | `.gbody` |
| `spacer` | `.xt-spacer` | | `profileCard` | `.profile-card` |
| `heading` | `.xt-heading` | | `richText` | `.xt-richtext` |

**3. Everything else is current behaviour, not a promise.** The classes inside a block
(`.ghero__title`, `.mp-list`, `.ac__excerpt`) are real and stable in practice, but they
are not yet covered by the guard, and the prefixes are inconsistent because several blocks
were decomposed out of existing pages and kept those pages' names. Target them through
`xt-b--<type>` or your own handle so a rename cannot reach across your whole stylesheet.

> ⚠ **Never use `>`, `+` or `~` against a block's root class from outside that block.**
> Every block is rendered inside a `display: contents` wrapper. It generates no box, so it
> cannot disturb a flex or grid parent — but selectors match the **DOM**, not the box
> tree, so a combinator aimed across a block boundary silently matches nothing. Use a
> descendant selector. (Core shipped `.xt-columns > .xt-column` and it stopped applying to
> any column an admin had styled, leaving a sticky rail pinned over the content it was
> meant to stack under on a phone.)

## What a theme's stylesheet may and may not do

Your own console CSS is written by you, so it is checked for syntax and otherwise left
alone. A stylesheet arriving inside a package is a stranger's code on every page of
someone else's site, so it has two extra rules — both enforced at import, before a single
byte is written:

- **No `@import`.** It fetches a stylesheet from another server at render time, which is
  both a live dependency on someone else's uptime and a request carrying your visitors'
  IPs. Put the rules in the file.
- **No remote `url()`.** Same reason, plus a sharper one: with an attribute selector
  (`input[value^="a"] { background: url(…) }`) a remote URL leaks what is on the page one
  character at a time. Ship the file in `assets/` and reference it as `assets/<file>`.

What *is* allowed: `assets/…` references (rewritten on import to wherever the files
landed — this is why an image in a theme's stylesheet works at all), `data:` URLs, and
site-absolute paths like `/uploads/branding/logo.png`, which are same-origin and cannot
reach off-site. A reference to a file the package does not carry is refused by name.

Export is the mirror: the files your stylesheet references are copied into the package and
the references rewritten package-relative, so a `.xttheme` exported from a site running a
theme imports cleanly somewhere else.

This does **not** make a stranger's CSS harmless — CSS can still lay a fixed-position
element over a button, or restyle a control into something it is not. The answer to that
is staging: the stylesheet now arrives in the draft with everything else, so an admin sees
the site before a visitor does.

## Building one

The Layout Editor (`ACP → Appearance → Layout Editor → Theme package`) exports what is
currently **published**, assets and all, and imports a package. There is no separate CLI
in v1 — a package is a zip, so hand-authoring is a text editor and `zip -r`.
