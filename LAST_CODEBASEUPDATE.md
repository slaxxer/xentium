**The editor.** Clicking a block opens the document that owns it. `data-nv-template`
travels on every wrapper, so a click on the masthead band, the navbar or the
who's-online panel switches the editor to that template with the block selected —
which is how the header and footer are arranged from the page you are looking at. The
preview stays on the page you were on (`previewPageKey`); chrome renders on every
route, so opening the header must not move you.
- ⚠ ONE document at a time, named in the picker. Each has its own draft and its own
  publish; two behind one Publish button would make the button lie.
- ⚠ Dragging (`data-nv-drag`) and empty-region drop targets stay with the OPEN
  document, because both rewrite the tree the editor is holding.
- Page bands are "Above body" / "Below body", named by where they are, since what they
  are not is the header.

# Last codebase update — 2026-08-30 (session 2)

Theme-marketplace **step 5, parts 1–8** + a layout-editor pass and a header block: paid themes end to end, a theme's dependency
footprint published with its listing, the marketplace rendering the theme itself so a
buyer can see it before paying, the INSTANCE rendering a theme over the admin's own
site and content — reversibly — and, finally, a theme that goes LIVE when it is
applied instead of waiting in two different drafts — which uncovered a stale-CSS bug
that had been keeping the site on the previous theme — and one that had been letting
the site repaint the ADMIN PANEL. Spans BOTH repos.
Everything below is verified in a running browser, not only under test.

`pnpm backbone:check` green (typecheck 30/30, lint 0, API **294**, web **598**, build clean);
marketplace **178** tests green.

---

## Part 1 — Paid themes (`~/Development/nodevo`)

### `apps/api/src/core/license-engine/marketplace-source.ts`
- `marketplace.paid_theme_ids` — a SECOND key and a SECOND catalogue walk, never a
  widening of `paid_plugin_ids`. That set feeds the plugin enable gate, which asks
  "is this id paid?" and cannot tell a theme id from a plugin id.
- The walk is now `refreshPaidIds(kind)`, with `kind` selecting both the half walked
  and the key written from one map, so the two can never be chosen separately.
  `refreshPaidPluginIds` / `refreshPaidThemeIds` / `ensurePaidIdsFresh(kind)`.

### `apps/api/src/core/license-engine/license-engine.ts`
- Entitlement grants are `<kind>.<id>`; `getEntitlementStatus(id, kind)` and
  `isEntitled(id, kind)` now honour that. `plugin.` was hardcoded, so an owned THEME
  matched nothing and read as `missing`.
- `themeRequiresLicense(id)` beside `pluginRequiresLicense(id)`, sharing only the lookup.
- `assertThemeDownloadAllowed(themeId)` — the theme download PRE-CHECK, and only that.
  The marketplace remains the authority; this replaces its deliberately vague 404 with
  a sentence naming the theme and where to buy it.
  ⚠ It may only ADD a refusal the real gate would also make. Two consequences:
  a `never` freshness proceeds (no information), and the stored entitlement is a fast
  YES but never a NO — a grant only exists if activation found a SEAT, and
  `/downloads/authorize` does not look at seats at all. Refusing on a missing grant
  would have blocked a paying customer whose seats are spent on other installs.

### `apps/api/src/modules/admin/marketplace.service.ts`
- `installThemeFromMarketplace` runs the pre-check before the round trip.
- **`listOwned` knows about the installed theme.** It resolved `installedVersion` from
  `installedPlugin`, a table a theme id has never been in, so every owned theme came
  back `null`: permanently "Inactive", never offering an update, whatever the site wore.
  Now read from `appearance.theme.installed` — and ONLY for the theme actually worn,
  since a site wears one. `installedStatus` stays null: a theme has no enabled state.

### `apps/api/src/jobs/updateCheck.ts`
- The heartbeat refreshes both paid-id sets.

### `apps/web/.../MarketplacePage.tsx`, `OwnedLicenses.tsx`
- `entitlements.includes(\`plugin.${p.id}\`)` → `\`${p.kind}.${p.id}\`` (an owned theme
  offered "Buy" whenever the catalogue did not answer `owned`).
- The owned-licence row passes `kind` on install — without it a theme ran the PLUGIN
  intake over a `.nvtheme`. Its action ladder no longer swallows install for themes,
  and theme queries are invalidated after one.

### Marketplace repo
- `src/modules/commerce/theme-purchase.e2e.test.ts` — order → licence → activation →
  `theme.<id>` grant → authorized download, plus the seat and refund cases. The stack
  was already kind-agnostic; "the code does not mention plugins" is a claim about the
  code, not the product.

---

## Part 2 — The dependency footprint (`requires`, DERIVED not declared)

A theme arranging `forum.index` needs that plugin; the importer skips what it cannot
render, which is right at runtime and reads as "I bought this and half of it did not
appear" on a marketplace.

### Marketplace repo
- `Product.usesTemplates` / `usesBlocks` / `footprintAt` (two migrations —
  `20260830131500_product_theme_footprint`, `20260830133000_product_footprint_walked_at`).
- `extractFootprint()` in `ingest.service.ts` walks `layouts/*.json` on every theme
  release. Derived because a declaration is a second copy of what the documents already
  state — the same argument that made the screenshot an extraction.
  ⚠ The template key comes from the FILENAME, matching the CMS importer exactly.
  ⚠ Types and template keys, never plugin ids: a plugin's id (`nodevo-forum`) and its
  namespace (`forum.`) are different strings and the package carries neither mapping.
- ⚠ **`footprintAt` is load-bearing.** A Postgres `text[]` cannot be null under Prisma,
  so both arrays default to EMPTY — which is also the real answer for "walked, needs
  nothing". Without the marker a listing nobody looked at is indistinguishable from a
  clean one, and the ACP would draw an unearned all-clear. The API omits the arrays
  entirely when it is null.

### CMS
- `MarketplaceListing.usesTemplates/usesBlocks` in contracts.
- `apps/web/src/layout/themeFootprint.ts` — `themeGaps()` (what THIS site cannot draw)
  and `blocksThisSiteCannotDraw()`. Warning renders on the theme card, before the button.
- `apps/web/src/features/admin/hooks/themeInstallResult.ts` — one shared sentence for
  both install entry points, which had already drifted once.

