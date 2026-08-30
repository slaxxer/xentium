# Last codebase update — 2026-08-29

Steps 1, 2, 3 and 4 of the theme-marketplace track, plus chrome bands + section backgrounds.

# Part 1 — the designer's handles

Step 1: the two handles a designer needs before a theme
creator community can build anything that isn't already expressible in tokens. Small on
purpose — both fields are permanent, so the surface stays as narrow as the use case.

The decisions this step follows were taken today and are recorded in the
`theme-marketplace-plan` memory: distributed themes MAY ship custom CSS (with hardening,
which is step 2); paid themes are in scope from the start; the theme catalogue is a
`kind` field on the existing marketplace, not a second property.

## What this unblocks

An image navbar — the thing that has no expression in the block catalogue today:

```jsonc
// chrome.header, per tile
{ "type": "image", "className": "nav-tile",
  "props": { "source": "assets/forum.png", "href": "/forum" } }
```

```css
.nav-tile > *       { width: 120px; }
.nav-tile:hover img { filter: brightness(1.15); }
```

`navLinks` renders text and has no props, so before this there was no way to say "this
artwork is the link to /forum", and no stable selector to style one tile with.

## Files

| File | Purpose |
|---|---|
| `packages/contracts/src/layout.ts` | `className` on `BlockNode` + `blockClassNameSchema` (1–4 CSS identifiers, `nv-` refused). New `linkHrefSchema` and `image.href`. |
| `apps/web/src/layout/LayoutRenderer.tsx` | The handle rides the SAME `display: contents` wrapper as the variant; that wrapper now also exists outside the editor when only a handle is set. |
| `apps/web/src/layout/blocks/coreBlocks.tsx` | `ImageBlock` wraps the `<img>` in `a.nv-image__link` when `href` is set. |
| `apps/web/src/layout/blocks/coreBlocks.scss` | `.nv-image__link` — a block box with no link colour or underline, so the aspect-ratio rules keep measuring the right element. |
| `apps/web/src/layout/blockTree.ts` | `updateBlockClassName` — deletes the field when cleared, normalises whitespace. |
| `apps/web/src/features/admin/pages/BlockStyle.tsx` | The CSS-class field, deliberately ABOVE and OUTSIDE the container branch. |
| `apps/web/src/features/admin/pages/LayoutEditorPage.tsx` | Wires it to the tree op. |
| `apps/web/src/features/admin/pages/LayoutEditorPage.scss` | `&__style-class`. |
| `apps/web/public/locales/{en,de,es,fr,pt}/acp.json` | `layoutEditor.classNameLabel` / `.classNameNote`. |
| `apps/web/src/layout/blockHandles.test.tsx` | **New**, 21 tests: the class contract, the tree op, the wrapper, the href scheme refusals, the anchor. |
| `docs/theme-packages.md` | New "CSS handles" section — the `> *` idiom, the reserved prefix, `image.href`. |
| `docs/plugin-blocks.md` | New section: plugin blocks get the handle free, must NOT add a `className` prop, and their own class names are now a public contract. |

## ⚠ The one decision worth remembering

**The handle is stamped on the `display: contents` wrapper, NOT passed into the block.**

Threading a `className` prop through the 52 registered block components would have been
honoured by core blocks and silently ignored by every plugin block a theme wants to skin —
and skinning a plugin's block is exactly what a theme marketplace needs. The wrapper is
uniform across core, plugin and future blocks, costs no per-block work, and cannot break
the flex and grid parents that size the real element.

The price: the handle paints nothing, so custom CSS styles *through* it — `.nav-tile > *`,
`.nav-tile img`, `.nav-tile .nv-image`. Descendant and `:hover` selectors work normally,
because `:hover` matches an ancestor of the hovered box whether or not that ancestor
generates one. Documented in both docs, because it is the first thing a theme author hits.

**This is a compatibility contract now.** Moving the class to the block's real element
later would break every shipped theme's `.handle > *` rules.

Other rules that are permanent as of this step:

- **`nv-` is reserved.** A document that could mint a core class could impersonate one, or
  hand itself a variant (`nv-v--accent`) nobody granted it.
- **No `hoverSource` on `image`.** A hover swap is CSS the handle already expresses, and
  every block prop is permanent.
- **`linkHrefSchema` strips whitespace and C0 controls before testing the scheme**, because
  `java\tscript:` navigates exactly like `javascript:`. A `.nvtheme` from a stranger is a
  way into that field.

## Verified

`pnpm --filter @nodevo/web test` — 499 pass (23 files), including the 21 new ones.
Typecheck, lint and build clean for `@nodevo/web` and `@nodevo/contracts`.

