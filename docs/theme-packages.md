# The `.xttheme` package format

This page describes the file format in detail. For how themes, tokens and layers behave
on a running site (installing vs switching, each theme's own edits, the stylesheet we
serve), read [`style-system.md`](style-system.md) first.

A **theme is data and a plugin is code**; [`plugin-blocks.md`](plugin-blocks.md) covers
the plugin side. Nothing in a `.xttheme` runs, which is why installing one doesn't need a
trust review: we validate it against a schema, and we skip unknown blocks instead of
running anything.

A package is a zip. Name it `.xttheme`, although nothing checks the extension.

```
manifest.json            required
tokens.json              all design tokens, by scope (the complete copy)
styles/tokens.css        the global tokens as :root custom properties
styles/custom.css        the theme's own stylesheet (optional)
frame.json               the site frame: boxed, floating, overlap… (optional; absent = full width)
layouts/<template>.json  one document per template
assets/                  images and fonts the documents use
```

## One look, one palette (package version 2)

**A site has one look, and a theme is that look.** There's no light/dark toggle and no
`prefers-color-scheme` anywhere in how a site renders. You decide whether you're building
a dark theme or a light one, say so in the manifest, and the site wears it. A reader who
wants the other kind picks a different theme from the footer.

So the paired files are gone. `tokens.json` is one scope map instead of
`{ light, dark }`, and each stylesheet is a single file:

| Before (package version 1) | Now |
|---|---|
| `tokens.json` → `{ light, dark }` | `tokens.json` → the scope map itself |
| `styles/light.css` + `styles/dark.css` | `styles/tokens.css` |
| `styles/custom-light.css` + `styles/custom-dark.css` | `styles/custom.css` |

**A version 1 package still installs.** The importer reads all the old names and keeps
the **light** half, because `:root` was always the light palette and it's what visitors
saw unless their OS asked for dark. We don't drop the dark half silently: the import
result lists it under `ignoredFiles`, and the ACP shows that. Nothing writes the old names
anymore.

## `.xtstyle` is the same format

A `.xtstyle` used to be a manifest plus a `:root`-only stylesheet: a theme without
`layouts/` or `assets/`. They were never really two formats, so since **2026-08-15 they're
one**. The theme importer takes a `.xtstyle` as it is, and the separate upload endpoint,
its own validator and its ACP page are gone. Two ways to import untrusted CSS was one too
many.

The only real difference was the manifest. A theme manifest needs `id`, `vendor`,
`version` and `minXentiumVersion`; a style pack only had `name`. We fill those in on
import (the `id` from the name, `vendor` as `community`), but **only for a package that's
clearly a style pack**: no `layouts/`, no `tokens.json`, and a stylesheet present. A real
theme with a broken manifest still gets a proper error instead of a made-up id.

To make one, export with **Colours only** (`tokensOnly`). That leaves out `layouts/`, and
with it `assets/`, since export only collects assets that layouts reference. You get a
`.xttheme` that changes nothing but the palette.

## manifest.json

```jsonc
{
  "id": "midnight",              // kebab-case; also the folder its assets unpack into
  "name": "Midnight",
  "version": "1.2.0",            // semver
  "vendor": "Someone",
  "minXentiumVersion": "1.0",     // refused on older versions
  "maxXentiumVersion": "2.0",     // optional
  "description": "…",            // optional, up to 500 characters

  "schemaVersion": 1,            // the layout schema you wrote against
  "packageVersion": 2,           // this package format; 2 = one look

  // Whether you built a DARK theme or a LIGHT one. It describes the theme; it's not
  // a mode the theme offers. Defaults to "light" if you leave it out.
  "appearance": "dark",

  // For a marketplace listing.
  "license": "MIT",              // optional
  "homepage": "https://…",       // optional
  "authorUrl": "https://…",      // optional
  "screenshot": "assets/preview.png",  // optional, relative to the package

  // Optional, up to 8. Named colour sets the admin can switch between in the Layout
  // Editor (Theme style tab). Each one is a handful of GLOBAL tokens.
  "colourways": [
    { "id": "toxin",  "name": "Toxin",  "tokens": { "--c-bg": "#090d0b", "--c-accent": "#3be38a", "--c-accent2": "#b07cff" } },
    { "id": "ember",  "name": "Ember",  "tokens": { "--c-bg": "#0e0909", "--c-accent": "#ff3d4a", "--c-accent2": "#3be38a" } }
  ]
}
```

`schemaVersion` is **informational, not enforced**. A document written for a newer block
catalogue still imports; blocks this install can't render are reported and left in
place.