### ⚠⚠ THE BUG FOUND ONLY BY LOOKING — the two registries disagree
The API's `KNOWN_BLOCKS` is the CORE catalogue. Blocks are registered by plugin code in
the BROWSER, so the server cannot see one and reports **every plugin block** as unknown.
That is correct for its own purpose (an unrecognised node is KEPT, never rejected, so a
theme survives its plugin being disabled) and false the moment it is repeated to an
admin. Both report surfaces printed it verbatim, so a site running the forum plugin was
told `forum.categories` could not be rendered while it was on screen — and the
pre-purchase card, which checks the real registry, said the opposite about the same
theme minutes earlier. Both now filter through `blocksThisSiteCannotDraw`, and the
Themes page wording was wrong in the same direction. Guarded by
`themeFootprint.test.ts` ("agrees with the pre-purchase card about the same site").

`unknownTemplates` needs no filtering: the server's template registry DOES include
plugin templates, and an unregistered one is genuinely dropped.

---

## Part 3 — Preview-before-install: the marketplace renders the theme

**The finding that shaped it.** Trying a theme is ONE-WAY today. Install stages it
(correct), but nothing un-stages it: `/admin/layouts/:templateKey/discard` is per
template and layouts only, and `resetAppearance` deliberately keeps the theme layer
(live and staged) — "reset drops MY edits, it does not uninstall the theme". The
Themes page offers Export and Import and no uninstall. So the plan's note that
"try-before-install already exists in essence — needs only a marketplace entry
point" was wrong, and building on it would have built on a false premise.

And the harder half is not an implementation gap at all: letting someone try a theme
they have not bought, on their own site, means handing over the package, which is
the one thing the download chokepoint exists to prevent. A theme has no runtime;
nothing can un-give it. So the preview has to live where the theme never leaves.

### Marketplace: `src/modules/catalog/themePreview.ts`
Renders the theme FROM THE PACKAGE at ingest — one page per template per scheme —
and writes them to `theme-previews/<id>/<key>__<scheme>.html`. `Product.previewTemplates`
records which pages exist (migration `20260830150000_product_preview_templates`).

This is what selling DATA makes possible: the layouts are documents naming exactly
what they place and the tokens are a validated map, so no scratch instance and no
headless browser are needed. **Exact:** the arrangement (block tree, region by
region) and the palette (its real tokens) — the two things a theme actually ships.
**Not exact, and the page says so:** block interiors, whose real appearance is a
React component in the CMS's web app.

⚠ Region order comes from `regionsFor()`, never the document's key order (the
`jsonb` trap). ⚠ Token values are parsed through the CMS's OWN `scopedTokenSetSchema`
— the same validator the Style Editor and the importer use — because that is what
refuses a value carrying `}` `<` `>` `;`, and a local copy could drift.
⚠ The theme's `styles/custom-*.css` is deliberately EXCLUDED: hardening it lives in
the CMS API (`themeCss.ts`), and a second copy of a security control in a second
repo is worse than omitting the CSS. Moving that hardening to a shared package is
the follow-up.

### Marketplace: `GET /api/v1/catalog/:id/preview/:template?scheme=`
The only route on the service answering with a document built from a stranger's
archive, so its headers carry its safety.
⚠ It cannot ride the `/media/previews` static mount: that sends `default-src 'none'`,
right for a PNG and fatal for a document (every style stripped), and loosening it
would loosen the lock on every listing image.
⚠ **A second helmet default had to be undone** — helmet sends
`X-Frame-Options: SAMEORIGIN`, the exact opposite of the `frame-ancestors *` this
route needs. Same shape as the CORP bug from step 4: invisible to `curl`, breaks
only when embedded cross-origin.

### Storefront + ACP
`ThemeDetail` shows the live render with real template tabs and a light/dark toggle
— replacing six invented pill names ("Article, Index, Author…") that were not
Nodevo templates at all. The dead **"Preview with my content"** button was removed:
it had no handler, and next to a real preview it promised something that cannot
exist.
`apps/web/.../ThemePreview.tsx` puts the same preview in the ACP, where installs
actually happen, via a Preview button on each theme card.
⚠ `sandbox=""` on both iframes is a SECOND lock on top of the route's CSP,
deliberately duplicated because the first one lives in another repo.

---

## Part 4 — The REAL preview: your site, your data, the new theme

> ⚠ **Superseded in part by Part 6.** Everything below was written while applying a
> theme STAGED it. It no longer does — a theme goes live the moment it is applied —
> so the draft-vs-published sentences here describe the road, not the destination.
> The undo, the draft-aware CSS and the chrome-free render all survive; where they
> say "staged", read "written live and staged together".

The marketplace render (part 3) answers "what does this theme look like" for a theme
you have not bought. It cannot answer "what does MY SITE look like in it" — block
interiors are components the marketplace does not have, and the content is yours.
That answer only exists on the instance, and almost all of it was already there.

### `?__layout=preview` — draft data, no editor chrome
`?__layout=draft` already renders REAL routes with the draft's layouts, which is how
the Layout Editor's iframe works: real blocks, real content, real plugins. But one
predicate meant two things — "read the draft" AND "show the editor's affordances" —
so the first version of this painted empty-region drop targets labelled HEADER and
FOOTER over the page. An admin deciding on a theme was being shown the editor.
Split into `isDraftLayout()` (both modes) and `isLayoutPreview()` (editor only), with
`preview` as the new chrome-free mode. Guarded by `previewMode.test.ts`.

### The colours were wrong too
`useCustomTokens` always fetched the PUBLISHED stylesheet, so a draft preview showed
an arrangement nobody had staged in a palette nobody had chosen. It now fetches
`?source=draft` whenever the draft is being rendered — which also fixes the Layout
Editor's own preview. And `buildCSS` gained `{ draft: true }`, because the custom-CSS
half still came from the compiled LIVE blob: a theme was previewed in its own colours
under the PREVIOUS theme's stylesheet, a look neither theme has.

### Undo — the thing that makes trying a theme possible
`importTheme` now takes a ROLLBACK POINT before its first write: the staged layout
scopes (`draft` + `theme`) and every appearance theme layer, live and staged, plus the
installed manifest. `POST /admin/themes/discard` puts it all back.
- ⚠ Taken BEFORE any write — snapshotting after would capture the theme being
  installed as if it were what was there before.
- ⚠ The restore DELETES first. Writing rows back would leave every row the import
  created for a template that had none, so "undo" would undo almost nothing.
- ⚠ An ABSENT setting is deleted, not written as null: `getThemeDraftCustomCss`
  falls back to the live stylesheet only when both draft keys are absent.
