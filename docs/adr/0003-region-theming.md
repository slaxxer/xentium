# ADR 0003 — Region & component theming tokens (the `.nvtheme` foundation)

- **Status:** Proposed (pending sign-off before Phase 1)
- **Date:** 2026-06-14
- **Relates to:** §13 (Appearance / Style Editor), §24 (three-tier tokens, `.nvstyle`/`.nvtheme`),
  `apps/web/src/styles/tokens.scss`, `apps/api/src/modules/appearance`, `StyleEditorPage.tsx`
- **Prior art surveyed:** WoltLab Suite, XenForo, Invision Community, Discourse, WordPress `theme.json`

## Context

Today every surface (buttons, navbar, footer, content, cards, inputs) draws from one global
**semantic** palette (`--c-*`). One declaration styles everything — great for "change the accent,
the whole site follows," but nothing can be themed independently, and only *colour* is editable.
We want **per-region** *and* **per-component** theming, across **all visual facets** (fill, border,
radius, shadow — including per-side borders), as the foundation for future `.nvtheme` packs,
**without** losing the global cascade.

The major platforms converge on the same shape, which de-risks ours:

- **XenForo** — `palette → roles → component properties`; properties *reference* palette colours;
  property *types* go beyond colour (a "css" type bundles border/radius/etc).
- **Discourse** — small base scheme with computed shades; ships **core region vars**. Lesson: keep
  the editable base small, derive the rest.
- **WordPress `theme.json`** — declarative global `settings/styles` **plus per-block scoped
  overrides**, compiled to CSS custom properties.
- **WoltLab** — "area selection": click a region *in the live preview* → it lists that area's vars.
- **Invision v5** — named "theme settings" of typed values drive an easy-mode editor.

## Decision

### 1. Two axes, not one

- **Regions** = *where*: `navbar`, `content`, `footer`, `aside`.
- **Components** = *what*: `button`, `card`, `field`, `menu`.
- Plus the **semantic** palette as the shared base everything inherits from.

| Tier | Examples | Edited by | Stored |
|---|---|---|---|
| **Semantic** (base) | `--c-bg`, `--c-accent`, `--c-fg`, `--c-success` | global *Palette / Text / Feedback* | as today |
| **Region** (surfaces) | `--nav-bg`, `--footer-bg`, `--aside-bg` | per-region panels | sparse |
| **Component** | `--btn-bg`, `--card-bg`, `--input-bg`, `--menu-bg` | per-component panels | sparse |
| Layout slots (future) | `.nvtheme` template slots (§24 layer 3) | theme packs | v2 (template system) |

### 2. Naming convention (locked): `--<group>-<role>[-<side>][-<state>]`

Region groups: `nav`, `footer`, `content`, `aside`. Component groups: `btn`, `card`, `input`
(the `field` group), `menu`. Reserved: `modal`, `sidebar`, `acp`. Border **colour** is always
`--<g>-border-color` (never bare `--<g>-border`).

### 3. v1 token set — every token **defaults to** a semantic/base token

**Regions (surfaces):**

| Region | Tokens → default |
|---|---|
| Navbar | `--nav-bg`→`color-mix(--c-surface 88%)`, `--nav-fg`→`--c-fg`, `--nav-fg-muted`→`--c-fg-muted`, `--nav-border-color`→`--c-border`, `--nav-active`→`--c-accent`, `--nav-active-bg`→`--c-accent-soft` |
| Content | `--content-bg`→`--c-bg`, `--content-border-color`→`--c-border` |
| Footer | `--footer-bg`→`--c-surface`, `--footer-fg`→`--c-fg-muted`, `--footer-fg-subtle`→`--c-fg-subtle`, `--footer-border-color`→`--c-border`, `--footer-accent`→`--c-accent` |
| Aside | `--aside-bg`→`--c-card`, `--aside-border-color`→`--c-border` |

**Components (primary tokens; full facet set per §3b):**

| Component | Tokens → default |
|---|---|
| Button | `--btn-bg`→`--c-accent`, `--btn-fg`→`--c-on-accent`, `--btn-danger-bg`→`--c-danger`, `--btn-radius`→`--radius-sm` |
| Card | `--card-bg`→`--c-card`, `--card-border-color`→`--c-border`, `--card-radius`→`--radius-lg`, `--card-shadow`→`--shadow-card` |
| Field | `--input-bg`→`--c-bg`, `--input-border-color`→`--c-border`, `--input-fg`→`--c-fg`, `--input-radius`→`--radius-md`, `--input-border-focus`→`--c-accent` |
| Menu | `--menu-bg`→`--c-card`, `--menu-border-color`→`--c-border`, `--menu-item-hover-bg`→`--c-bg-hover`, `--menu-radius`→`--radius-md` |