Then checked in the running app, because green tests have missed UI bugs here before:
the field renders on a LEAF block (`articleIndex`, which the variant picker refuses), the
input filters illegal characters as you type, the value round-trips through the API into
`ncf_layouts.document` in the DRAFT only, and the rendered preview carries
`<a class="nv-image__link" href="/forum" rel="noopener noreferrer">` inside a `.nav-tile`
wrapper with `display: contents`. Test edits were reverted; the dev draft is byte-identical
to its pre-session state.

## ⚠ Two pre-existing failures found, NOT caused by this work, NOT fixed

Both are in `plugins/official/nodevo-shoutbox` (git-ignored) and both fail `pnpm typecheck`,
so `pnpm backbone:check` cannot go green until they are dealt with:

- `web/blocks/ShoutboxBlock.tsx:39` — `editorMeta.description` is not in `BlockDefinition`.
  Either drop the line or add `description?: string` to the registry type.
- `web/components/ShoutboxWidget.tsx:285` — `outlet` is referenced but `ShoutboxWidget()`
  takes no props. A leftover from when the widget was an outlet contribution rather than a
  block; `const isAside = outlet === "aside"` never compiles.

Separately, adding an Image block with no `source` yet renders "Block image failed to
render" in the preview: `resolveImageSource(undefined)` throws once the schema parse fails.
Pre-existing, harmless, but it is the first thing an admin sees after adding the block.


---

# Part 2 — the theme's stylesheet gets a layer, and a stranger's gets hardened

Step 2 started as "add draft→publish staging to custom CSS" and the premise turned out to
be wrong. Custom CSS was the one channel of four that a `.nvtheme` did **not** layer:

| Channel | Before | Now |
|---|---|---|
| Tokens | own layer, staged, merged under the admin | unchanged |
| Layouts | own baseline, staged, customised templates kept | unchanged |
| **Custom CSS** | **overwrote the admin's keys, live** | **own layer, staged, emitted under the admin's** |
| Assets | own directory per theme id | unchanged |

So importing a theme **destroyed whatever CSS the admin had written** — no baseline
recorded (unlike a layout), nowhere else to live (unlike a token), and applied live so it
happened before anyone had looked. A package carrying only `custom-light.css` blanked
their **dark** stylesheet too, because both admin keys were always written together.

Two more things were simply missing, found while building this:

- **A theme's `url(assets/…)` was never rewritten.** Documents get `rewriteAssetRefs`;
  stylesheets got nothing, so every image a theme shipped through its CSS resolved against
  `/api/appearance/css` and 404'd. Export had the mirror hole.
- **`publishDraft` returns early when nothing is pending**, and `getDraftStatus` did not
  look at the staged stylesheet — so a package carrying `styles/custom-*.css` and no
  `tokens.json` would have staged CSS that could never be published.

## Files

| File | Purpose |
|---|---|
| `apps/api/src/modules/themes/themeCss.ts` | **New.** `assertThemeCssSafe` (refuses `@import` and remote `url()`), `rewriteThemeCssUrls`, `collectCssUploadRefs`, `toPackageCssUrls`. |
| `apps/api/src/modules/appearance/appearance.service.ts` | The layer: 4 new keys, `getThemeCustomCss` / `getThemeDraftCustomCss` / `saveThemeCustomCss` / `recompileCustomCss`; `compileCustomCss` now emits theme-then-admin; `publishDraft` promotes it on its OWN staged-ness; `getDraftStatus` counts it; `resetAppearance` keeps it. |
| `apps/api/src/modules/appearance/appearance.routes.ts` | `GET /custom-css` returns the admin layer **plus a separate `theme` field** — merging them would make the console save the theme's CSS as the admin's own. |
| `apps/api/src/modules/themes/theme.service.ts` | Import validates before writing and stages into the theme layer; export carries the EFFECTIVE stylesheet and packs its images. |
| `apps/web/src/features/admin/pages/StyleEditorPage.tsx` | Reads the theme layer separately; the console says a theme stylesheet sits underneath. |
| `apps/web/public/locales/*/acp.json` | `styleEditor.cssThemeLayer`. |
| `apps/api/src/modules/appearance/themeCssLayer.test.ts` | **New**, 10 tests against the real DB: emission order, publish, draft-status, reset. |
| `apps/api/src/modules/themes/theme.service.test.ts` | 9 new tests + one rewritten (it asserted the bug). |
| `docs/theme-packages.md` | The stylesheet layer, and what a theme's CSS may and may not do. |

## ⚠ What is permanent here

- **Emission order IS the inheritance.** Both layers are scoped to the same root, so equal
  specificity is decided by source order — the admin's stylesheet must stay last.
- **`GET /custom-css` must never return the layers merged.** The console writes back what
  it reads; merging would store the theme's CSS as the admin's own and leave the next
  update nothing to inherit. Exactly the trap `/tokens` already documents.