`appearance` is **something you declare; we never guess it.** Measuring how bright
`--c-bg` is works until the palette is mid-grey, sepia or duotone, and a theme that only
sets its background in `styles/custom.css` has no background token at all. The
marketplace shows it on the listing card, and a wrong badge is worse than none, so a
package that leaves it out gets no badge.

### Colourways

A colourway is a shortcut, not a second palette. Picking one writes its tokens into the
admin's appearance draft for your theme, exactly as if they had been typed into the Style
Editor, and it publishes the same way. So:

- Give every colourway the **same set of tokens**. Picking Ember after Toxin only
  changes what Ember names; a token only Toxin set would stay behind.
- Make your `tokens.json` equal to the **first** colourway. That is what the theme wears
  before anyone picks, and it is how the editor knows to mark it as current.
- A value your package already ships is cleared rather than copied when the admin picks
  it, so a later update of your theme can still move it.

The tile in the editor is drawn from `--c-bg`, `--c-accent` and `--c-accent2`, so set
those three in each colourway.

## Tokens

`tokens.json` is the file to write. It's the full set of tokens by scope, and it's one
map because there's one look:

```jsonc
{
  "global":        { "--c-accent": "#5865f2" },
  "chrome.header": { "--c-bg": "#111827" }     // changed for one region only
}
```

`styles/tokens.css` can only hold `global`, so it's mostly there for `.xtstyle`
compatibility. **When both exist, `tokens.json` wins.** Token names have to look like
custom properties, and values can't contain `{ } < > ;`, since we write them into the
stylesheet we serve and a stray brace would close the block.