Chips/badges and most hover/active states are **derived**, not separate knobs (Discourse lesson).

### 3b. Tokens are any CSS value — fill, border (per-side), radius, elevation

Tokens are not colour-only. Each surface exposes the full set of visual facets, each a token that
inherits from a base (Card shown; same shape for every component/region):

| Facet | Tokens |
|---|---|
| Fill | `--card-bg` |
| Border (uniform) | `--card-border-width`→`1px`, `--card-border-style`→`solid`, `--card-border-color`→`--c-border` |
| Border (per-side) | `--card-border-{top,right,bottom,left}-width`→`var(--card-border-width)`, `…-color`→`var(--card-border-color)` |
| Radius | `--card-radius`→`--radius-lg` |
| Elevation | `--card-shadow`→`var(--shadow-card)` (or `none`) |

**Per-side uses the same inheritance trick** — each side token defaults to the uniform token — so a
one-sided accent bar (e.g. a 3px left border) is just overriding `--card-border-left-width` +
`--card-border-left-color`. Sparse, no new mechanism. Component CSS reads the long-hand:

```css
.card {
  background: var(--card-bg);
  border-style: var(--card-border-style);
  border-color: var(--card-border-color);
  border-top-width: var(--card-border-top-width);   /* + right / bottom / left */
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
}
```

The **editor never shows 12 rows**: the registry tags each token with a `control` group so the UI
composes **structured controls** — a **Border** control (width · style · colour + "Per-side ▾"
expander), a **Shadow** control (preset *none/soft/medium/strong* + *Custom*), a **Radius** slider.
Per-corner radius and per-side border-*style* are deferred (follow-ups).

### 4. Inheritance = **sparse storage** (the load-bearing rule)

In `tokens.scss` every region/component token is `var(--base)`. Inheritance only holds if a token is
**absent from the saved map unless explicitly overridden**:

- Touch only the global Palette → nothing else emitted → everything resolves through `var(--c-…)`.
  **One source cascades.**
- Override `--card-shadow` → only that key written → only card elevation changes.

Folds in prior work: `--btn-bg` moves into this model (removed from persisted defaults → tracks
`--c-accent` until overridden; fixes the "buttons stop tracking accent after a save" caveat).

### 5. Per-region component overrides — via **CSS variable inheritance**, no token explosion

The reach ("buttons in the navbar differ from content") is **v1** and costs **zero** new token
names — CSS custom properties inherit down the DOM, so a region re-sets a *component* token on its
own root element:

```css
.btn-primary { background: var(--btn-bg); }   /* component reads the token */
.pub-nav     { --btn-bg: #ffffff; }           /* navbar re-scopes it → only buttons inside the nav */
```

The only thing that gains a dimension is **storage** — every override is a `(scope, token)` pair,
scope ∈ `global` + region ids:

```jsonc
appearance.tokens.light = {
  "global": { "--c-accent": "#5865f2", "--btn-bg": "#5865f2", "--nav-bg": "#0b0d1a" },
  "navbar": { "--btn-bg": "#ffffff", "--btn-fg": "#0b0d1a" }   // buttons in the navbar only
}
```

- Region-**surface** tokens (`--nav-bg`) live in `global` (one consumer, no scoping).
- Region buckets hold only **component** overrides scoped to that region.
- `buildCSS` emits `:root { …global… }` then `<region selector> { …bucket… }`.
- Scope→selector map (registry-owned): `navbar`→`.pub-nav`, `footer`→`.site-footer`,
  `content`→`.app-content`, `aside`→`.app-rail`. *Phase-1 groundwork: confirm/add stable classes
  for footer/content/aside.*

### 6. A single **token registry** is the source of truth

New typed registry in `@nodevo/contracts` (today the truth is smeared across `tokens.scss`,
`HEARTH_DEFAULT_TOKENS`, and the editor `REGIONS` — they have drifted before):

```ts
interface TokenDef {
  var: string; label: string;
  type: "color" | "length" | "shadow" | "keyword";   // value kind — NOT colour-only
  kind: "semantic" | "region" | "component" | "shape";
  group: "global" | "navbar" | "content" | "footer" | "aside"   // regions / palette
       | "button" | "card" | "field" | "menu";                   // components
  control?: "border" | "shadow" | "radius";   // groups tokens into one compound editor control
  side?: "top" | "right" | "bottom" | "left"; // per-side facet
  inheritsFrom?: string;                       // "--c-accent" — seeds inherit↔override + derivation
  scopeable?: boolean;                         // component token overridable per region
  state?: "hover" | "active" | "focus" | "disabled";
  editable: boolean;
}
export const TOKEN_REGISTRY: TokenDef[] = [ /* … */ ];
```

The editor builds panels/controls from it; the API validates saved / `.nvtheme` keys ⊆ registry;
the `.nvtheme` loader reads it. `tokens.scss` remains the rendering default.