- **Every writer of either layer must go through `recompileCustomCss`.** The served blob
  is one cached setting on a public hot path; a publish that skipped it would leave the
  site on the previous stylesheet.
- **The hardening is a DENY of reaching off-site, not a safety guarantee.** CSS can still
  lay a fixed-position element over a button. Staging is the answer to that, and it is why
  the stylesheet now arrives in the draft.

## Verified

API 200/200 (18 files), web 499/499 (23 files); typecheck, lint and build clean for api,
web and contracts.

Then end-to-end against the running server: a theme-layer row reaches
`GET /api/appearance/css` correctly scoped (`:root:not([data-theme="dark"])`), and with
both layers present the theme's rule is emitted at line 15 and the admin's at line 17 —
theme first, admin second. Both verification rows were removed and the compiled cache
rebuilt to empty, which is its correct resting state.


---

# Part 3 — the class contract, and a shipped bug it exposed

Step 3 was scoped as "document the classes blocks already emit and guard them". Half that
premise was wrong: only `coreBlocks.tsx` uses the `nv-` prefix. The blocks decomposed out
of existing pages kept those pages' names (`ghero__`, `mp-`, `profile-`, `ac__`), and a
survey that rendered all 60 registered blocks found that **most emit no root class at
all** — they render into their parent's markup and resolve their content from host
context. So for roughly fifty blocks there was nothing for a theme to select.

That matters specifically for a DOWNLOADED theme: `className` is per instance and only an
admin can set it, so a theme that does not control the site's layouts had no hook.

## What was added

**`nv-b--<type>` on every block**, derived from the registry key and stamped by the
renderer on the same `display: contents` wrapper as the variant and the handle. Free,
uniform, and available to a plugin's blocks without the plugin doing anything. A dotted
plugin type is flattened for the selector: `forum.recentThreads` → `.nv-b--forum-recentThreads`.

This is the one thing invented rather than documented, and it is invented because without
it the contract does not exist for most of the catalogue.

Side effect worth having: the wrapper is now unconditional, so **the live DOM finally
matches the editor preview's shape**. It did not before — the preview wrapped every block,
the live site only a styled one — so CSS written while looking at the preview could break
on publish, which is the worst possible place for that difference to live.

## ⚠ The bug this exposed — shipped, user-visible

`coreBlocks.scss:76` was `.nv-columns > .nv-column`. Every block is wrapped, and
**selectors match the DOM, not the box tree**, so the moment an admin gave a column a
style variant the wrapper landed between the row and the track and that rule stopped
matching. Its own comment says what it prevents: *"A stacked track is full width and must
not stick, or a rail would pin itself over the content it used to sit beside."*

So on a phone, a styled column kept `position: sticky` and its desktop width — a rail
pinned over the content it was supposed to stack under. Present since variants shipped;
step 1's `className` widened it. Now a descendant selector, which is also the more correct
rule (every `.nv-columns` is stacking at that width, nested ones included).

Verified against the LIVE stylesheet, not just the source: the rule in the browser is
`.nv-columns .nv-column` under `(max-width: 640px)`, a real sticky rail **matches** it, and
the same rail does **not** match the old `> ` form.

I swept every `>`, `+` and `~` in the web SCSS: this was the only one crossing a block
boundary. The rest sit inside a single component's own markup.

## Files

| File | Purpose |
|---|---|
| `packages/contracts/src/layout.ts` | `blockTypeClass()`. |
| `apps/web/src/layout/LayoutRenderer.tsx` | The wrapper is unconditional and carries the type class. |
| `apps/web/src/layout/blocks/coreBlocks.scss` | `.nv-columns > .nv-column` → descendant, with the reason. |
| `apps/web/src/layout/classContract.test.tsx` | **New**, 8 tests: the type class on every registered block, one shared wrapper, live-DOM-matches-preview, the root-class table, and a static sweep that fails if any SCSS aims a combinator across a block boundary. |
| `apps/web/src/layout/{variants,blockHandles}.test.tsx` | Two assertions updated — both said "no wrapper when unstyled", which is now deliberately false. |
| `docs/theme-packages.md` | The class contract: the three tiers, the root-class table, the combinator warning. |
| `docs/plugin-blocks.md` | Plugin blocks get the type class free; their own class names AND their block type are now a public contract. |

## ⚠ What is permanent

- **A block's TYPE is now a compatibility surface.** Renaming it renames its class and
  breaks any theme targeting it — the same commitment as renaming a prop.
- **No combinator may cross a block boundary**, ever, in core or in a plugin. Guarded.
- The **root-class table** in `classContract.test.tsx` and the table in
  `docs/theme-packages.md` must change together.

## What is deliberately NOT promised

