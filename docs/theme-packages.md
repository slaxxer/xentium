# `.nvtheme` — the theme package format

> Companion to ADR-0005. `docs/plugin-blocks.md` covers the other half of the split:
> a **theme is data, a plugin is code**. Nothing in a `.nvtheme` executes, which is why
> installing one needs no trust review — it is validated against a schema, and an
> unknown block is skipped rather than run.

A package is a zip. Rename it `.nvtheme`; nothing checks the extension.

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

## `.nvstyle` is this format now

A `.nvstyle` was a manifest plus a `:root`-only light/dark pair — a theme with no
`layouts/` and no `assets/`. The two were never really two formats, so as of
**2026-08-15 they are one**: the theme importer accepts a `.nvstyle` unchanged, and the
separate upload endpoint, its parallel validator and its ACP page are gone. Two
ingestion paths for untrusted CSS was one more than a site needs.

What differed was never the files but the paperwork: a theme manifest requires `id`,
`vendor`, `version` and `minNodevoVersion`; a style pack carried only `name`. Those are
filled in on import — `id` derived from the name, `vendor` defaulted to `community` —
and **only for a package that is unmistakably a style pack**: no `layouts/`, no
`tokens.json`, and a stylesheet present. A real theme with a malformed manifest still
gets the strict error it deserves rather than an invented id.

To produce one, export with **Colours only** (`tokensOnly`), which omits `layouts/` —
and therefore `assets/`, since the only assets an export collects are the ones layouts
reference. The result is a `.nvtheme` that changes nothing but the palette.

## manifest.json

```jsonc
{
  "id": "midnight",              // kebab-case, and the directory assets unpack into
  "name": "Midnight",
  "version": "1.2.0",            // semver
  "vendor": "Someone",
  "minNodevoVersion": "1.0",     // refused below this
  "maxNodevoVersion": "2.0",     // optional
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

The two `:root` stylesheets can only carry `global`, so they exist for `.nvstyle`
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
> template — the layout for one specific page — and it keys a row in `ncf_layouts`. A
> **style variant** (below) is a named look a block opts into. They never appear in the
> same position: the first is part of a layout SELECTOR, the second a field on a BLOCK.

## Style variants

A block may name a **variant** — `surface`, `muted`, `accent`, `plain` — and the theme
says what that variant looks like. Both halves are in the package:

- the layout document carries `"variant": "accent"` on the block;
- `tokens.json` carries the `variant.accent` scope, emitted by the receiving site as
  `:root .nv-v--accent`.

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

- Lands in the **draft**, never live — layouts and tokens both. A theme rewrites every
  page at once, which is exactly the change to preview before committing. (Custom CSS is
  the exception above.) One "Publish appearance" promotes the staged theme, and the layout
  draft publishes as usual.
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
and **Reset** on an overridden token falls back to the theme rather than to stock Nodevo.
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

## Building one

The Layout Editor (`ACP → Appearance → Layout Editor → Theme package`) exports what is
currently **published**, assets and all, and imports a package. There is no separate CLI
in v1 — a package is a zip, so hand-authoring is a text editor and `zip -r`.