### 7. `.nvtheme` manifest — modeled on `theme.json` (global + per-scope)

Declarative token document, nested by scope (global + per-region), light/dark, validated against the
registry, compiled to the **same CSS vars the editor writes**. One contract.

```jsonc
{
  "type": "theme",
  "tokens": {
    "light": { "global": { "--c-accent": "#5865f2", "--card-shadow": "none" },
               "navbar": { "--btn-bg": "#0b0d1a" } },
    "dark":  { /* … */ }
  },
  "capabilities": { "lockNavbar": false, "allowPaletteEdits": true }   // reserved, not enforced v1
}
```

Component/layout *slots* (§24 layer 2/3) remain orthogonal and arrive with the **v2 template
system** — region/component tokens do not block them.

### 8. Selecting what to edit — section list ⇄ live preview (two-way; **list is the backbone**)

Neither approach suffices alone, so we do **both, bidirectionally**:

- **Section list = backbone / completeness.** Grouped by the two axes: *Palette · Text · Feedback* |
  *Navbar · Content · Footer · Aside* | *Button · Card · Field · Menu* | *Branding · Custom CSS*. It
  lists **every** token of a group — including facets and **states/off-screen elements you can't
  click** (hover, disabled, the staff-only admin tab, empty states).
- **Specimen iframe = fast spatial selector.** `/__theme-preview` (real `PubNav` + curated
  deterministic content + real `SiteFooter`), capture-phase click-suppressed so it never navigates
  (this is also how the "iframe = live session" caveat is fixed).
- **Click an element → opens its group's panel AND resolves scope:** the element's `data-region`
  ancestry means clicking a button *in the navbar* preselects *Button · scope: Navbar* (toggle to
  *All buttons*). The click is how we disambiguate scope.
- **Select a section → the iframe outlines/scrolls** to a representative element (`data-group`).
- **"Preview state" toggle** (base / hover / focus / disabled) forces the state on the representative
  element so you can edit states you could never hover-click.

Why neither alone: preview-only can't reach states / off-screen elements and can't disambiguate
scope; list-only has poor discovery and unnatural spatial intent.

Build list-first: **3a** = grouped list + scope picker + structured controls (fully usable on its
own); **3b** = click-to-select + state preview layered on top.

## Contract / schema impact

- **No DB migration.** `appearance.tokens.{light,dark}` changes from a flat `TokenMap` to a
  scope-keyed `Record<scope, TokenMap>`; the old flat value is read as the `global` bucket
  (back-compat shim in `buildCSS` / editor load). `tokens.scss` change is additive (every new token
  defaults to current values → **zero visual change**). Registry is new code.
- `validateStylePackCss` already enforces `:root`-only for `.nvstyle`; `.nvtheme` adds a registry
  allowlist + the per-scope blocks.

## Consequences

- Industry-aligned: palette edits cascade by default; per-region/-component is opt-in.
- Full visual control (fill / border / per-side / radius / shadow) — not colour-only — with the UI
  kept compact via structured controls.
- Per-region component reach is **free** (CSS var inheritance) — no `--region-component-*` sprawl.
- `.nvtheme` = a sparse, scope-keyed token map validated by one registry — no second format.
- `--btn-bg` un-pinned (tracks accent until overridden).
- Overriding a `color-mix` default (e.g. `--nav-bg`) flattens its translucency — accepted v1.
- Real work: scope-aware storage/`buildCSS`/preview + the editor's sparse "inherit" state +
  structured (border/shadow) controls.

## Open follow-ups (not blocking)

- **Per-corner radius** and **per-side border-style** (v1 does per-side *width*+*colour*).
- XenForo-style light/dark **mixing** + IPS-style **"derive a scheme from one accent"** (HSL);
  `registry.inheritsFrom` anticipates it.
- Discourse-style **computed shade tokens** (`--c-accent-low/-high`).
- Enforce `.nvtheme` **capability flags**; promote **ACP chrome** to a region; alpha controls.
- v2 **template system** = the `.nvtheme` component/layout *slots* (§24 layer 2/3).

## Phased delivery

1. **Registry + region/component tokens in `tokens.scss` + SCSS rewire** (nav/footer/content/aside,
   card/field/menu incl. border/shadow long-hands) + stable region root classes + **scope-aware
   `buildCSS`** (back-compat shim). No visual change; independently mergeable.
2. **`/__theme-preview` specimen route** — deterministic content, click-suppressed,
   `data-region`/`data-component`/`data-group`.
3. **Editor: registry-driven region + component panels, structured controls (border/shadow/radius),
   inherit↔override, scope picker, two-way click-to-select + state preview**; fold `--btn-bg` into
   the inherit model. (3a list-first, 3b preview layer.)