The classes *inside* a block (`.ghero__title`, `.mp-list`, `.ac__excerpt`) are real and
stable in practice but are not covered by the guard, and their prefixes are inconsistent
for the decomposition reason above. Documented as "current behaviour, not a promise", with
the advice to scope through `nv-b--<type>` or a handle. Renaming them into one namespace is
a separate, mechanical change worth doing only if it is worth the churn — it was not folded
in here, because a 200-class rename inside a step scoped as "write down what exists" is how
a contract acquires bugs.

## Verified

Web 507/507 (24 files), API 200/200; typecheck, lint and build clean across web, api and
contracts. In the running app: 27 blocks on the home page, every one carrying its type
class, every wrapper computing to `display: contents`, and the three-column home layout
unchanged.

---

# Part 4 — distribution plumbing

Step 4: the marketplace can now SELL a theme, and the ACP can browse and install one.
Three pieces, in the order they depend on each other — `kind` through the catalogue read
path, a Themes tab in the ACP, and `screenshot` end to end.

The two repos move together; the marketplace half is in `~/Development/nodevo-marketplace`.

## `kind` — much of it already existed

`Product.kind`, `/catalog?kind=`, `authorizeDownload`'s `kind`, and an artifact path that
already knew about `.nvtheme` were all in place from an earlier session. What was missing
was on the INSTANCE side: `fetchCatalogPage` hardcoded `kind: "plugin"`.

⚠ **Removing that hardcode is not a one-line change.** The same helper backs
`refreshPaidPluginIds`, whose output — `marketplace.paid_plugin_ids` — is read by the
PLUGIN enable gate, which asks "is this id in the paid set?" and has no idea what kind an
id belongs to. A defaulted `kind` would quietly fill that set with paid THEME ids. So
`fetchCatalogPage` takes `kind` as a REQUIRED parameter: the two callers want opposite
halves of the catalogue, and there is no sensible default for both. Pinned by a test.

## One download gate, two intakes

`downloadAndVerifyArtifact` gained a `kind` and one branch, at the validating step only.
The gate, the transfer, the 50 MB cap, the sha256 and the rate limiter are identical for
both — the chokepoint is supposed to be ONE place, and a second endpoint would be a
second place to forget the limiter. `POST /admin/marketplace/install` takes `kind`
(default `"plugin"`), and a theme runs `themeService.importTheme` instead of the plugin
intake.