- ⚠ ONE level, and PUBLISH clears it — after a publish the rollback covers only the
  staged scopes, so applying it would restore old drafts under a newly published
  theme, a state neither theme ever had.
- ⚠ It does NOT delete the theme's uploaded assets: the purge job reclaims them, and
  deleting here would race a re-import of the same theme.

ACP: the Themes page gains **Preview on my site** and **Undo this theme** (the latter
only while a rollback exists), with a confirm that says the undo is lossy — layout
edits made since the import live in the same draft scope.

**Verified end to end in Chrome:** live site purple → install Clanforge 2.0.0 → the
real home page renders in the theme's orange with real profile/feed/who's-online/
board-stats blocks → live site still purple for visitors → Undo → back to 1.4.0,
orange gone from the draft, Undo button gone (one level, consumed).

---

## Part 5 — A theme LIBRARY, and a preview that looks like the page

### Installing a second theme no longer destroys the first
`appearance.theme.installed` was ONE settings key holding ONE manifest, so a second
import silently replaced the first and going back meant finding the original
`.nvtheme` again. New `ncf_themes` table (migration `20260830153000_theme_library`) —
installed is not active, the same distinction plugins draw (§10/§54).
- The row stores the theme's **applicable payload** (documents, tokens, stylesheets
  with asset refs already rewritten), not the package: that is what lets a switch
  need no file, and it is why uninstall takes `uploads/themes/<id>/` with it.
- `applyTheme()` was extracted from `importTheme` so activation runs the SAME code —
  two paths that both "apply a theme" is how one quietly stops staging the stylesheet.
- ⚠ Exactly one row active; the clear and the set share a transaction.
- ⚠ **Uninstalling the ACTIVE theme is refused** — it would leave the site wearing a
  theme with no baseline for "Revert to theme" and no way back.
- ⚠ **Backfill**: every install predating the library has a theme applied and no row,
  so the library would open empty on a site that visibly has one. `backfillLibrary()`
  reconstructs the payload from the `theme`-scope layouts + theme token layer + theme
  stylesheet — exactly what an activation replays. Runs once, on read.
- ACP: an "Installed themes" list with Activate / remove, active one first.

### The marketplace preview is a PAGE now, not a diagram
The first version drew every block as a labelled grey box, which told a buyer which
blocks a theme places and nothing about what it looks like — and what it looks like is
the whole reason anyone buys a theme. Every core type now renders realistic markup
with sample content: the navbar is a navbar with a logo, links and a search field; an
article index is a grid of cards with headlines, excerpts and bylines; a member list
has avatars and roles; board stats are numbers. Painted in the theme's own tokens,
which is the part that is exact.
- Region LABELS are gone — a page does not caption its own header.
- Style-variant and audience badges are gone: annotations are what made it read as a
  diagram, and the variant badge named something the renderer does not actually apply
  (scoped tokens need selector machinery this deliberately skips).
- An audience-restricted block still DRAWS: a preview shows the whole design, and
  picking one audience would be calling that the theme.
- Plugin blocks render as a neutral panel carrying the type — a theme that arranges a
  forum should still show where the forum goes.

**Verified in Chrome:** installed Meadow over Clanforge → both in the library →
switched → active flipped, draft accent went `#ff5c39` → `#2f9e5e`, both still
installed → the real site rendered in Meadow's green.

## Part 6 — Applying a theme is LIVE (no publish step)

The verification at the end of part 5 asked the plain question — activate from the
library, then open the site with no preview flag and no publish — and the answer was
that visitors still had the old theme. That is what draft→publish means, and it was
the wrong shape for this decision.

Draft→publish is an **editing** affordance: batch many small edits, publish when the
set is coherent. Activating a theme is ONE atomic decision, and staging it made that
decision a two-step action and, worse, a **two-place** one — the layouts had to be
published from the Layout Editor and the tokens and stylesheet from the Style Editor,
with nothing on the Themes page saying so. Once there was a real preview (parts 3–4),
an undo, and a library to switch back through, staging had stopped buying anything.

- `layoutService.applyThemeDocument()` writes `published` **and** `draft` in one
  transaction and busts the published memo; `applyTheme()` calls it for every template
  the admin has not customised. Tokens and the theme stylesheet already wrote their
  live and draft keys together (`saveThemeTokens`, `saveThemeCustomCss`).
- `bumpStyleVersion()` is now load-bearing rather than cosmetic: it is the SSE channel
  every open tab listens on, and a theme that went live silently would sit unseen
  until someone reloaded.
- ⚠ **The rollback snapshot had to grow.** `snapshotStagedScopes` deliberately excluded
  `published` while an import never wrote it. Now that activation goes live, an undo
  that skipped `published` would leave visitors wearing the theme the admin just
  rejected — the one state undo exists to prevent. It snapshots and restores all three
  scopes (`published`, `draft`, `theme`), and still DELETES before writing back.
- Unchanged by going live: the theme LAYER is still recorded for every template (it is
  what the next update compares against and what "Revert to theme" restores), and a
  customised template is still KEPT, never overwritten.
- ACP + storefront copy in all five locales now says the theme is live
  (`themes.previewHint`, `marketplace.themeDraftNote`, `themes.reportStaged`).
  **"View my site" links to the plain route** — it used to carry
  `?__layout=preview`, which after this change would show the admin's own unpublished
  layout edits and call them the theme.
- Guarded by `theme.service.test.ts` → "applying a theme is live" (publishes rather
  than stages, bumps the style version, still writes the layer, still keeps a
  customised template, and does all of it on a SWITCH too, not only on import).

⚠ `?__layout=preview` (chrome-free draft render) is KEPT: the `isDraftLayout` /
`isLayoutPreview` split is what stops editor chrome leaking onto a preview, and the
mode is still the honest way to look at a staged layout draft. It just has no linked
entry point any more — worth one in the Layout Editor.

---

## Part 7 — ⚠⚠ THE BUG GOING LIVE UNCOVERED: the site kept the old theme

Found by doing exactly what an admin would: activate from the library, then open the
site with no preview flag. The server had switched — `/appearance/css` served the new
palette, `ncf_themes` had flipped, the ACP had repainted — and **the site itself was
still wearing the previous theme**, on a fresh page load, indefinitely.

Two things had to line up for that, and both were true:

1. **`/appearance/css` was `public, max-age=60`.** A page loading inside that window
   gets the stylesheet from before the switch, out of the browser's own cache. It is
   now `no-cache` — REVALIDATE, not "do not store": the ETag makes the usual answer a
   **304 with no body**, so the cache still saves the bytes and the first paint is
   always the current theme.
2. **The client compared the wrong two things.** `liveStyle.ts` refetched when one
   stream event differed from the PREVIOUS one. The connect echo carries the current
   version, so a client holding a stale stylesheet recorded the new version as its own
   baseline, saw no further change, and never reconciled — stale for the life of the
   tab. It now compares **what it is holding** against what the stream announces:
   `/appearance/css` stamps `X-Style-Version` (live responses only — a stamped draft
   would let a preview reconcile itself back to the live theme), and the client keeps
   `loadedVersion` beside `streamVersion`.
   - ⚠ `reconcile()` runs on BOTH inputs, because either can arrive second: the stream
     can connect before the startup fetch resolves.
   - ⚠ **One refetch per announced version** (`attemptedFor`). The refetch restamps
     `loadedVersion` from what actually came back, so a response that is still stale —
     an intermediary that ignores `no-store` — would otherwise land straight back in
     `reconcile` and fetch forever.
   - ⚠ A refresh refetches the SAME half it loaded. `refreshTokenCss` always fetched
     the live stylesheet, so a reconcile inside a draft preview would quietly end the
     preview.
- **Three copies of the startup fetch** (`App.tsx`, `AppLayout.tsx`,
  `ThemePreview.tsx`) are now one `loadTokenCss()` — three call sites is how one of
  them keeps dropping the version stamp the reconcile depends on. `AppLayout`'s copy
  is gone entirely: it renders under `AppGuard`, which already loads tokens, and its
  copy always asked for the LIVE stylesheet — so in a draft preview the two raced,
  and the wrong one could win.
- Guards: `apps/web/src/lib/liveStyle.test.ts` (6 cases, incl. the stale-hold and the
  no-loop bound) and `apps/api/src/modules/appearance/cssFreshness.test.ts` (3).

**Verified in Chrome:** live tab open on the site → activate the other theme in the
ACP → the open tab repaints in ~1s with no reload; and a page loaded immediately after
a switch paints the new theme on first paint (before, it painted the old one and kept
it).

---

## Part 8 — The admin panel is not part of the site's design

Reported while looking at Part 7: switching the theme repainted the **ACP** too. It
had always been that way — the served stylesheet declares the palette on `:root`, and
the ACP is the same document — but a theme switch made it impossible to miss. A site
in orange gave you an orange admin panel, and the panel is a tool, not a page of the
site. The font was already pinned for exactly this reason; the colours now are too.

### `apps/web/src/styles/_tokenDefaults.scss` (new)
The token DEFAULTS as three mixins (`primitives`, `palette-light`, `palette-dark`,
`components`) and no rules of its own. `tokens.scss` includes them for the document;
the ACP includes them for itself. One source, so the two cannot drift — the values
moved, nothing changed.