`styles/custom.css` is for anything tokens can't express. It isn't limited to `:root`;
the site scopes it when it's saved, exactly like the ACP's own custom CSS. Like the rest
of a theme, it applies **live** (see [Importing](#importing)).

## Layouts

One file per template, named after the template key:

```
layouts/home.json  article.index.json  article.detail.json  profile.json
       members.json  chrome.header.json  chrome.footer.json
```

Each file is a layout document, `{ templateKey, schemaVersion, regions: { … } }`, where
each region is a tree of blocks. Ship every template. A package that only carries the
ones you changed quietly inherits whatever the target site had for the rest.

**We don't export per-page layout variants, on purpose.** They're keyed by a page slug,
and slugs are a site's content, not a theme's. On another site they'd either match
nothing or take over a page with the same name that you never saw.

> "Variant" means two different things here. A **layout variant** is one instance of a
> template (the layout for one specific page) and it's a row in `xcf_layouts`. A **style
> variant** (below) is a named look a block opts into. They never show up in the same
> place: the first selects a layout, the second is a field on a block.

## Style variants

A block can name a **variant** (`surface`, `muted`, `accent`, `plain`), and your theme
says what that variant looks like. Both halves are in the package:

- the layout document puts `"variant": "accent"` on the block;
- `tokens.json` has a `variant.accent` scope, which the site emits as
  `:root .xt-v--accent`.

```jsonc
// layouts/home.json: the block picks a look
{ "id": "hero", "type": "section", "props": {}, "variant": "accent" }

// tokens.json: the theme says what that look is
{ "variant.accent": { "--surface-bg": "#efe7ff", "--surface-border": "#d9c9ff" } }
```

We deliberately don't do per-block colours. A variant keeps every block that uses it in
sync and survives a palette change, because a variant's *default* is written in palette
tokens (`--surface-bg: var(--c-card)`). It follows whatever site it lands on until a theme
overrides it.

Three things to know when you write one:

- **`section` is the block that paints.** It reads `--surface-bg`, `--surface-border`,
  `--surface-border-width`, `--surface-radius` and `--surface-shadow`, and none of those
  has a global value, so an unstyled section paints nothing. Card-style blocks (the
  profile card, a plugin panel) follow the same colours, because every variant points
  `--card-bg` and friends at the `--surface-*` values.
- **Variants cascade.** They're custom properties on a `display: contents` wrapper, so a
  card inside an `accent` section is accented too. Use `plain` to reset.
- **An unknown variant is refused on import**, unlike an unknown block. There's no class
  for it and no way to render the look it was meant to have, so it fails validation
  instead of silently doing nothing.

## CSS handles: `className` and linked images

A variant picks one of the named looks. It can't say "this one tile". For that, a block
can have an optional **`className`**: your own handle that custom CSS can select.

```jsonc
// layouts/chrome.header.json: a navbar made of images
{ "id": "t1", "type": "image", "className": "nav-tile",
  "props": { "source": "assets/forum.png", "ratio": "auto", "href": "/forum" } }
```

```css
/* styles/custom.css */
.nav-tile > *          { width: 120px; }
.nav-tile img          { border-radius: 8px; transition: filter .15s; }
.nav-tile:hover img    { filter: brightness(1.15); }
```

Three things shape how you write that CSS:

- **Style *through* the handle, not on it.** It sits on the same `display: contents`
  wrapper as the variant, so it has no box: `.nav-tile { background: … }` paints nothing,
  but `.nav-tile > *`, `.nav-tile img` and `.nav-tile .xt-image` all work. That's the
  price of the handle being safe on **every** block, including plugin blocks that never
  opted in, and of never breaking the flex and grid containers that size the real
  element. Descendant and `:hover` selectors work normally, because `:hover` matches an
  ancestor of the hovered element whether or not that ancestor has a box.
- **`xt-` is reserved.** A handle is 1 to 4 CSS identifiers (letters, digits, `-`, `_`)
  and can't start with `xt-`. That prefix is core's own set of classes, and a document
  that could create one could pretend to be a core class or give itself a variant.
- **`image.href` turns artwork into a link**, which is what an image navbar needs.
  `navLinks` renders text, so before this there was no way to say "this tile goes to
  /forum". Only relative paths and `http`, `https` and `mailto` are allowed; a
  `javascript:` or `data:` URL fails validation, so it can't come in through a package
  either. There's no `hoverSource` on purpose: swapping the image on hover is CSS the
  handle can already do, and every block prop is forever.

## Assets

An asset path in a document points into the site's uploads, which means nothing on
another machine. So export **copies the files into the package** and rewrites each path
to `assets/<file>`. Import unpacks them to `uploads/themes/<manifest id>/` and rewrites the
paths again.

- Images and fonts only, checked by their **magic bytes**, not their extension. SVG is the
  exception (it's XML), so we serve `/uploads/themes/` with `nosniff` and a sandboxing
  CSP: an SVG can't run anything even if you open it directly.
- File names are reduced to their base name, so an entry can't escape its folder.
- Limits: 100 files, 5 MB each, 40 MB in total.
- Absolute `http(s)` URLs are left alone, so a theme can point at a CDN.

## Importing

- **Installing isn't switching.** A new theme goes into the library inactive, and you're
  asked whether to switch to it. See
  [`style-system.md` → Themes on a site](style-system.md#themes-on-a-site-install-switch-update-undo).
- **Each theme keeps its own work.** Your edits to a theme's layouts, tokens, custom CSS,
  font and site frame belong to that theme. Switching only changes which theme visitors
  see, so it can't overwrite or leave behind anything from another theme. You can edit a
  theme before you switch to it.
- **The way back is the undo point:** `POST /admin/themes/discard` undoes the last switch
  (by switching back) or the last update (by restoring the old version and that theme's
  layouts). It only goes back **one step**; after that, activate the old theme from the
  library.
- **All or nothing:** we validate every layout, token, stylesheet and asset before we
  write a single byte, so one bad file leaves the site untouched.
- **Unknown blocks are kept.** We report them, the renderer skips them, and they come
  back as soon as the plugin that provides them is enabled.

## Updating a theme without losing your work

A theme's package is a **layer under** your changes to that theme, not something that
overwrites them. That's the difference between taking an update and having to choose
between the update and your customizations, which is the choice XenForo and WoltLab leave
you with.

**Tokens inherit one by one.** We serve what the theme ships with your overrides on top,
so if you recoloured one accent and the theme's version 1.1 changes twenty tokens, you get
the other nineteen and keep yours. In Theme Studio's Colours & type mode, a token you haven't touched shows
the theme's value, and **Reset** on a token you changed goes back to the theme's value,
not to stock Xentium. *Reset appearance* clears your overrides for that theme and leaves
the theme installed.

**Layouts inherit per template.** You can't sensibly merge block trees (a three-way merge
of moved blocks produces layouts nobody designed), so the unit is the whole template:

| Template | On update |
|---|---|
| You never changed it, or it's exactly what the old version shipped | **Follows** the new version |
| You changed it | **Kept**, and listed in the result |

We compare against the **old** version before replacing it. A template you never touched
has nothing stored at all: it renders whatever the theme currently ships, so it follows
every update on its own.

In Theme Studio's Layout mode, **Revert to theme** stages the theme's current version of a page as
a draft you can preview and publish, and **Reset** removes your layout so the page shows
what the theme ships.

The import result lists `templates` (the ones following the new version), `kept` (yours,
left alone) and `replaced` (the version you had before).

**The stylesheet is a layer too.** `styles/custom.css` is emitted **before** your own CSS
for that theme, so when two rules have equal specificity, yours wins. That's the same
relationship your tokens have with the theme's. *Reset appearance* clears your stylesheet
and leaves the theme's.

**The site frame** follows the template rule: a frame you never changed follows the
update, one you changed is kept.

## The class contract

A theme is CSS plus data. It can't register a block or change a component, so all of its
design control goes through class names. We promise three things, and they're not equally
strong, so it's worth knowing which is which.

**1. `xt-b--<type>` on every block.** It's always there, on every instance, for core
blocks, plugin blocks and blocks we add later:

```css
.xt-b--boardStats .stat-value { font-family: "Bebas Neue"; }
.xt-b--profileCard            { --card-radius: 0; }
```

This is the hook a *downloaded* theme relies on. `className` is per instance and only an
admin can set it, so a theme that doesn't control the site's layouts had nothing to aim
at, and about fifty blocks render into their parent's markup without a class of their
own. A plugin's dotted type is flattened for the selector: `forum.recentThreads` becomes
`.xt-b--forum-recentThreads`.

**2. Root classes** on the blocks that have their own root element:

| Block | Root class | | Block | Root class |
|---|---|---|---|---|
| `section` | `.xt-section` | | `image` | `.xt-image` |
| `columns` | `.xt-columns` | | `guestHero` | `.ghero` |
| `column` | `.xt-column` | | `guestBody` | `.gbody` |
| `spacer` | `.xt-spacer` | | `profileCard` | `.profile-card` |
| `heading` | `.xt-heading` | | `richText` | `.xt-richtext` |

**3. Everything else is how it works today, not a promise.** The classes inside a block
(`.ghero__title`, `.mp-list`, `.ac__excerpt`) are real and stable in practice, but no test
guards them yet, and the prefixes are inconsistent because several blocks were split out
of existing pages and kept those pages' names. Reach them through `xt-b--<type>` or your
own handle, so a rename can't ripple through your whole stylesheet.

> **Never use `>`, `+` or `~` against a block's root class from outside that block.** Every
> block renders inside a `display: contents` wrapper. It has no box, so it can't disturb a
> flex or grid parent, but selectors match the **DOM**, not the boxes, so a combinator
> across a block boundary silently matches nothing. Use a descendant selector. (We shipped
> `.xt-columns > .xt-column` in core once. It stopped applying to any column an admin had
> styled, and on phones a sticky rail stayed pinned over the content it should have
> stacked under.)

## What a theme's stylesheet may do

Your own custom CSS is written by you, so we only check the syntax. A stylesheet inside a
package is a stranger's code on every page of someone else's site, so it follows two
extra rules, both enforced on import before we write anything:

- **No `@import`.** It loads a stylesheet from another server on every page view. That's
  a live dependency on someone else's uptime, and a request that carries your visitors'
  IP addresses. Put the rules in the file.
- **No remote `url()`.** Same reasons, plus a worse one: combined with an attribute
  selector (`input[value^="a"] { background: url(…) }`), a remote URL can leak what's on
  the page, one character at a time. Put the file in `assets/` and reference it as
  `assets/<file>`.

What *is* allowed: `assets/…` references (we rewrite them on import to wherever the files
ended up, which is the only reason an image in a theme's stylesheet works at all),
`data:` URLs, and absolute paths on the same site like `/uploads/branding/logo.png`, which
can't reach anywhere else. A reference to a file that isn't in the package is refused by
name.

Export does the reverse: it copies the files your stylesheet references into the package
and makes the paths package-relative, so a `.xttheme` exported from a site that's running
a theme imports cleanly somewhere else.

This does **not** make a stranger's CSS harmless. CSS can still put a fixed-position
element over a button, or restyle a control into something it isn't. The protections
against that are the preview before you install (the marketplace renders a theme from its
package) and the undo point afterwards.

## Building one

The Themes page (**ACP → Appearance → Themes**) exports a theme as it's currently
**published**, assets included, and imports packages. There's no separate CLI:
a package is a zip, so you can also write one by hand in a text editor and pack it with
`zip -r`.

If you build one by hand, start your layouts from the built-in defaults (`DEFAULT_LAYOUTS`
in `@xentium/contracts`) and run them through `layoutDocumentSchema` and
`validateBlockTree` before you zip, so you find mistakes before the importer does. That's
how we built our Redline theme.