⚠ **A theme install lands in the DRAFT.** That is what importing a theme has always done
and it is correct — a theme rewrites the arrangement of every page at once. But an admin
who clicks Install and sees the site unchanged is looking at behaviour nobody told them
about, so the ACP says it twice: above the grid, and in the success dialog ("staged as a
draft. Publish it to put it live").

## `screenshot` — from the author's file picker to the listing

`screenshot` had been in `themeManifestSchema` since the format was written and NOTHING
ever produced one. Now:

1. The export dialog has a preview-image picker; the export request became multipart.
2. `exportTheme` validates it by magic bytes and packs it as `assets/screenshot.<ext>`.
3. `importTheme` rewrites `manifest.screenshot` to the upload path it landed at, so the
   ACP renders it.
4. The MARKETPLACE extracts it from the uploaded `.nvtheme` on ingest — no operator
   upload step, so the listing always shows the version actually being sold.

⚠ The name is reserved in the asset namespace BEFORE documents are walked: a page image
called `screenshot.png` would otherwise overwrite the preview silently, and the manifest
would point at a hero image.
⚠ SVG is refused for a preview (though it is a fine theme asset): the preview is rendered
by a marketplace we do not control, and SVG is the one image format that can carry script.
⚠ `tokensOnly` accepts the STRING `"true"` — multipart has no types, and
`z.coerce.boolean()` is JS truthiness, so `"false"` would coerce to `true`.

## ⚠⚠ Two bugs that passed every check and were found only by LOOKING

Both were green under typecheck, lint, 351 CMS tests and 141 marketplace tests.

1. **`Cross-Origin-Resource-Policy: same-origin`** — helmet's default. It makes a browser
   refuse to EMBED the preview anywhere but the marketplace's own origin, and every
   consumer of that route is somewhere else (an instance's ACP renders the catalogue in
   its own admin panel). It fails as a broken image with NO console error, and `curl` sees
   a perfectly good 200. The previews mount now sets `cross-origin` explicitly.
2. **`img { max-width: 100% }`** — the global rule in both apps. It clamps a full-bleed
   `width: calc(100% + 44px)` straight back to the padded content box, so the card image
   sat inset on one side and read as a layout glitch. `max-width: none` is load-bearing on
   both the ACP theme card and the storefront listing card.

## Files — CMS

| File | Purpose |
|---|---|
| `packages/contracts/src/marketplace.ts` | `screenshot` on `MarketplaceListing` — an absolute URL, because the ACP renders this catalogue on a different origin. |
| `apps/api/src/core/license-engine/marketplace-source.ts` | `kind` on `MarketplaceListQuery`; `fetchCatalogPage` takes it as REQUIRED; the paid-id walk pins `"plugin"`. |
| `apps/api/src/modules/admin/marketplace.service.ts` | `downloadAndVerifyArtifact(id, version, kind)`; new `installThemeFromMarketplace` returning the import report. |
| `apps/api/src/modules/admin/admin.controller.ts` | `kind` on the browse query, the authorize body and the install body; the install route branches on it. |
| `apps/api/src/modules/themes/theme.service.ts` | `readManifest` extracted; `validateOnly` for the download gate; screenshot packed on export and repointed on import. |
| `apps/api/src/modules/themes/theme.routes.ts` | Optional `screenshot` upload on export (multer directly — `uploadSingle` 400s on a missing field); boolish `tokensOnly`. |
| `apps/web/src/lib/api.ts` | `apiStream` passes FormData through without overwriting its multipart boundary. |
| `apps/web/src/features/admin/pages/MarketplacePage.tsx` | Plugins / Themes tab bar, theme cards with screenshots, theme-aware install and invalidation. |
| `apps/web/src/features/admin/pages/ThemeExportDialog.tsx` | Preview-image picker with a live thumbnail (object URL revoked on change). |
| `apps/web/src/features/admin/pages/ThemesPage.{tsx,scss}` | Export posts multipart; the installed theme shows its own screenshot. |
| `apps/web/public/locales/*/acp.json` | Tab labels, the draft note, the staged-install message, the preview-image field. Five locales. |
| `…/theme.service.test.ts`, `…/paid-ids-freshness.test.ts` | 8 new tests: the screenshot round trip, the name collision, the SVG refusal, and the kind-per-caller trap. |

## Files — marketplace (`~/Development/nodevo-marketplace`)

| File | Purpose |
|---|---|
| `prisma/schema.prisma` + `20260829204246_product_screenshot` | `Product.screenshotPath`. |
| `src/modules/catalog/ingest.service.ts` | `extractPreview` — pulls the screenshot out of an uploaded `.nvtheme`, magic-byte checked, basenamed, bounded. Best-effort: never fails a release over a picture. |
| `src/app.ts` | Public `/media/previews` static mount (deliberately NOT the upload root — its sibling `artifacts/` is token-gated) with nosniff, sandbox CSP and `CORP: cross-origin`. |
| `src/modules/catalog/{catalog,listing}.routes.ts` | `previewUrl()` and `screenshot` on the catalogue and the detail payload. |
| `web/src/pages/ThemeDetail.tsx`, `web/src/components/ListingCard.{tsx,scss}` | The real screenshot when there is one; the mock gradient stays as the fallback. |
| `src/modules/catalog/ingest.e2e.test.ts` | 5 new tests: extraction, no-screenshot, traversal, non-image, and that `artifacts/` is still not served. |

## Verified in the browser, not only in tests

The whole loop, against four local servers: export a package with a preview → publish it
to the marketplace as a theme → the extractor stores and serves the image → the ACP
Themes tab shows it → Install runs the gate and stages a draft → the card flips to
"Installed" and Appearance → Themes shows the theme with its own thumbnail.

CMS 210 API + 507 web; marketplace 141. Typecheck, lint and build clean on both repos.

---

# Part 5 — chrome bands and section backgrounds

A masthead row — logo one side, something the other — as a band SEPARATE from the
navbar, whose order the admin controls. Plus a background for it: an uploaded image,
a gradient of up to three picked colours, or both.

## Why two regions rather than a second template

`chrome.header` WAS the navbar: one band, three regions (`left | center | right`),
rendered as a single `<nav>` with three flex zones. Those regions are horizontal by
construction, so there was nowhere to stack a second row.

The alternative — a ninth core template plus a setting saying which comes first — puts
ARRANGEMENT outside the layout document, which is the one place this system answers
every other ordering question. So `chrome.header` gained two regions instead, named by
POSITION: **`bandAbove`** and **`bandBelow`**, wrapping the nav strip.

- Ordering is "which region is it in". Dragging one `section` from `bandAbove` to
  `bandBelow` swaps the masthead and the navbar; `moveBlock` already takes a region.
- A site may run BOTH — a utility strip above and a masthead below.
- **Purely additive**: a document that predates them has no such key, so there is no
  migration, no packaged theme breaks, and nothing renders until someone uses one.

⚠ `PubNav` is now a `<header>` wrapping the bands and the `<nav>`. A masthead is site
identity, not navigation — inside `<nav>` it would tell a screen reader a logo and a
tagline are links.

⚠ The band DISSOLVES the region wrapper (`display: contents`) so a `section width:
full` can actually span. That makes `section` the authoring unit for a band, which is
the right pairing: it is the block that paints, so it is where the background lives.

## The background, on `section`

Three permanent props, on the block that paints rather than on a header-specific one —
a masthead, a hero and a CTA strip are the same thing wearing different content.

- `backgroundImage` — an upload path or URL, `meta({ asset: true })`.
- `backgroundGradient` — up to 3 stops.
- `backgroundAngle` — degrees.

Image and gradient COMPOSE rather than exclude: CSS layers the image over the
gradient, so either alone works and both together gives the gradient as the ground a
transparent PNG sits on.

⚠ `backgroundImage` must stay a TOP-LEVEL string prop — `assetPropsOf` reads the
schema's own properties for the flag, so folding it into a nested `background` object
would silently stop it travelling inside a `.nvtheme`.

⚠ `cssColorSchema` is strict (hex / rgb() / hsl() / `var(--token)`) because these
values are composed into a `linear-gradient(...)` and a document is untrusted twice
over — an admin types one, a purchased theme ships others. `var(--token)` is
deliberately allowed and is what a THEME should use: it follows the palette and both
light and dark, which a picked hex cannot.

New: `POST /admin/layouts/images` (random filename, magic-byte-checked), the
`LAYOUT_IMAGE` limit, and `layouts/` added to BOTH upload allowlists.

## ⚠⚠ Three bugs found only by LOOKING — all green under every check

1. **Two React siblings shared a key.** `BlockStyleFields` already keyed on
   `selected.node.id`; the new `BlockBackgroundFields` was given the SAME key in the
   same parent. React warns and, as it documents, DUPLICATES — the panel doubled on
   every edit until the rail held eight copies. Nothing in the saved document was ever
   wrong, so only the browser showed it. Key is now namespaced (`bg:${id}`).
2. **`ALLOWED_UPLOAD_DIRS` exists TWICE** — one in `app/app.ts` deciding what
   `/uploads` SERVES, one in `LocalStorageProvider.ts` deciding what may be WRITTEN.
   Adding the dir to the serving list alone got a 403 on upload. Both now say so.
3. **The orphan-purge job would have deleted every background.** `ROOTS =
   ALLOWED_UPLOAD_DIRS`, and `collectReferenced()` read users, groups, logos, articles
   and pages — never `ncf_layouts`. A `layouts/` file is referenced ONLY from a
   document, so adding the directory made its whole contents orphans, deleted on a
   schedule weeks later. Added `refsInLayouts()`, which needs its OWN matcher: a
   layout stores a BARE relative path (`layouts/a.png`), not the `/uploads/` URL an
   article body stores. Verified with the job's real dry run — the referenced file is
   skipped as REFERENCED, not merely as young.

## Files

| File | Purpose |
|---|---|
| `packages/contracts/src/layout.ts` | `bandAbove`/`bandBelow` on `chrome.header`; `cssColorSchema`; the three `section` background props. |
| `apps/web/src/layouts/PubNav.tsx` | `<header>` + `ChromeBand`, rendered only when the region holds something. |
| `apps/web/src/layouts/AppLayout.scss` | `.pub-head` / `.pub-band`, with the region dissolve. |
| `apps/web/src/layout/blocks/coreBlocks.{tsx,scss}` | `sectionBackground()` composer + `SectionBlock`; `--bg` sizing rules. |
| `apps/web/src/features/admin/pages/BlockBackground.tsx` | The panel: upload, up to 3 colour rows, direction, live preview. |
| `apps/web/src/components/SchemaFields.tsx` | `omit` — hand a prop back to a caller with a purpose-built control. |
| `apps/web/src/features/admin/pages/LayoutEditorPage.{tsx,scss}` | Mounts the panel (namespaced key); `.lay-bg` styles. |
| `apps/api/src/modules/layouts/layout.{routes,controller}.ts` | `POST /admin/layouts/images`. |
| `apps/api/src/config/upload-limits.ts`, `app/app.ts`, `infrastructure/storage/LocalStorageProvider.ts` | `LAYOUT_IMAGE`; `layouts` on both allowlists, with the two-lists trap documented. |
| `apps/api/src/jobs/scheduled-actions/purgeOrphanedUploads.ts` | `refsInLayouts()` — the fix for bug 3. |
| `apps/web/public/locales/*/acp.json` | Panel strings + the two region labels. Five locales. |
| `apps/web/src/layout/sectionBackground.test.tsx` | 16 tests: composition order, the schema's refusals, the bands. |

## Verified in the browser

Added a section to `bandAbove`, gave it a two-stop gradient at 90°, watched it render
above the nav; moved it to `bandBelow` and watched it flip below; uploaded an image
through the picker and saw it layer over the gradient, full-bleed.

CMS 210 API + 523 web. Typecheck, lint and build clean.

## Part 5b — making the band a real masthead

Three follow-ups so a band reads as part of the page rather than a strip bolted above it.

**`section.minHeight`** (px, 0 = auto). A MINIMUM, not a fixed height: a masthead is
given a height for presence, but a fixed one clips — a bigger accessibility font, a
taller logo, a wrapped line. A floor looks identical and cannot hide content. A section
with a floor CENTRES its content vertically, which is the only arrangement anyone wants
from a band taller than what is in it.

**`.nv-section__inner`** — the content column. A `width: full` section spans the
viewport so its BACKGROUND does, but its CONTENT belongs in the page's rail; a masthead
logo hard against the window edge with the nav logo inset below it is exactly what makes
a band look bolted on. The inner's `max-width` / `margin-inline` / `padding-inline`
MATCH `.nv-region` and `.pub-nav__inner` deliberately — measured in the browser, the
masthead logo and the nav content below it both land at x=147.
- ⚠ The wrapper is UNCONDITIONAL. A DOM shape that changed with the width prop would
  break custom CSS the moment an admin narrowed a band — the same class of failure as a
  combinator crossing a block boundary.
- ⚠ Its `--full` rules are declared AFTER `--pad-*`: the pad classes set the `padding`
  shorthand, so zeroing the inline half has to win on source order (equal specificity).

**The logo is sized by CSS, not inline.** `NavLogo` hardcoded `height: 32` — the same
block now sits in the nav strip AND in a 250px band, where 32px is a favicon. It is now
`--nv-logo-h` (32px default, 64px in a band), which is also the codebase's own rule
about visual values living in tokens.
- ⚠ `.pub-nav__logo` was nested inside `.pub-nav` in SCSS, so the logo block rendered
  UNSTYLED in a band. Its rules are top-level now — a block placeable in five regions
  cannot have its styling scoped to one of them.

`showWordmark: false` was already the "image, no text" switch; nothing new was needed
for that half.

Verified in the browser: a 250px band above the nav, gradient background, site logo
image at 64px on the left, its left edge pixel-aligned with the nav content below it.
Web 527 (25 files).

## ⚠⚠ Part 5c — the `<header>` wrapper broke the sticky navbar site-wide

Introducing `<header>` around the nav strip (so the bands had somewhere to live) made
that wrapper the navbar's **containing block**. `position: sticky` is constrained by its
PARENT's box, not by the viewport — and the header is only as tall as the chrome. The
navbar stuck for ~48px of scroll and then travelled off the top of **every page on the
site**.

Green under typecheck, lint and 738 tests. Measured in the browser: `navTop: -268` at
`scrollY: 316`.

Fixed with `.pub-head { display: contents; }` — the same idiom the region and variant
wrappers use. The box dissolves, the bands and the nav go back to being direct children
of `.app-layout`, sticky spans the page exactly as before, and the `<header>` element
stays for semantics.

Guarded by a static assertion in `classContract.test.tsx` (verified to FAIL when the
declaration is removed): jsdom performs no layout and cannot scroll, so the test asserts
the fix rather than the symptom.

Re-verified after the fix: `navTop: 0` at `scrollY: 480`, band still 250px, masthead
logo still pixel-aligned with the nav content at x=147.

**Rule worth keeping: wrapping an existing element changes what `position: sticky` can
travel within.** Nothing in the type system or the test suite can see it.

## Part 5d — an empty region could not be clicked

Reported as "I can't click the header block". Not a click-handling bug: preview clicks,
tree clicks and the selection ring all worked. The band **had nothing to click**.

A masthead band renders nothing until it holds a block, so "the header" was a thing an
admin could see in the tree, could not see on the page, and had nowhere to click. Every
empty region had the same gap — `LayoutRegion` returns null when empty — the band just
made it obvious, because a header is the one region people expect to configure before
putting anything in it.

**An empty region now renders a placeholder IN THE EDITOR ONLY** (`isLayoutPreview()`):
a dashed strip naming the region. It carries `data-nv-region`, so it was already a legal
drop target, plus `data-nv-empty`, which the bridge reads to post a new `addTo` message —
the editor opens the SAME add-block picker the region's `+` opens (`r:<region>`), so
there is one picker and one code path whichever surface asked.

⚠ **The `display: contents` dissolve bit twice.** Both `.pub-nav__zone > .nv-region` and
`.pub-band > .nv-region` dissolve the region wrapper so blocks lay out as direct
children. That also dissolves the placeholder, leaving only its label's text clickable —
so a real click in the middle of an empty band still hit nothing, while a synthetic click
on the label worked. Both now re-assert a box for `.nv-region--empty` (a chip in the nav
strip, a full-width strip in a band). **Found only by clicking with a real mouse; a
dispatched event went straight to the label and looked fine.**

Region labels are humanised locally (`bandAbove` → "Band above") rather than translated:
the preview is the SITE with the bridge injected, and the site does not load the ACP
translation namespace, so a lookup would print the raw key on the one surface that shows it.

Guarded by two tests: the placeholder is absent without `__layout=draft`, and present
with it carrying both data attributes. `LayoutRenderer.test.tsx`'s region-order case now
asserts all SIX declared regions of `article.detail` in order — it was named "six" and
asserted four, because the empty two rendered nothing.

Verified with real mouse clicks: both bands show a full-width strip, hover highlights,
clicking opens the picker for that region, and the live site renders zero placeholders.
Web 530 (25 files).

---

# Part 6 — one region set: header / body / aside / footer

The region set had grown by accretion — three navbar zones, three footer slots,
`beforeBody`/`afterBody` on one template, and the two `band*` regions I had just added
for a masthead. Each was defensible alone; together, "where does this go?" had a
different answer per template and the names promised landmarks the markup did not emit.

**Every template is now the four HTML5 landmarks**, and `LayoutRegion` emits the real
elements (`<header>`, `<aside>`, `<footer>`; `main` stays a `<div>` because `AppLayout`
already owns the one `<main>` a document may contain).

**The navbar is a BLOCK inside the header**, because a navbar is part of a header —
which is what a header is. `chrome.header` and `chrome.footer` have one region each.
Ordering a masthead above or below the nav strip is now ordering blocks in a list,
which is what the two bands existed to fake.

**`align` replaces the navbar's three zones** — a node-level field beside `variant`,
`className` and `visibility`, for the same reason those are node-level: a navbar is
exactly where a PLUGIN's block wants to be placeable, and a prop threaded through 52
components would be honoured by core and ignored by everything else. The start of the
row is the ABSENT case, never stored.

## The migration is the point

An unknown region is KEPT and skipped by design ("disabling a plugin must never delete
an admin's layout"). So without a carry-over, a site that had ever saved a layout would
keep every navbar block in its document and simply stop rendering them — no error, no
missing row, just a site with no navigation. `regionConsolidationMigration.ts` runs at
boot, flag-guarded, across ALL scopes (draft and the theme baseline included — either
left on the old shape would resurrect the broken document the moment it was used).

⚠ A masthead already built in a band keeps its side of the navbar: that ordering was
the whole reason the bands existed. ⚠ `article.detail` merges in READING order —
appending `beforeBody` to the end of `main` would move an intro below the article.
Verified against the real dev database, not only in tests.

## ⚠ Traps hit while doing it

- **The sticky trap, one level down.** The header REGION is a box too, so dissolving
  `.pub-head` was no longer enough — `.nv-region--header` also needs `display: contents`,
  or the navbar sticks only until the header scrolls past. It also has to go for a
  second reason: `.nv-region` is a centred content column, and site chrome spans the
  viewport. The guard now asserts both.
- **`:first-of-type` is not "the first one that matches".** Every block wrapper is a
  `div`, so `[data-nv-align="right"]:first-of-type` matched the first child of the row
  regardless of alignment — i.e. nothing useful, and the right-hand icons never moved.
  The rule is `:not([align=right]) + [align=right]`.
- **I deleted the logo styles by accident** removing the band CSS — the slice spanned
  them. The logo then rendered as a bare `inline` anchor whose line box covered the
  whole masthead, making the entire band a link to the home page. Caught by measuring,
  not by any check.

Web 535 (25 files), API 218 (19 files). Typecheck, lint and build clean.

---

# Part 7 — the shoutbox unblock (`backbone:check` is green again)

Two pre-existing typecheck errors in the git-ignored `plugins/official/nodevo-shoutbox`
had been failing the gate since the block work started. Both are leftovers from the
outlet → block migration, and both are dead code rather than a missing feature:

- `web/blocks/ShoutboxBlock.tsx` declared `editorMeta.description`. Nothing reads it —
  `LayoutTree.tsx` renders `label` and the block's `type` as the secondary text, and no
  core block defines one. Widening `BlockDefinition` for a field the picker does not
  show would make the contract lie, so the line is gone.
- `web/components/ShoutboxWidget.tsx` referenced `outlet`, which no longer exists:
  `ShoutboxWidget()` takes no props since the outlet contribution became a block. It
  drove two values. `marginBottom` is now unconditionally 20 — a region stacks blocks
  with no gap of its own, so the block owns its bottom margin — and the message list's
  `maxHeight` is 260, the value every non-aside placement already used.

`pnpm backbone:check`: 20/20 tasks, typecheck 30/30 packages, lint 0 errors,
web 535 (25 files), API 218 (19 files).