### `AcpLayout.scss`
`body.nv-acp` re-declares the whole palette (element+class **outranks** the `:root`
and `[data-theme]` the stylesheet writes), plus `[data-theme="dark"] body.nv-acp` for
dark — the ACP still follows the READER's light/dark choice; it is the SITE's palette
it opts out of. The existing font pin stays, and the two comments that described the
old behaviour as deliberate ("admin custom CSS shows through in the ACP", "the Style
Editor's field knob reaches them") were rewritten rather than left to mislead.

### Custom CSS stops at the panel too (`appearance.service.ts`)
`scopeSelector` anchors every rule under `body:not(.nv-acp)`, compounding onto a
`body` selector rather than nesting a second one. So `a { color: red }` written for
the site no longer recolours admin links.
- ⚠ `:root` / `html` rules stay document-wide. Qualifying a rule on the ROOT element
  by a class on its child needs `:has()`, and an unsupported selector drops the
  admin's ENTIRE stylesheet rather than one rule — too dear a failure for the case,
  and those rules declare tokens, which the ACP re-declares over anyway.

### ⚠ The pin makes one surface lie, so there is an opt-out from the opt-out
`BlockStyle`'s variant probe measures a real element with `getComputedStyle` — that
is how the panel shows what `accent` currently looks like without duplicating the
SCSS in TS. It attaches to `document.body`… which is now `body.nv-acp`, so it would
have reported the ADMIN PANEL's colours as the site's. The probe now sits inside a
`.nv-site-tokens` host: `tokens.scss` gives that class the defaults back, and
`buildCSS` **mirrors the global bucket onto it** (`:root, [data-theme="light"],
.nv-site-tokens`), so what it measures is what the site paints.
- Only the global bucket is mirrored: a region scope names a selector that exists on
  the site, and a variant scope is emitted under `:root`, so it already reaches a
  probe anywhere in the document.
- Guarded by `apps/api/src/modules/appearance/acpSeparation.test.ts` (7).

**Verified in Chrome:** site on Clanforge (orange) → ACP renders in its own blurple,
light and dark, across Themes / Style Editor / Layout Editor, while the Style Editor's
swatches and both preview iframes still show the site's orange. Measured in the ACP:
`html --c-accent: #ff7a5c` (site) vs `body --c-accent: #7c84ff` (panel), and a probe
inside `.nv-site-tokens` resolving `--surface-bg: #2e1a14` from the site's palette.

---

## Part 9 — The layout editor: one header, one footer, and a rail beside the body

Two complaints, one session: the site header was missing from the editor's preview,
and `aside` was a band under the body rather than a column next to it.

### `aside` means BESIDE (`LayoutRenderer`, `coreBlocks.scss`)
Regions were emitted in template order, so the four landmarks rendered as four
stacked strips. `main` and `aside` are now one row (`.nv-body-row`) — body plus a
`--rail-width` rail, collapsing to a column under 1024px, which is intrinsic and not
an admin knob (the same rule `columns` follows).
- The pairing is in the RENDERER, not in a stylesheet on `.app-main`, because it is a
  property of the template's region set: a template that declares no `aside` gets no
  row, and `chrome.header` must not be wrapped in a page content column.
- The ROW owns the content column now (`.nv-region, .nv-body-row` share the rule) and
  the regions inside it are plain tracks — two centred columns side by side would each
  be inset by their own padding, and a `section width: full` in the body would break
  out of the wrong box.
- ⚠ `min-width: 0` on the body track, or one wide child (a table, a long word, a card
  grid) refuses to shrink and pushes the rail off the page.
- ⚠ An empty rail is `display: none`, so it takes no space AND leaves no flex gap.
  On the live site the region renders nothing at all; this covers the editor's
  placeholder and a rail whose every block is hidden from this viewer.
- Guarded by `bodyRow.test.tsx` (8, incl. the landmark contract) and `LayoutRenderer.test.tsx`.

### Whose header is that? (`humaniseRegion`, `layoutEditor.pageRegion`)
A page's `header` region is a band between the SITE header and the body, and both
were labelled "Header" — which is exactly how an admin came to read an empty page
header region as the site header having disappeared. Page regions are now named as
page ones ("Page header" / "Page footer") in the tree AND in the preview placeholder;
chrome templates keep the plain names, and the picker calls them "Header (site-wide)"
/ "Footer (site-wide)" instead of "Navbar". One hint line in the tree says where the
site-wide pair lives, one says that `aside` sits beside the body. Five locales.

### The preview shows the STAGED site, and says where that differs
The complaint that started this was a masthead missing from every page's preview: this
site's `chrome.header` draft is a bare `navbar` while its published version carries the
band. The first fix drew the chrome from PUBLISHED instead — which was the wrong half
of the answer. The header was missing from the TREE, so nothing said it had a staged
version at all; and once the header is editable from a page, drawing it from anything
but the draft would hide the admin's own edit.

So: one source for everything on screen — published on the site, **staged in the
editor** — and the rule an admin can hold is that the editor previews what Publish
would ship (`/admin/layouts/publish` promotes every pending draft). A listed row whose
document has a pending draft says so, which is the missing sentence that made a staged
header look like a lost one.
- `&__editing=<templateKey>` still names the open document, but now decides
  affordances (drag, drop targets), not which version is drawn.
- ⚠ `?__layout=preview` (the theme preview) names none — it shows the whole staged
  site, which is exactly what it is for.

### What belongs to the open document, and what does not
Every empty region used to draw a drop target and every block was draggable, whichever
document it came from — so clicking the page's empty aside while arranging the header
asked the editor to add a block to a region `chrome.header` does not have. Selection
is now open to everything (that is the way IN); dragging and drop targets are the open
document's alone, because both act on the tree the editor is holding.
- Guarded by `previewScenery.test.tsx` (6) and `previewMode.test.ts` (+4).

### ⚠⚠ The site's header IS the header — and it is editable from any page
Naming the page's bands was not enough: the masthead band + navbar were still not
being TREATED as the header. Two places said so.

**The DOM.** A page template's `header`/`footer` regions emitted `<header>` and
`<footer>` — so every page carried TWO banner landmarks and TWO contentinfos, and the
pair that is not the header and footer sat nested inside `<main>`. Landmarks are now
the SITE's alone: `regionElement()` gives `<header>`/`<footer>` to `chrome.*` only,
and a page's bands render as divs (`aside` keeps its complementary landmark). Live
`/members` now reports exactly `HEADER.nv-region--header`, `DIV.nv-region--header`,
`DIV.nv-region--main`, `FOOTER.nv-region--footer`.

**The editor.** The site header was absent from a page's structure while a band that
is not the header was called "Header". Now the tree is the PAGE, top to bottom —
Header (site-wide) · Above body · Body · Aside · Below body · Footer (site-wide) —
whichever document is open, and **every part of it is reachable**:
- **Click the masthead band, the navbar, or the who's-online panel in the preview and
  the editor opens that document with the block selected.** Delete the logo, add a
  block beside it, edit its props — the header and footer are arranged from the page
  you are looking at, which is where an admin is when they decide to change them.
  `data-nv-template` on every wrapper is what carries the owning document to the
  bridge; the tree's listed rows do the same thing on click.
- The preview stays on the page you were on (`previewPageKey`): chrome renders on
  every route, so opening the header must not move you to another page.
- ⚠ ONE document at a time, and the picker says which. Each has its own draft and its
  own publish; two behind one Publish button would make the button lie. The tree keeps
  showing the whole page either way, so opening the header loses nothing from view.
- ⚠ Dragging stays with the OPEN document (`data-nv-drag`), because a move rewrites
  the tree the editor is holding — as do empty-region drop targets.
- Page bands are "Above body" / "Below body", named by where they are, since what they
  are not is the header.

**Verified in Chrome:** on Article index the tree reads Header (site-wide) · Above
body · Body · Aside · Below body · Footer (site-wide), and the preview reads the same
top to bottom. The rail sits beside the body (row 1240 = body 868 + gap 24 + rail 300).
Clicking **who's online** in the preview opened Footer (site-wide) with that block
selected, its four blocks arrangeable and its props in the panel — still previewing
`/articles`. Clicking the **navbar links** opened Header (site-wide) the same way. In
the DOM every block carries `data-nv-template`, and only the open document's carry
`data-nv-drag`.

---

## Part 10 — THE HEADER, as one block

The header had become something an admin assembled: a full-width `section`, a height,
two colour stops, a `logo` dropped inside it, and the navbar under it. Every one of
those is a step where a site's most recognisable element could be got wrong, and none
of them says "header" anywhere.

### `header` — the block (`contracts/layout.ts`, `chromeBlocks.tsx`)
The band, with the four things anyone actually sets: **height** (default **250px**,
full width), **background** (gradient stops + angle, image over it), **show the
logo** (left of the band, in line with the navbar's), **show the site name**.
- ⚠ `height` is a FLOOR (`min-height`), like `section.minHeight`: a translated site
  name, a bigger accessibility font or a taller logo must push the band, never be
  clipped by it.
- ⚠ Deliberately NOT a container. Everything a masthead holds in practice is the logo,
  and a band that accepts arbitrary blocks is a `section` — which still exists, and is
  still placeable in the header for exactly that.
- ⚠ The inner column's numbers MATCH `.nv-region` and `.pub-nav__inner`, which is what
  puts the masthead logo directly above the navbar's own.
- The background panel is now offered by SCHEMA (`paintsBackground()`), not by
  `type === "section"` — a second name check is how the two would have drifted.

### The arrangement is the ORDER
`chrome.header` ships `[header, navbar]`. The navbar above the band or below it is one
drag; a site that wants no band deletes the block and runs on the navbar alone; the
picker puts it back. There is no third concept for "masthead above or below" — that is
what two `band*` regions used to be, and they are gone.

### `headerBandMigration.ts` — every existing site gets it
A shipped default only reaches sites that never touched their header. A one-time
carry-over converts a full-width `section` at the top of `chrome.header` into the
block, value for value: same gradient, same angle, same image, same height, and a
`logo` CHILD becomes the `showLogo` / `showWordmark` settings.
- ⚠ Only when it IS the masthead: full width, decorated (a height or a background),
  and holding nothing but the logo. A section carrying a heading or a search field is
  left alone — converting it would delete what it holds.
- ⚠ It adopts the SHIPPED id (`h-band`), or an untouched header would read as
  customised for ever after ("is this customised?" is a `JSON.stringify` against the
  code default) and theme updates would stop touching it.
- ⚠ Every scope, including `draft` and `theme` — the same reason the region
  consolidation gives.
- Guarded by `headerBandMigration.test.ts` (11), half of which are the cases it must
  REFUSE.

### The navbar's logo is removable
`REQUIRED_BLOCKS['chrome.header']` was `['logo', 'userMenu']`, so the logo could be
moved but never deleted — and a site whose navbar deliberately has none, because the
mark already fills the band above it, could not save that. It is `['userMenu']` now.
A way home is not one block's job (the navigation links are one, the band's own logo
is another); being unable to SIGN IN is the thing an admin cannot undo from the front
end, which is why the account menu stays required.

### …and the "site-wide" rows are gone
The previous pass listed the header and footer inside every page's tree, tagged
SITE-WIDE. It was noise: they are their own templates in the picker, and clicking them
in the preview already opens them. The tree shows the open document's regions and
nothing else.

**Verified in Chrome:** the dev site's hand-built masthead was migrated on boot —
published `chrome.header` is now `[header, navbar]` with `height: 250`,
`backgroundAngle: 90`, `showLogo: true`, `showWordmark: false` carried from the logo
child — and the live site renders pixel-identically (`.nv-header`, `min-height: 250px`,
`linear-gradient(90deg, …)`). In the editor, "Header" is offered in the header
template's picker and its settings panel reads Height (px) 250 · Show the logo · Show
the site name.

---

## Part 11 — A page is a body and a rail

The page-level `header` and `footer` regions are gone. They were bands above and below
the body, INSIDE `<main>` — so they were never the page's header and footer (the site's
are, `chrome.*`), every shipped default left them empty, and what they offered over a
`section` at the top of the body was a name. The wrong one: an admin reading "Header"
in a page's structure reasonably concluded the site header had gone missing, which is
the thread that ran through this whole session.

`TEMPLATE_REGIONS` for the six page templates is `['main', 'aside']`. The editor's
tree reads **Body · Aside**, and the renderer's naming and landmark rules lost the
branch that existed only for the page pair.

### `pageBandMigration.ts` — nothing is lost on the way
An undeclared region is KEPT and skipped by design ("disabling a plugin must never
delete an admin's layout"), so a site that HAD put a block above its body would keep
it in the document and simply stop rendering it — silently, and indistinguishable from
a deletion. The carry-over folds the bands into the body: the one above lands at the
TOP, the one below at the BOTTOM.
- ⚠ ORDER, not concatenation: appending both would move an admin's intro under the
  article.
- ⚠ It also drops EMPTY regions the template no longer declares — including the
  `beforeBody` / `afterBody` the earlier region consolidation left behind on
  `article.detail`. One stray empty key makes an untouched page read as CUSTOMISED
  for ever (that question is a `JSON.stringify` against the code default), and a theme
  update then declines to touch it.
- ⚠ Empty ONLY. An undeclared region still holding blocks is an admin's work — a
  plugin whose template is not registered right now — and it is kept.
- Guarded by `pageBandMigration.test.ts` (9).

### The one default that used a band
`members` shipped its head row (eyebrow + title + tabs) in the page `header` region.
It is the first block of the BODY now — the same position, without the misleading
name.

**Verified:** the migration ran on the dev database — every page row is `main,aside`,
`article.detail` lost its two leftover empty regions — and the editor's Structure pane
reads Body · Aside with the site header and footer rendering around the preview as
before.

---

## Part 11 — the FOOTER is a block, and the rail is finished

Raised on inspection of the layout editor: `chrome.header` had shipped `[header,
navbar]` for a release while `chrome.footer` was still four loose leaves, so an admin
could arrange what was IN the footer and never the footer itself. Its band —
`--footer-bg`, the hairline above it, the content column — was hardcoded in
`SiteFooter.tsx`.

### The `footer` block
- A CONTAINER, and the peer of `navbar` rather than of `header`: the masthead sits
  ABOVE the navbar and is its own block, while the footer's band IS what holds its
  pieces. `chrome.footer` now ships one band with the four pieces inside it.
- Props: `minHeight` (a floor), the `section`/`header` background trio
  (image over gradient, `asset: true` so it travels in a `.nvtheme`), and
  `showTopBorder` — off for a footer whose own background already separates it.
- ⚠ It renders `.nv-foot`, which IS `SCOPE_SELECTOR.footer`: the Style Editor's
  entire Footer panel is emitted under that class, so renaming it empties the panel.
  `footerBand.test.tsx` pins the two together.
- ⚠ The band draws a background only when the document asks for one. A band that
  always painted would override `--footer-bg` — a colour the admin chose in a
  different editor — so adopting the block changes nothing about an existing site.
- `SiteFooter` no longer wraps anything: the region still emits the `<footer>`
  landmark, the block paints inside it. A wrapper would leave the band behind when an
  admin drags the pieces out to say "no footer chrome", and would nest two bands.

### `footerBandMigration.ts` (boot, flag `layout.footerBandMigrated`)
Wraps a stored footer's region children in the band, every scope, order and audiences
untouched. Refuses rather than producing a tree deeper than `MAX_BLOCK_DEPTH`.

⚠⚠ **`parseLayoutDocument` does NOT fill a block's prop defaults** — `props` is a
passthrough record. So the code default stringifies as `{"showTopBorder":true}`, and
the first version of this migration (which wrote the full prop set) made an untouched
footer compare UNEQUAL to its own default: the draft chip said "pending publish" for
ever and a theme update would have refused the template as customised. Caught by
looking at the dev database, not by any test that was passing at the time. The band
now emits exactly the default's props, and a test asserts the two stringify alike.
The comment on `codeDefault()` explains parse normalisation — it normalises key ORDER,
which is a different thing from filling defaults.

### The aside rail — the gaps closed
It was wired end to end (all six page templates, `<aside>`, the body row, the ≤1024px
collapse) and used by nothing: every code default ships it empty, and `home` builds
its rails from `columns`/`column width: sidebar|rail` instead. The decision was to
keep it as the page's ONE simple rail and leave `columns` as the power tool (two
rails, or a rail on the left, are still its job), then fix what was missing:

- ⚠⚠ **`SCOPE_SELECTOR.aside` was dead.** It pointed at `.hf-left, .hf-right` — home's
  two hardcoded rail wrappers, DELETED when home was decomposed into blocks. The
  scope outlived them, so every edit in the Style Editor's Aside section was emitted
  under a selector matching nothing: "Aside background" did precisely nothing. It now
  names both ways of building a rail (`.nv-region--aside, .nv-column--sidebar,
  .nv-column--rail`), and `scopeSelectors.test.ts` checks EVERY scope against the
  source. ⚠ That test strips comments first — `.hf-left` is still named all over the
  codebase in the comments explaining why it is gone, and a scan that counted those
  would have passed on the very bug it exists to catch.
- **The rail sticks**, at `column.sticky`'s offset, so a rail behaves the same however
  it was built; `position: static` again once the row stacks.
- **`--rail-width` / `--sidebar-width` are editable** (Style Editor → Aside), which
  needed a plain `size` control — every `length` in the registry until now folded into
  the radius slider, whose 0–28 range is meaningless for a rail. `TokenDef` gained
  `min`/`max`, and `BASE_FALLBACK` the two starting values.
- **The picker marks page-width blocks** when the target is the rail (the `aside`
  region, or a `column` sized `sidebar`/`rail`): `editorMeta.wide`, shown as a WIDE
  chip. Advisory, never a rule — a `section` in a rail is how you give the rail a
  background, and refusing a layout the renderer can draw would be the worse error.

**Verified in the browser:** the site footer renders identically (one `<footer>`, band
inside, no nested wrapper); the editor's Structure pane reads Footer → Footer → the
four pieces with the band's own settings panel; toggling the line off changes the
preview and toggling it back leaves the draft byte-equal to the default ("Up to
date"); the WIDE chips appear in the Aside picker and not in the Body's; the Rail
width slider stages `--rail-width: 360px` into the draft stylesheet and "Revert to
inherited" removes it again; and `/articles` renders `<aside class="nv-region--aside">`
sticky at 300px, resizing with the token.

Totals: API **305**, web **606**, `backbone:check` green.

---

## Part 12 — a track that draws nothing no longer holds width open

⚠ An earlier attempt at this — rendering the preview at a fixed 1440 and scaling it
into the pane — was **reverted at the user's request**; `previewScale.ts`, the Fit/100%
control and the stage wrapper are gone, and the frame is `width: 100%` again. The
complaint was never about the preview's width. It was that the feed does not get the
room beside it.

### The rule `:empty` was meant to be, written with `:has()`
`.nv-body-row > .nv-region--aside:empty { display: none }` could never fire: every
block is wrapped in a `display: contents` element that exists whether or not the block
rendered anything, so a rail was never `:empty`. It held `--rail-width` open and drew
a hole. Same for a `column` — home's right rail reserved its track on a site with no
threads and no tags, and the feed beside it stopped at **412px of a 938px row**.

Both are now `:not(:has(.nv-block:not(:empty)))`, which asks the question `:empty` was
meant to ask: did anything in here draw? Measured after: the rail column collapses and
the feed takes **666px**.

⚠⚠ **`.nv-block` is a new class on every block wrapper, and it is a LAYOUT
DEPENDENCY.** The obvious selector — `[data-nv-block]` — is stamped by the renderer in
the EDITOR only, so the first version of this rule matched nothing on the real page
and collapsed *every* track on it (caught in the browser, one reload later). Pinned by
`classContract.test.tsx`.
⚠ Descendant, never `> .nv-block`: a column's children are `display: contents`
wrappers and a combinator aimed across one silently stops matching.
⚠ It applies in the editor too. A container holding nothing is arranged from the
TREE, which addresses every level explicitly — the preview must not lie about how
wide a page is.

### Kept from the same pass
- The empty-region placeholder carries its region's modifier (`nv-region--aside`), so
  an empty rail in the EDITOR is `--rail-width` and not half the row. It is excluded
  from the collapse rule above: it is the drop target for a region with no blocks.
- `--rail-width` is 260px.

**Verified in the browser:** live home unchanged (its rail has content and all three
tracks fill the row); home's draft in the editor went from a cramped feed beside a
rail of nothing to a feed that takes the whole remaining width, the empty rail
collapsed. Re-measured at the final `--rail-width` of 260px.

Totals: API **305**, web **608**.

---

## Part 13 — a plugin block that draws nothing now says so

"Choose the shoutbox plugin slot and it never appears in the rail." Two causes.

### The dev instance was running a plugin build from July
`apps/api/var/uploads/plugins/nodevo-shoutbox/web/dist/index.umd.js` was dated Jul 26
and registered a `registerLayoutWidget`; the source has since replaced that with a
first-class `shoutbox.box` BLOCK (the plugin's own write-up explains why: the widget
used to gate on its own `placement` enum, so an admin could drop it anywhere and it
rendered nothing unless a setting in another screen agreed). Both manifests say
1.3.0, so nothing could detect the drift — the update check compares versions.
Refreshed by copying the built bundle over the installed one; the server bundles were
byte-identical, and forum/messaging/launch were already in sync.

⚠ A stale plugin build is invisible when the version did not move. Worth a rebuild
before diagnosing any "the plugin does not render" report.

### The editor now labels a block that rendered nothing
A block can render nothing and still be exactly where the admin put it: a widget that
self-gates, a permission the admin lacks, a card with no data yet. On the site that is
correct and silent; in the editor it was indistinguishable from "the block was never
added" — and with Part 12's collapse, the rail it was dropped into vanished with it.

- `previewBridge` stamps `data-nv-editor` on `<html>` (removed on teardown, pinned in
  `previewMode.test.ts`). It is the bridge's job because the bridge exists only in the
  preview.
- Part 12's two collapse rules are now scoped `:root:not([data-nv-editor])`: the SITE
  collapses an empty track, the EDITOR keeps it.
- `[data-nv-block]:empty::after` draws a small dashed "`<type>` — nothing to draw
  here". `data-nv-block` is stamped in the preview only, so it can never reach a
  visitor.
- ⚠ `:empty` ignores pseudo-elements, so the marker never makes a block count as
  drawn — the live-site rules keep seeing an empty wrapper. And a `display: contents`
  element generates no box but its pseudo-elements do, which is the only reason a
  wrapper with no children can show anything.

**Verified in the browser:** after the refresh the picker offers "Shoutbox"
(`shoutbox.box`), and dropping it in home's right rail renders the shoutbox —
messages, input and all. The silent blocks around it (`pluginSlot`, `homeHotThreads`,
`homePopularTags`, `headerWidgets`) now say so instead of leaving a gap.

⚠ Left in the dev draft, not fixed for the user: home holds two
`slot.layoutWidget.nodevo-shoutbox` nodes — the OLD derived widget block. They now
report "unavailable" (unknown type, skipped and kept). Delete them and place the
Shoutbox block instead.

### The middle column's floor
Decided against moving `.nv-columns` to CSS grid. The tracks already behave as two
fixed rails plus a fluid middle (`sidebar` 248 / `1` = `flex: 1 1 0` / `rail` 260),
measured 248 · 636 · 260 on the live home with the shoutbox rendering at 246px inside
a 248px rail — placement was never the problem. Grid would buy deterministic tracks
and cost the thing that makes `column.width` work at all: a grid parent cannot read
its children, and the width is a per-CHILD prop (the reason the row is flex, written
down beside the rule).

What did change is the floor a weighted track refuses to go below: **220px → 320px**.
220 is a RAIL's width — beside two real rails the body could be squeezed narrower than
the cards it holds and still count as a three-column row. The row now wraps at ~924px
of row width instead of ~824, and a wrapped middle takes the full width, which is what
a narrow screen can actually show.

⚠ Still `min(320px, 100%)`: a bare `320px` would make a lone track wider than its
parent on a phone.

⚠ No "belongs in a rail" hint was added — the admin picks the rail, and a plugin block
is just a block (the WIDE chip from Part 11 stays: it marks page-width blocks when the
TARGET is a rail, which is the opposite question).

Totals: API **305**, web **609**.

---

## Part 14 — ⚠⚠ the autosave could write one template's blocks into another's draft

Found while clearing two stray nodes out of home's `aside`: the draft came back with
its RIGHT RAIL COLUMN missing — `column:rail` and its five blocks — while `published`
still had it. Restored from `published` (the two were otherwise identical), then
found the mechanism.

`useAutosave` writes `doc` to `/admin/layouts/${templateKey}`. Those two change at
DIFFERENT MOMENTS: `templateKey` moves the instant the picker is clicked, and `doc` is
replaced a render or two later, when the new template's draft query resolves. Between
them the editor holds the OUTGOING document under the INCOMING key — and the autosave
is on a 700ms timer, so it can land inside that window. What it overwrites is a saved
layout nobody was editing, and it says nothing.

`versionRef` makes it worse rather than catching it: it holds the version of the row
being edited, so a write from that window carries one template's version against
another template's row.

Both halves fixed:
- **The guard.** `onSave` refuses a document whose own `templateKey` is not the one
  being edited. The document knows where it belongs — `LayoutDocument.templateKey` is
  part of the schema and `parseLayoutDocument` enforces it.
- **The address.** The PUT goes to `next.templateKey`, never the ambient picker
  state, so a write that does happen goes to the right row.

Pinned by `layoutAutosaveTarget.test.ts` (5).

⚠ It reproduces most easily by switching templates programmatically (which is how it
was hit), but nothing about it requires that: a slow draft fetch and a click on the
picker are enough. Treat any "my layout lost a block" report as this until ruled out.

Totals: API **305**, web **614**.

---

## Part 15 — the shoutbox places itself, without core changes

"Someone who isn't firm with the Layout Editor yet should install the plugin, pick
forum or rail, and be done." Built entirely inside `nodevo-shoutbox` — no core, no
SDK change.

### The setting became an action
`placement` was a select that had stopped being read: the block decides where the
shoutbox renders, so the control could be changed with no effect at all. It is
replaced by a **Where it sits** card whose buttons WRITE the layout document through
core's existing admin API (`GET`/`PUT /admin/layouts/:templateKey`) as the admin:
*Home rail* → a `shoutbox.box` in home's `aside`, *Forum index* → the top of
`forum.index`'s body, *Take it off* → removed. The card's state is read back from the
document, so nothing can claim a placement the page does not have.

`web/acp/placement.model.ts` holds the document maths (pure, 14 tests):
- **Move, never copy.** The block is removed from the other target first, at any
  depth — an admin may have dragged it inside a `section` since it was placed, and a
  shallow scan would leave that copy and add a second.
- **`freshId` walks the whole document.** This plugin writes into a page it does not
  own; a duplicate id is refused by the API.
- `aside` is the home target, not a rail COLUMN: every page template declares
  `aside`, while a rail column exists only in the shipped arrangement.

### ⚠⚠ Why not `host.prisma`
A plugin is handed the host's full prisma client and could write `ncf_layouts`
directly. `PUT /admin/layouts/:key` is not a thin wrapper: it runs `validateBlockTree`
(depth, duplicate ids, container rules), the required-block check, the `baseVersion`
conflict guard, the ACP activity log — and `publishedMemo.bust()` for the service's
30s cache, which a plugin cannot reach. A row written behind all that is invisible
until the cache expires, and an invalid one renders as the shipped DEFAULT while the
admin's real document sits unused in the table.

⚠ And it never publishes. `POST /admin/layouts/publish` is SITE-WIDE — a plugin
pressing it would push out layout work somebody else staged and has not finished. It
stages, says so, and links to the editor.

⚠ So there is no auto-placement at install: `onEnable` has no admin session and the
prisma path is closed. The card shows "not on any page yet" instead, and one click
fixes it.

**Verified in the browser:** the card reads "not on any page yet" on a clean draft;
*Home rail* writes exactly one `shoutbox.box` (id `sb`) into home's `aside` and leaves
the three columns untouched; the card flips to ✓ Home rail with the draft note; *Take
it off* empties it again. Left unplaced, as asked.

Totals: API **305**, web **614**, shoutbox **14**.

---

## Not done — step 5 remainder
The **creator portal** (submit a `.nvtheme`, auto-validate, versions + changelog +
compat range).

## Local dev state left behind
The dev marketplace has a `clanforge` theme listing (versions 1.0.0–1.4.0) and a
hand-inserted `mkt_licenses` row `NDV-CLAN-DEV1` for the connected account, both
created to exercise the paths above in a browser. Delete if unwanted.
