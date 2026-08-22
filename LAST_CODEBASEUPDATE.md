# Last Codebase Update — 2026-07-26/27 + 2026-08-09/10/13/14/15 (block layout system: nesting, audiences, all 8 templates, page decomposition, plugin-UI blocks, variants, guest landing, theme packages, style variants, theme inheritance, plugin templates + scheduled tasks; client crash screen; dependabot security triage; editor undo/redo + discard; marketplace v2 → Nodevo as a framework, ADR-0006 + licence protocol rev 2)

Sixteen parts. **Part 8 shipped on 2026-08-15** (commit `5b5920b`, PR #84, merged to main
and back-merged); everything else is still **uncommitted** — the user asked for no push
until they say so. The newest part is first; the rest read in order (-9 → 2). Each says
what it decided and why.

**Part 10 (2026-08-22)** is the marketplace v2 design session plus the two licensing
fixes it turned up. Everything else in `git status` is Parts -9 → 9.

---

# Part 10 — marketplace v2: Nodevo becomes a framework (2026-08-22)

A design session, plus the two live bugs it surfaced in the licensing path — those are
real code and ship in this push as their own commit.

| Output | Where | In git? |
| --- | --- | --- |
| ADR-0006 — the framework / application boundary | `d0cs/adr/0006-framework-application-boundary.md` | no (gitignored, like all ADRs) |
| Licence protocol v1 spec, rev 2 | published artifact | no (outside the repo) |
| Design + mockups reviewed | `~/Development/nodevo-marketplace-v2/design/` | separate directory |
| **Install identity + marketplace sync fixes** | `license-engine`, `scheduledJobs`, `updateCheck`, `workerBoot` | **yes — see "Fixed in this push"** |

## What was decided

The marketplace v2 is a **standalone Nodevo-framework application** — not a CMS plugin,
not a CMS site. Three homes were considered and the reasoning is in ADR-0006; the short
version is that a plugin-hosted marketplace has to be taught to ignore its own licence
engine, and a CMS-site marketplace carries a content model it never touches.

That forced the larger question the ADR actually settles: **Nodevo is a framework, and the
CMS is application #1 on it.** The boundary rule is *a framework package may not know what
a user, an article, or a page is*, with `@nodevo/auth` as the one sanctioned exception.

Extraction planned: `@nodevo/errors`, `@nodevo/server-kit`, `@nodevo/auth`,
`@nodevo/plugin-engine`, alongside the existing `@nodevo/contracts`. Layout blocks,
`.nvtheme`, appearance, progression and moderation stay in the CMS.

The plugin **engine** crosses into the framework; the plugin **context** does not — which
splits `@nodevo/plugin-sdk` into a generic contract plus a CMS-shaped extension. That is a
breaking change for the four official plugins and must land in the same commit as the
split. The payoff is that the marketplace gets its own plugins, with payment providers as
the first contract.

ADR-0002 is **not** superseded: it governs the marketplace *client* inside a CMS install;
0006 governs the *server*. Two of 0002's open follow-ups are closed by this work.

## Findings worth keeping (verified against the code, not remembered)

- **`@nodevo/sdk` is 143 lines** — `slug.ts` 19, `access.ts` 104, an index, the licence
  PEM. `@nodevo/ui` is one component. "Built on the Nodevo SDK" was not a true statement;
  the extraction above is what makes it one.
- **`apps/api/src/shared/` is ~1,270 lines** of small modules coupling on exactly three
  things — `env`, `prisma`, `redis`. The extraction is a DI refactor, not a rewrite.
- **`core/plugin-engine/` is 1,425 lines with zero CMS-domain coupling.** All the CMS-ness
  is concentrated in `plugin-context.ts`'s host bridge and registration methods.
- **`getSiteId()` returns `row?.siteId ?? "dev-site"`** — every install missing its
  `ncf_installs` row shares one identity. Harmless-ish as a label; a licence bypass once
  entitlements bind to `siteId`. Must throw.
- **`AuthorizedDownload.sha256` is optional**, and `marketplace.service.ts:56` fetches
  `downloadUrl` unauthenticated. The integrity check on a code-execution artifact is
  opt-in, and the URL is the credential.
- **The account token never expires or rotates** — written once at connect, read forever.
  Weaker than the platform's own §43 auth, on the higher-value credential.
- **Two daily licence-server calls, both fixed wall-clock**: `scheduledJobs.ts:57`
  `license-refresh` at `0 2 * * *` and `:64` `update-check` at `30 2 * * *`. Every install
  on earth fires in the same minute, twice.

## Protocol decisions (spec rev 2)

- **Entitlements bind to `siteId`, not the hostname.** Domain becomes reported metadata.
  Rebrands, migrations and host moves stop generating support tickets; the cap counts
  installs, which is what is actually sold; clone detection improves rather than degrades.
  Request signing (Ed25519, key registered at connect) is what makes `siteId` trustworthy
  enough to carry the binding — the two are a package.
- **Six endpoints, not seven.** `/activate` (raw key) is dropped for want of legacy rows;
  standalone token rotation is dropped because the heartbeat already carries it.
- **The two daily jobs merge into one jittered heartbeat** keyed on `hash(siteId)`.
- **Per-entitlement objects** carrying `updatesUntil` / `maxVersion`, so a perpetual
  licence with lapsed updates is distinguishable from a dead one.
- **`sha256` mandatory; download URLs single-use, 5-minute expiry.**
- **`refreshAfter` 15d → 7d**, putting worst-case revocation latency at 37 days. No kill
  switch — it would reintroduce the bricking the grace rule exists to prevent.

## Fixed in this push

Three of the findings above were live bugs, not v2 prerequisites, so they are fixed now
rather than waiting on the framework work.

**`getSiteId()` throws instead of returning `"dev-site"`.** New NEC code
`LICENSE_SITE_ID_MISSING` (`NEC-LICENSE-9010`) with error-reference entries in all five
bundled locales. `marketplace-source.disconnect()` catches it deliberately — its own
contract is that a disconnect works even when everything else is broken, so a missing
identity now means "the server cannot be told", exactly like an unreachable marketplace.

**The marketplace sync default time is spread per install.** New `jitterDefault` flag on
`ScheduledJobDef`; `getJobConfig` shifts the default daily time by
`sha256(siteId + jobKey)` across the full 24h. Seeded rather than random so BullMQ does
not rewrite the scheduler on every boot, and an admin-set time is never touched. A missing
install identity falls back to the code default — spreading load must never be able to
leave a job unscheduled, which is why it reads the siteId directly rather than through the
now-throwing `getSiteId()`.

**`license-refresh` merged into `update-check`, now "Marketplace sync".** Two jobs thirty
minutes apart were two wake-ups and two calls for one exchange. The refresh runs first and
unconditionally, because `processUpdateCheck` returns early without an account token while
manual-key licences still refresh through `/activate`. Criticality moved with it in
`jobFailure.ts`. The boot one-shot deliberately stays update-check only: `refreshLicense()`
has no `refreshAfter` guard, so the full sync there would hit the licence server on every
worker restart.

⚠ Retiring a scheduled job does **not** unschedule it — `applyJobSchedule` only removes a
scheduler for a job that still exists and is disabled, so a deleted definition leaves its
Redis repeat entry firing forever into a queue with no worker. Hence `RETIRED_SCHEDULERS`
+ `removeRetiredSchedulers()`, run at worker boot. Drop the entry once every install has
booted past this release.

13 new tests across `scheduledJobs.test.ts` and `license-engine.test.ts`. The `getSiteId`
guard was mutation-tested: restoring the fallback fails three of them.

## Still open

Versioning strategy for the framework packages; `@nodevo/auth`'s principal shape;
whether the marketplace ever leaves the monorepo; the `plugin-sdk` split naming; whether
Prisma is a framework or an application decision. All five are pinned at the foot of
ADR-0006. Unrelated and still open from earlier sessions: the SSR/prerender call for the
storefront (recommendation on record: prerender detail routes only).

---

# Part 9 — layout editor UX: an undo stack, a way out of a draft, a usable picker (2026-08-15)

Autosave quietly removed the escape hatch every other editor has. There is no "don't
save" any more: a drag that drops a block into the wrong column is persisted before an
admin has finished regretting it, and the only two exits were Publish it or Reset — and
Reset goes all the way back to the code default, taking the published layout with it. An
admin who wanted to abandon an afternoon's experiment would lose what they had already
shipped. Two things closed that.

## Undo/redo

`features/admin/pages/useLayoutHistory.ts`. The stacks hold **whole documents**, not
inverse operations: a page is tens of nodes, the tree ops are already pure, and a
snapshot cannot drift out of sync with the thing it claims to undo — which an inverse-op
log does the first time an operation is added without its inverse. Bounded at 50 entries
because the editor is long-lived.

- **Selection travels with the snapshot.** Undoing a delete and then having to hunt for
  the block in the tree is most of the value gone.
- **Coalescing.** The props panel fires an update per keystroke; an undo step per
  character would bury the structural edits an admin actually wants to reach. Edits
  carrying the same `coalesceKey` within 900ms extend one step — the entry already on the
  stack is the state from before the burst began, which is what an undo should restore.
  `updateProps` keys per block; drags and deletes never coalesce.
- **Refused edits are not steps.** The tree ops return the input unchanged when they
  refuse (a cycle, a depth breach), and recording one would spend an undo doing nothing,
  which reads as a broken undo rather than a refused drag.
- **The stacks live in refs, not state.** A held-down Ctrl+Z fires repeats faster than
  React re-renders; reading the stack from state makes every repeat after the first act
  on the same stale array. There is a test that does three undos inside one `act()`.
- Cleared where the document changes identity (template/variant) or is replaced wholesale
  by the server (reset, revert-to-theme, discard, theme import) — but **NOT** on a plain
  refetch. That query refetches on window focus, so clearing there would make alt-tabbing
  away throw the stack away.

## Discard

`POST /admin/layouts/:key/discard` already existed, fully implemented and variant-aware,
with **zero callers** — the API could throw a draft away and the editor had no button for
it. Now wired, with a confirm dialog, disabled rather than hidden when there is nothing
pending (matching Publish; a control that vanishes teaches an admin less than one that
greys out).

## Three things found on the way

- **`dirty` was a latch only a save could clear.** Undo-back-to-original is the most
  ordinary gesture there is, and it would have left the toolbar claiming unsaved changes
  over a document identical to the stored one — while autosave, comparing properly,
  correctly declined to write anything. It is now COMPARED in `commitDoc` against a
  `savedJsonRef` baseline, updated from the seed and from what a save actually WROTE (not
  from whatever the editor holds when the response lands). The bug predated undo — drag a
  block away and back and the status stuck — undo just makes it the normal path.
- **`removeNode` could not clear a selection pointing into a deleted subtree.** It checked
  the pre-removal tree, where every descendant still resolves, so the only selection it
  could ever clear was the removed node itself — the one case the `s === id` fallback
  already covered. It reads `docRef` now, which `commitDoc` has already advanced.
- **Keystrokes do not cross an iframe boundary**, and the preview is exactly where blocks
  get dragged into the wrong place. `previewBridge` forwards the chord as intent
  (`{type:"shortcut", action}`); the editor owns the stacks, as it owns the document.

## One definition of the chord

`layout/editorShortcuts.ts` — `shortcutFor()`, shared by the editor and the bridge.
Deciding "is this an undo" separately in each is how the two drift. Ctrl/Cmd+Z, Ctrl+Y
and Ctrl+Shift+Z; Alt excluded rather than ignored (a distinct chord on several layouts);
`null` while a text field has focus, so correcting a typo in a heading does not instead
revert the block's arrangement. ⚠ The contenteditable check consults the ATTRIBUTE as
well as `isContentEditable` — jsdom implements neither the property nor the
`contentEditable` reflection, so a property-only check is untestable and silently passes
everything in a headless environment.

## The block picker: search + grouping

A flat button list, written when there were a handful of blocks. There are **56 with
`editorMeta` now** and a template routinely offers around thirty, which is more than
anyone reads. No new metadata was needed — `editorMeta.category` was already on every
block, rendered as a subtitle on each row where it did nothing but repeat itself.

- **Four groups in build order**, not alphabetical: structure → content → data → plugin.
  It follows how a page gets made, which beats the alphabet for the one list read top to
  bottom. **Alphabetical WITHIN a group**, because registration order is an accident of
  which file imported first and is findable by nobody.
- **Search matches the label AND the type.** A theme author who knows a block is
  `profileStats` should not have to work out its UI name — and the type is now the row's
  secondary text (replacing the category, which names the group instead), so what is
  displayed is what is searched. Plugin blocks show their `pluginId` there instead.
- **Keyboard-first.** The field takes focus on open (the `+` was already clicked, so the
  next act is choosing, not aiming); ↑/↓ walk the results and wrap; Enter commits;
  Escape closes without adding. Adding a known block is three letters and Enter.
- ⚠ **The cursor indexes the FLATTENED list while the eye reads a grouped one**, so the
  flat index is assigned while the groups are built rather than recovered afterwards with
  an `indexOf` per row — which would be quadratic and, worse, a second opinion about what
  "next" means. The pointer moves the cursor too, so there is only ever one highlighted
  row and Enter always commits the one being looked at.
- The list scrolls at 320px rather than the panel growing: a thirty-block picker that
  expands to fit pushes the tree — and the preview beside it — down the page on every `+`.
- Two distinct emptinesses are worded apart: nothing may be placed here at all, versus
  nothing matches what was typed. Telling someone with a typo that no blocks are
  available sends them after the wrong problem.
- ⚠ jsdom does not implement `scrollIntoView`; keeping the cursor in view is an optional
  call, or every test that opens the picker throws.
- ⚠ Still English-only: `editorMeta.label` is a literal on the block definition, so the
  picker's rows are untranslated in every locale. Pre-existing (the tree has always shown
  the same literals) and unchanged here — fixing it means a label KEY per block.

## The variant picker only offered pages that were already live

User-reported: creating a custom page and going to lay it out offered nothing but
"Default — all pages". The picker asked the API for `status: "published"`, and **every
new page starts as a draft** — so the one page it was created to arrange was the one
page it excluded. A page's layout is most worth arranging BEFORE it goes live.

- Filter dropped: the picker lists every custom page. Sorted by TITLE (the API orders by
  `updatedAt`, which is right for a management list and useless in a picker), and
  `staleTime` cut 60s → 5s, because the journey that arrives here is "create a page, go
  and lay it out" and a minute of cached list is a minute of the new page missing.
- ⚠ **A regression this would otherwise have introduced:** the template default's preview
  renders against `pages[0]`, and with drafts now listed that could be an unpublished
  page. `canViewPage` checks `status` BEFORE it checks the viewer, so `/p/:slug` refuses
  an unpublished page **to admins too** — the default preview would have pointed at a 404
  on any site whose most recent page is a draft. It now prefers a published page and only
  falls back to the first.
- Unpublished pages are labelled `· unpublished` in the picker, because their preview pane
  will genuinely say "Page not found" until they go live. Naming it beats letting it read
  as a broken editor. **Not changed: the rule itself.** Letting admins fetch unpublished
  pages through the public route is an access-control decision, not a picker fix.
- The list is one request deep (the API caps `limit` at 100); it now says so rather than
  quietly ending.

**And the option was misnamed, which is what actually caused the alarm.** "Default — all
pages" reads as an override; it is a FALLBACK. `resolve()` returns a page's own document
whenever it has one and only *then* consults the default, so a page that has been laid out
individually can never be moved by editing it. The user asked for the entry to be removed
on the strength of the label; the label was the bug. It is now **"Pages without their own
layout (N)"**, with the count of pages it currently reaches, plus a line under the toolbar
stating the reach outright — shown only on the fallback itself, since a page's own layout
affects exactly that page and has nothing to warn about. The one-step-resolution
alternative was offered and declined: it would have carved an exception into ADR-0005's
deliberately two-step model and cost the set-once affordance on a site with many pages.

## Concurrent editing: last write no longer wins silently

Demonstrated live during the verification above — the user was editing in their own tab
while I tested in another, and their `forum.categories` block reached my editor only by
luck of the window-focus refetch. Had we both been on the same template, one of us would
have flattened the other with no indication at all. The editor autosaves, so this is not
an edge case: it is what two admins on one site do.

Optimistic concurrency, checked **by the database**:

- `GET /admin/layouts/:key` now returns `{document, version}`. `version` is THIS
  selector's own row revision (`updatedAt`), and `null` when it has no row — a
  meaningful value, not a missing one: "there was nothing here when I started" is
  exactly the state a second tab creating the row has to invalidate.
- ⚠ **A variant that falls back to the template draft reports `version: null`.** The
  document came from another selector's row; quoting that row's revision would let a
  save built on the shared default overwrite a variant row someone else just created.
- `PUT` takes `baseVersion`. Three states, hence nullable AND optional: a timestamp
  ("I read that row"), `null` ("there was no row"), ABSENT ("do not check") — the last
  is what every internal caller uses (theme import, revert-to-theme, tests), none of
  which is racing an admin.
- ⚠ **The check is the write.** `updateMany({ where: { …, updatedAt: base } })` and
  `create()`-catching-P2002, never a read followed by a write — that split IS the race
  this exists to close.
- 409 carries the CURRENT revision, so "Keep mine" is one deliberate round trip rather
  than a re-read plus a save with a third-writer window in between. `persist: false`:
  two admins on one page is an expected outcome of a shared editor, not an error-log row.
- The editor keeps the revision, adopts the new one after every save (**without which
  the next autosave would conflict with its own previous write**), and on 409 raises a
  BANNER, not a toast — a toast that faded would leave the editor silently not saving.
  **Autosave is suspended while it is up**; a debounced writer retrying a refused write
  would hammer the endpoint and bury the one message that matters. "Load their version"
  re-reads and clears the history (it describes a document nobody is editing any more);
  "Keep mine" adopts the reported revision and writes over them, and only ever runs
  because someone picked it.

## Duplicate block

A copy of a block and everything inside it, inserted directly after the original — the
position that needs no decision from the admin — and selected, because the next act is
editing the copy and two identical rows are otherwise indistinguishable in the tree.
Goes through `insertBlock` like any other add, so the depth limit and the container's
`childTypes` still apply and a refused duplicate leaves the document untouched.

⚠ `cloneBlock` uses `structuredClone` and then re-ids **every node in the subtree**. A
spread would share nested props and the `visibility.groups` array between original and
copy, so editing one would silently edit the other; and a reused id makes selection and
every subsequent move act on whichever node the walk reaches first — the bug class
`blockTree` exists to prevent, invisible until someone drags the copy. The page's local
`uid()` is gone; `newBlockId` in `blockTree.ts` is now the single generator.

Offered on required blocks, unlike delete: the rule is that a template must never have
ZERO of one, not that it may not have two.

## `.nvstyle` merged into `.nvtheme`

They were never two formats. A style pack is `manifest.json` plus a `:root`-only
light/dark pair — a strict SUBSET of a theme package, as the theme service's own
docblock had claimed since the format was written. What actually differed was the
paperwork: a theme manifest requires `id`, `vendor`, `version` and `minNodevoVersion`;
a style pack carried only `name`. So the superset claim was true of the files and false
of the manifest, and **a `.nvstyle` would in fact have been rejected by the theme
importer**. Two ingestion paths for untrusted CSS, two `:root` validators, two staging
models, and only one of them could ever be listed on the marketplace.

- **`adoptStylePack`** fills the missing manifest fields on import (`id` derived from
  the name so two packs cannot collide on one row, `vendor` → `community`,
  `minNodevoVersion` → this version, which a pack could not have declared). ⚠ Scoped to
  packages that are unmistakably style packs — **no `layouts/`, no `tokens.json`, a
  stylesheet present**. A real theme with a malformed manifest still gets the strict
  error it deserves rather than an invented id.
- **`tokensOnly` on export** produces the palette-only kind: no `layouts/`, and
  therefore no `assets/` (the only assets an export collects are the ones layouts
  reference). Surfaced as a "Colours only" checkbox in the theme panel. This is what
  `.nvstyle` was FOR — handing someone a colour scheme without the arrangement of every
  page riding along — now an option on the one format.
- **`POST /appearance/style-packs` is GONE**, with `installStylePack`,
  `validateStylePackCss` and `stylePackError`. That is the duplication that actually
  mattered: the second place untrusted CSS entered, with its own copy of the `:root`
  rule. Read + activate + delete SURVIVE, so packs installed on a live site before the
  merge are still usable and removable rather than stranded in a table nothing reads.
  The ACP Styles page keeps the library and says where the format went — an admin who
  bookmarked it needs somewhere to go, not a control that vanished.
- **The table IS dropped** — migration `20260815205344_drop_style_packs`, after the user
  confirmed no packs exist on the live install either. That takes the rest of the
  feature with it: `listStylePacks` / `activateStylePack` / `deleteStylePack`, the three
  surviving routes, `StylesPage.tsx`, the ACP nav entry, the whole `styles` locale block
  ×5, and `NEC-CORE-8002` (nothing can throw it now) from both the code catalogue and
  the localized Error Reference.
  `/admin/styles` **redirects** to the Layout Editor rather than 404ing, following the
  `guest-home` precedent — a bookmark should land somewhere, not on a crash screen.
  ⚠ Applied with `psql` + `prisma migrate resolve --applied`, never `migrate dev`, which
  wants a destructive reset off the plugin-table drift. Fresh-DB proof is free: the API
  suite builds `<db>_test` from the migration folder and it came back green with the
  table absent.
- Docs: `docs/theme-packages.md` gains a "`.nvstyle` is this format now" section,
  `docs/API.md` marks the surviving endpoints legacy, README stops advertising the
  format, and the service docblock now states the absorption rather than a resemblance.

## Theme packaging left the Layout Editor

User's call, and the right one: a collapsed `<details>` above the editor was carrying two
things that are not editor controls. Exporting is a FORM — eight manifest fields that
were a row of unlabelled inputs competing for width with the tree and the preview.
Importing REPLACES the look of every page at once and answers with a report (templates
applied, which of the admin's own were kept, assets, unknown blocks) — and a report is
not a toast: it is the thing you read after the most sweeping change the ACP offers.

- **Export → a dialog** (`ThemeExportDialog.tsx`, opened from Appearance → Themes). Every
  field labelled, required ones marked, "Colours only" with its explanation. The dialog
  primitive takes a static `bodyNode`, so the form owns its state and pushes changes into
  a draft the caller reads on confirm — which also makes the re-ask free: the confirm
  button is not ours to disable, so an incomplete manifest RE-OPENS the dialog with
  everything still typed in, rather than being validated inline or lost.
- **Import → its own page** (`ThemesPage.tsx`, `/admin/themes`, Appearance → Themes),
  showing the installed theme and rendering the import report inline, where it stays.
- The Layout Editor keeps only **Revert to theme**, which acts on ONE template and
  belongs beside the template picker.
- `/admin/styles` now redirects to `/admin/themes` — its successor — rather than to the
  editor. The `layoutEditor.theme*` locale keys are gone, replaced by a `themes` block ×5.

## Two bugs the browser found that the server could not

Importing a deliberately broken package through the real ACP surfaced a pair that no
server-side test could see, because both are about what reaches the SCREEN.

- **The message was being thrown away.** `themeError` borrowed the generic
  `NEC-API-4001`, and `apiErrorMessage` prefers a localized string over the server's
  message whenever the code has one — `NEC-API-4001` has one: *"Please check your input
  and try again."* So every carefully composed reason ("layouts/home.json declares
  template X") was replaced with a sentence naming nothing. Theme refusals now carry
  **`NEC-CORE-8002` / `CORE_THEME_INVALID`**, deliberately WITHOUT a localized string,
  so the server's message is what an admin reads. The code re-occupies the slot the
  retired style-pack error left, beside `CORE_THEME_NOT_FOUND` — same meaning,
  generalised from `.nvstyle` to the one format.
- **What survived named nothing either.** The reports joined `issue.message` and dropped
  `issue.path`, and Zod's message for a missing required field is "Invalid input:
  expected string, received undefined" — four identical copies of it for four absent
  fields. `issueList()` prefixes the path, so it now reads `id: …; version: …;
  vendor: …; minNodevoVersion: …`, and a bad layout names both the file and the node.

Also worth recording: `MAX_BLOCK_DEPTH` is **8**, not the 5 that CLAUDE.md states — the
profile default itself nests to 6, so the documented number is stale and would have made
a duplicate at depth 6 look like a bug.

## Files

New: `useLayoutHistory.ts` + `.test.ts` (13), `layout/editorShortcuts.ts` + `.test.ts`
(11). Changed: `LayoutEditorPage.tsx` (history wiring, `docRef`/`selectedIdRef` mirrors,
`commitDoc`, discard mutation + toolbar, `closeAdd`), `LayoutTree.tsx` (the rewritten
`BlockPicker`, `TreeCtx.closeAdd`), `LayoutTree.test.tsx` (+12), `LayoutEditorPage.scss`
(`&__history`, picker search/group/active styles), `layout/previewBridge.ts` (shortcut
forwarding), `acp.json` ×5 (undo, redo, discard, discardTitle, discardBody, discardDone,
searchBlocks, noMatches, category.* — FR undo is "Annuler la dernière action" because
Cancel is already "Annuler" and the button is icon-only).

## Verified

`pnpm backbone:check` green, exit 0: 19 typecheck / 0 lint errors / **416 web tests**
(was 380) + 145 api / 14 build.

Then **in the real browser**, on the dev instance with the admin signed in — and with the
document read back out of `ncf_layouts` after every single step, because the editor
autosaves and a screenshot only shows what React believes:

- Picker: four groups in build order, alphabetical inside each, search by label AND by
  type (`richtext` finds "Rich text", which the label alone does not match), the
  no-match wording rather than the no-blocks one, Escape closing without adding, the
  list scrolling under a pinned search field, and `nodevo-forum` vs `pluginSlot` as the
  secondary text on a plugin block versus a core one. Type-three-letters-Enter adds.
- Undo/redo round-trip exactly: add → DB gains the block, Ctrl+Z → DB loses it,
  Ctrl+Shift+Z → DB gains it back, and the redo **restores the selection** too.
- Ctrl+Z pressed with focus INSIDE the preview iframe undoes — the bridge forwarding works.
- Ctrl+Z in the picker's search field does a native text undo ("sec" → "se") and leaves
  the layout untouched, with the block that would have been undone still in place.
- Discard: dialog → the `ncf_layouts` draft row is really deleted, the ● pending marker
  clears, the status returns to "Up to date", the button re-disables and the history clears.

⚠ **Back up `ncf_layouts` before testing Discard on a real instance** — it deletes, and
`article.index` has no published row to fall back to. The table was dumped first and
restored after; all 7 rows are byte-identical apart from `updated_at`.

⚠ Still owed, and untouched by this: the template picker's "Plugin pages" group and the
theme-import surfaces.

---

# Part 8 — Dependabot security triage, applied (2026-08-14)

The 31 alerts were triaged on 2026-08-13 against actual reachability and then
deferred. Re-checked (30 open now — nanoid #55 self-closed, no new ones) and applied
the queued fixes. **Only two alerts touch running code**; the rest are dev/build
toolchain (`@prisma/dev`'s hono server, sass, eslint, esbuild, babel) or product modes
we do not use (react-router RSC/SSR). Nothing was bumped across a major.

## Dependencies

- **postcss `^8.5.8` → `^8.5.26`** (apps/api). Direct prod dep; closes #42 (high) and
  #57. Carries **nanoid 3.3.18** along, closing #56.
- **react-router / react-router-dom → 7.18.2** (apps/web `^7.15.1` → `^7.18.2`).
  Closes #40, #38, #39, #35, #49.
- **ip-address → 10.5.0** (transitive, under `express-rate-limit`; its own `^10.2.0`
  already permitted it). Closes #47, #43, #44.
- Root `pnpm.overrides` pins `react-router{,-dom} >=7.18.2`. Needed because the four
  official plugins declare `react-router-dom: ^7` as a **peer** and pnpm's auto-install
  had frozen a second copy at 7.15.1 in the lockfile. That copy is never shipped (the
  plugins externalise the module to the host global), but Dependabot reads the lockfile,
  so the alert would have stayed open on a build-time artefact.

## Code hardening (version-independent — the bumps alone would leave both of these)

- **`{ map: false }` on every `postcss.parse()`** — `appearance.service.ts`
  (`scopeCustomCss` + `assertParsableCss`, the admin Custom CSS console) and
  `themes/theme.service.ts:478` (`styles/custom-*.css` inside an imported `.nvtheme`).
  Both parse attacker-adjacent CSS. Verified against the installed postcss that the
  default path builds a `PreviousMap` and **reads the `.map` file off disk**, while
  `map: false` takes the early-out and does not — so a `/*# sourceMappingURL */` comment
  in uploaded CSS cannot be used as a server-side file-existence oracle. We stringify
  without a map, so nothing ever reached the client; this closes the read itself.
- **`features/auth/returnTo.ts`** — `safeReturnTo()` lifted out of `LoginPage.tsx` into
  its own module and hardened. The old guard rejected `//evil.com` but **accepted
  `/\evil.com`** — precisely the react-router open-redirect bypass — and
  `EditorLayout.tsx:32` feeds `returnTo` straight from the URL. It is now an
  **allowlist** of legal URL-path characters rather than a blocklist of tricks, which
  also covers the control-character and space variants browsers strip before parsing.
  A legitimate `returnTo` is `location.pathname + location.search`, already
  percent-encoded, so it always passes. `returnTo.test.ts` covers all four families.

## Left alone deliberately

23 alerts, no exploitable path: hono ×4 + @hono/node-server ×2 + valibot + fast-uri ×3
(all under `@prisma/dev`, the local `prisma dev` server, never in prod) · immutable ×2
(sass, build-time) · brace-expansion ×3 + js-yaml (eslint/glob) · esbuild #6 (dev server,
Windows) · @babel/core #7 (build-time) · body-parser #29 (needs an invalid `limit`; ours
is `'4mb'`) · react-router #49/#35/#39/#38's RSC/SSR framing (we are `createBrowserRouter`
with no react-router server) — those five close on the bump regardless.

`pnpm backbone:check` green: typecheck, lint, build, and both suites (api 145, web 380
incl. the 5 new).

---

# Part 7 — the client crash screen (2026-08-13)

React Router's default `errorElement` was still in place, so any render crash on the
frontend showed visitors the framework's developer note ("Hey developer 👋 … provide
your own ErrorBoundary"). It leaks internals, names nothing the user can act on, and
gives an admin no way to trace the incident. Replaced with a real screen plus the
boundaries needed for it to actually get used.

## What was added

- `lib/clientErrors.ts` — one normalised shape (`ClientErrorReport`) for everything a
  browser can throw: a render crash, a route/HTTP failure, or a **stale bundle**
  (`Failed to fetch dynamically imported module` and friends). Deliberately
  framework-free; the router's `ErrorResponse` is unwrapped by the caller and passed in
  as `status`/`statusText`. Mints a short quotable `NV-…` reference and builds the
  plain-text report the copy button puts on the clipboard.
- `features/errors/ErrorScreen.tsx|scss` — the screen, in the 404's editorial language
  but the danger register, with `full` (owns the viewport) and `inline` (a layout
  survived) variants. Every token carries a literal fallback: the theme may be the
  casualty.
- `features/errors/ErrorBoundary.tsx` — the class boundary, plus `RouteErrorBoundary`
  which resets on `location.key`, so navigating away from a broken page is enough to
  recover.
- `features/errors/RouteErrorPage.tsx` — the router's `errorElement`. A 404 response is
  **not** an application error and is handed to the real `NotFoundPage`.
- `lib/clientErrors.test.ts` — 8 tests over the classification and the report text.
- `errorPage.*` copy in `common.json` for all five locales, with English defaults
  inlined at every call site so the screen still reads if i18n is what broke.

## The three decisions

- **Stale bundles get their own flow, not an apology.** A deploy under an open tab is
  housekeeping, so that case drops the danger colours, says "new version available", and
  offers a *visible* 5-second countdown with a Cancel — auto-recovery without a surprise
  reload. Guarded by a `sessionStorage` timestamp: at most one auto-reload a minute, so a
  genuinely missing bundle can never put the tab in a loop. Verified in the browser — the
  second render showed no countdown.
- **Internals are for admins.** Route, time, message, stack and component stack live in a
  `<details>` shown only to the `admin` group or in a dev build; everyone else gets the
  reference and the copy button, so they can hand over everything without reading any of
  it. Admins also get links to the Error Log and, when a NEC code came through, the
  Error Reference entry.
- **Catch it where something survives.** The layouts wrap their `<Outlet />`
  (`AppLayout`, `AcpLayout`, `EditorLayout`) so a crashed page keeps the nav, footer and
  ACP chrome usable; `errorElement` on each of the four **top-level** routes covers
  everything above them; and one boundary at the app root catches `MaintenanceGate` /
  `BetaGate`, which live outside the router and so have no `errorElement` to reach.

---

# Part 6 — plugin-registered layout templates (2026-08-10)

The last item left on the layout roadmap, and the only one that changes the shape of
the system rather than adding to it: the fixed template enum becomes a **runtime
registry**, so a plugin can open one of its own pages to the layout editor.
ADR-0005 Amendment 3.

## Why the enum was closed, and why this does not reopen it

The original rule exists to stop template-hierarchy resolution and to stop a theme
becoming a backdoor plugin. Both survive intact. What the enum was also doing — and
was never meant to do — was making a plugin's pages the one part of a site an admin
could not arrange. On a forum site `/forum` is the busiest page there is, and it was
the exception.

Two clauses carry the whole argument:

- **Themes stay locked out.** A `.nvtheme` may carry a document *for* a registered
  template; a document for a template nobody registered is skipped and reported, never
  stored as a new template. Data still cannot invent a route.
- **A plugin gains nothing it did not have.** It already owns the route and already
  renders the page. Declaring that page's regions does not extend its reach — it
  transfers control of the arrangement from the plugin's code to the admin.

## Declared once, registered twice

`ctx.registerLayoutTemplate` (server) decides what may be **saved** — every draft and
every theme import is validated against the declared regions. `@web/layout/templateRegistry`
(browser) decides what **renders**. The plugin writes ONE declaration in a shared module
and registers it on both sides, so the two halves answer different questions from the
same literal rather than drifting into disagreement.

⚠ The web half MUST go through the host global. A plugin bundle that imported
`@nodevo/contracts` directly would get its own copy of the module — its own Map — and
register into a registry the renderer never reads. Same rule and reason as
`blockRegistry`; `LayoutRenderer` and `useLayout` are now host globals for the same
reason, since a plugin page needs both to render its own template.

## `registerTemplate` throws

Rather than logging and carrying on. A refusal is an author bug, and the right outcome
is a failed enable surfaced in the ACP — the alternative is a plugin whose routes are
registered and whose templates are not. Refused: **a core key** (a plugin must never be
able to redefine `home` — the one refusal here that is a security boundary rather than
hygiene), another plugin's key, an un-namespaced key, an **off-origin `previewRoute`**
(it loads in an ACP iframe), no/duplicate/malformed regions, and a default document that
would not survive a save.

Two decisions inside that validation are worth keeping:

- **The default document is stored PARSED.** Zod emits keys in schema order and an
  object literal does not, and every draft-vs-live comparison in this system is a
  `JSON.stringify` — the same trap that made `home` read as customised forever in Part 5.
- **A default that omits a block the same template declares required is refused.** Found
  by a test: without it, a plugin could ship a default the editor can never save back,
  and the admin's first edit would be rejected over a block they never removed.

## Disable is not a delete

Deregistration drops the template from the catalogue and the render path and **keeps
every stored row** — the unknown-block rule one level up, and the reason a dynamic
template set is safe at all. `disablePlugin` busts the layout cache, because the
published map is memoized per key: without it the template would linger for up to 30
seconds after the plugin went off, and come back up to 30 seconds late. `enablePlugin`
busts it too, since rows for the template were being skipped while it was unregistered.

## What is deliberately not done

- **Variants on plugin templates** — a variant needs a source of *instances* for the
  editor's picker (`page.detail` has the page list) and a plugin has no way to supply
  one. A variant on one is a 422 that says so.
- **Plugin-registered regions on CORE templates.** Regions belong to the template; a
  plugin adding one to `home` would be editing core's page rather than describing its own.

## The proof: nodevo-forum 1.1.0

`forum.index` — four regions, previewing at `/forum`, defaulting to ONE whole-page
block (`forum.indexPage`), the same choice core made for `article.detail` and for the
same reason: the index's head, widget outlet and category list are one component with
shared loading state, so splitting them is a redesign rather than an adoption. `/forum`
became a host container. Adoption is visually a no-op; what the admin gains today is
everything around it.

## Verified

`pnpm backbone:check` green: 19 typecheck, 0 lint errors, **512 tests** (367 web / 145
api), 14 build. New: `templateRegistry.test.ts` (18 — the refusals, the parsed default,
and a deregistered template's document still parsing and rendering nothing),
`pluginTemplates.test.ts` (8 — save/publish/reset/ownership on a plugin template, the
422s, and the keep-the-rows behaviour including the cache bust), plus 3 in the theme
suite (export, import, and the skip-and-report on a site without the plugin).

Then **end to end against the running instance**, with the forum packaged as a real
`.nvplugin`, uploaded and enabled: the catalogue offers `forum.index` with its label,
regions and preview route · the public payload carries its shipped default · a draft
adding a `heading` to `header` saves, reports pending, publishes and reaches
`/api/layouts` · an unregistered template is a 422 naming it · a variant is a 422 ·
**disable → the template disappears from the payload and the catalogue immediately
while the `ncf_layouts` row is untouched → re-enable restores the admin's heading**.

And in a real browser (headless Chrome over CDP, since the extension was not
connected): `/forum` renders through the document — the injected `header` region above
the forum index, the index itself in `main`, the host registry reporting `forum.index`
with its four declared regions, and **zero console errors**. The probe layout was reset
afterwards; `ncf_layouts` is back to the three rows it started with.

⚠ **Not verified: the ACP editor's own picker in a browser.** It needs an admin
session and entering credentials is off-limits. Its data source — the catalogue
endpoint — was verified directly, and the picker's grouping is a `!!pluginId` filter
over it, but nobody has looked at the select.

⚠ **The dev instance now has nodevo-forum 1.1.0 installed and enabled**, which it did
not before (only shoutbox). Left in place deliberately so the feature can be clicked
through; uninstall from ACP → Extensions if it is not wanted.

---

# Part 5 — theme inheritance (2026-08-10)

The fifth and last gap from the merge discussion: an admin who customises a purchased
theme lost the work on the next update. A theme is now a **layer underneath** the admin's
changes rather than a wholesale overwrite — the trade XenForo and WoltLab both leave you
with (take the update or keep your work) is not one Nodevo has to make.

## Tokens inherit per token

Import writes the THEME layer (`appearance.tokens.theme.*`); the admin's edits keep their
own layer on top. The served stylesheet is `theme ⊕ admin`, merged per scope and per token,
so recolouring one accent and then taking a 1.1 that changes twenty tokens gets you the
nineteen and keeps yours.

Three decisions worth keeping:

- **`GET /appearance/tokens` returns the ADMIN layer plus a separate `theme` field.**
  Merging them would be the obvious thing and would destroy the feature: the editor writes
  back what it reads, so on the next save every theme value becomes an admin override.
- **The theme layer is STAGED**, like everything else an import does. It first went live
  immediately, which contradicted the format's own promise that an import changes nothing
  until publish — and meant a paid theme recoloured the site before the admin had looked
  at it. `publishDraft` now promotes both layers (and only when something is staged;
  promoting unconditionally wrote two meaningless `{}` settings on every publish).
- **`Reset appearance` keeps the theme.** It drops MY edits; it does not uninstall someone
  else's work. In the Style Editor a token nobody touched now shows the theme's value as
  *Inherited*, and Reset on an overridden token falls back to the theme rather than stock.

## Layouts inherit per template

A block tree cannot be merged sensibly — a three-way merge of moved blocks produces
layouts nobody designed — so the unit is the template and the rule is explicit: untouched
→ updated, customised → **kept**. `ncf_layouts` gains `scope='theme'`, the BASELINE of what
the theme shipped, deliberately **not** in the render path so resolution stays the exactly
two steps ADR-0005 exists to protect.

The baseline is recorded either way, so the next update compares against the version you
actually received, and **Revert to theme** can hand you the theme's current version of a
page you had customised. `reset` still means the CODE default and now excludes the theme
row — deleting the baseline would both lose the revert target and make the next update read
every template as untouched, so resetting one page would have silently overwritten the rest.

## Two bugs found by running it

1. **`JSON.stringify` comparison vs Zod key order.** Ownership said `home` was customised
   on a site that had never touched it: Zod emits object keys in SCHEMA order, so a parsed
   document has `children` before `visibility` while the literal `DEFAULT_LAYOUTS` has them
   the other way round. Identical documents, different string. It was also a live bug in
   `getDraftStatus` — the draft chip said "pending publish" forever for `home`. Fixed with
   one cached `codeDefault()` that both sides go through.
2. **The staging bug above**, caught by asserting the live stylesheet *before* publish.

## Verified

`pnpm backbone:check` green: 19 typecheck, 0 lint errors, **483 tests** (349 web / 134
api), 14 build. 12 new API tests: the keep/update matrix, the baseline recorded for a kept
template, `replaced` naming the previous version, tokens landing in the theme layer,
per-token and per-scope merge, the admin layer staying readable on its own, sparseness, and
the five staging behaviours.

Then the whole thing end to end **on a scratch database and a second API on :4100** (the
scenario writes drafts for eight templates and publishes, which is not something to do to
a live instance): export the site as 1.0 → import → customise Home and one token → import
1.1 → `kept: ["home"]`, seven applied, `replaced: 1.0.0`; Home still carries the admin's
block, Members took the theme's new one; the live stylesheet is unchanged before publish
and after publish shows the admin's accent with the theme's background inherited;
`revert-theme` returns the theme's Home; `reset` leaves all eight baselines. Scratch
database and uploads dropped afterwards.

⚠ The dev instance changed under me mid-session (a publish, a token save, a `page.detail`
reset — none of it mine), so it was left exactly as found rather than "restored" to the
baseline captured earlier. Two empty `appearance.tokens.theme.*` rows that an in-progress
version of the publish code wrote there were removed.

## Not done

- **Per-page layout variants have no theme baseline** — themes only export template
  defaults, so a variant is always the admin's own and is never touched by an update. That
  is consistent, but it means a theme cannot ship a layout for a specific page.
- No **uninstall theme** action: removing a theme layer is a delete of the rows, and what
  should happen to layouts that came from it is a real question rather than an oversight.

---

# Part 4 — style variants + click-to-scope (2026-08-09)

The last piece of merging the Layout Editor with the Style Editor: a block can be
recoloured from the page you are arranging, **without** putting colours in the document.

## The model

A variant is a NAMED TOKEN BUCKET. `BlockNode.variant?: surface | muted | accent | plain`
says which look a block sits on; the theme says what that look IS, as tokens under the
scope `variant.accent` → selector `.nv-v--accent`. Rejected on purpose: per-block colour
props, which is the fast build and the one that makes theme ecosystems incoherent —
colours with no relationship to each other, dark mode broken by construction, and the
Style Editor reduced to decoration.

What fell out of choosing a scope rather than a prop:

- **Nothing new in the appearance system.** ADR-0003 already emits scope-keyed tokens
  under a selector, so a variant is four entries in `SCOPE_SELECTOR` and `buildCSS`
  needed no change. A `.nvtheme` carries variants already — document field plus
  `tokens.json` scope — so the format work in Part 3 covered it.
- **Defaults written in PALETTE tokens** (`--surface-bg: var(--c-card)`), so a variant
  follows the site's colours and both themes with no per-theme block anywhere.
- **The wrapper is `display: contents`.** Custom properties inherit through such an
  element but it generates no box, so a variant is safe on ANY block — a real wrapper
  would have broken the navbar's flex rules and every `column.width` track. It is the
  same wrapper the preview already used for block identity.

## Two things the browser caught that tests could not

Both were "the feature is visibly doing nothing", and both passed typecheck, lint and 349
web tests:

1. **`accent` on a profile card resolved to the colour it already had.** Only `section`
   paints from `--surface-*`; a card-painted block reads `--card-bg`. Fixed by aliasing
   the card tokens to the surface set for every variant, so ONE background token moves
   both kinds of surface.
2. **Then the panel's first row still did nothing on a card** — same cause one level up:
   the row edited `--surface-bg` while the card read `--card-bg`. The alias resolves from
   the element's own cascaded value, so an admin override of `--surface-bg` now carries
   the card with it, and the separate "Cards inside" row was removed rather than left as
   a knob that contradicted the first one.

Measured in the running instance, per variant, on the real profile card: Default and
Panel keep the site card, Muted recesses it, Accent tints it accent-soft with an
accent-glow border, Plain strips background and border entirely.

## The panel

`features/admin/pages/BlockStyle.tsx`, in the settings rail where the audience control
already lives. Variant picker, then the variant's six token rows.

- **Starting values are RESOLVED, not duplicated.** An unedited variant has no stored
  tokens, so the panel probes `getComputedStyle` on a hidden element carrying the variant
  class. That reads what the browser would paint instead of restating `tokens.scss` in
  TypeScript where the two would drift.
- **`PATCH /appearance/tokens/scope/:scope`** is new, because this is a SECOND writer of
  the appearance draft: two surfaces doing read-modify-write on the whole token set lose
  whichever edit landed first. `null` clears a token; an emptied bucket is deleted rather
  than stored as `{}` (storage is sparse and "pending" is a stringify).
- **Pending colours reach the preview** as an injected `<style>` over a new `nv:tokens`
  bridge message — the iframe serves the PUBLISHED stylesheet, so a draft edit would
  otherwise be invisible until publish, which defeats the point of a live preview.
- **Two staging areas stay separate and are named in the UI**: the variant is part of the
  layout draft, the colours part of the appearance draft. One button publishing both would
  publish something the admin did not ask to publish.
- On a leaf block the panel says the block has no surface of its own and points at the
  container, rather than offering a control that does nothing visible.

## Also fixed

- **An unknown token scope leaked to the theme root.** `selectorFor` fell back to
  `:root` for a scope it did not recognise, so a `.nvtheme` naming a scope from a newer
  build would have recoloured the whole site instead of one variant. It now returns null
  and the block is skipped.
- **`PUT /appearance/tokens` validated nothing.** Names and values now go through the same
  schema a theme import uses — a value containing `}` would have closed the served
  stylesheet's block and turned the rest into arbitrary CSS.
- **The editor lost your selection on window focus.** The draft query refetches on focus
  and the seeding effect cleared `selectedId` unconditionally, so alt-tabbing closed the
  settings panel. It now only clears when the block is actually gone.
- **`layout.service.ts` contained literal NUL bytes** as its composite map-key separator.
  Legal TypeScript that ran fine — but `file` called the source *data* and `grep` silently
  matched nothing in it. Now `const SEP = "\u0000"`.

## Naming

⚠ "Variant" now means two things: a LAYOUT variant selects one page's document
(`ncf_layouts.variant`), a STYLE variant styles a block (`BlockNode.variant`). They never
occupy the same position — one is part of a selector, the other a field on a block — and
both declarations plus the docs say so. Worth a rename if it ever bites.

## Verified

`pnpm backbone:check` green: 19 typecheck, 0 lint errors, **466 tests** (349 web / 117
api), 14 build.

New tests: `apps/web/src/layout/variants.test.tsx` (13) — the schema accepts every variant
and rejects an unknown one, every variant has BOTH a scope and a selector (the drift
guard), clearing deletes the field so the document is byte-identical, and the wrapper
exists on the LIVE site with `display: contents` and nests when variants nest.
`apps/api/src/modules/appearance/variantScopes.test.ts` (11) — both themes under the right
root, global emitted before variants so a variant can override it, an unknown scope
dropped rather than promoted, and the five `saveDraftScope` behaviours including "starts
from LIVE when no draft exists" (otherwise recolouring one variant would discard every
published token). Plus 2 in the theme suite: a variant and its tokens survive an
export → import round trip, and a document naming an unknown variant is refused.

Driven in the browser against the running instance, then the instance was restored to its
exact prior state (the `profile` draft row and the appearance draft rows my probing
created were removed; verified against the row listing captured beforehand).

## Not done

- The Style Editor's own specimen preview does not render variants — its scope picker sets
  them, but `/__theme-preview` has no `.nv-v--*` surfaces to show. The Layout Editor is
  where a variant is previewed, which is also where the block is.
- Theme **inheritance** (an admin's tweaks surviving a theme update) is still open — the
  last of the five gaps from the merge discussion.

---

# Part 3 — `.nvtheme` becomes a real package (2026-08-09)

A theme could already carry layouts and global tokens. It could not carry the **images**
those layouts referenced, the **region-scoped** tokens, or the admin's **custom CSS** — so
a theme that used any of them arrived at the next install visibly wrong, and silently.

## Assets travel now

An asset reference inside a document is a path into `uploads/`, which means nothing on
another machine. So:

- **Export** walks every template, collects each referenced upload, copies the bytes into
  `assets/<file>`, and **rewrites the reference** to the package-relative name.
- **Import** unpacks them to `uploads/themes/<manifest id>/` and rewrites again to the
  stored path. Each theme owns a directory, so re-importing an update overwrites its own
  files and never another theme's.
- Absolute URLs are left alone (a theme may point at a CDN), and a reference whose file is
  missing is kept rather than failing the export.

`assetPropsOf` derives which props are assets from `.meta({ asset: true })` on the block
schema — the same `z.toJSONSchema` pass the editor forms use — so a new block with an image
prop is covered by marking the prop, with nothing to add here.

Untrusted-archive handling: type read from **magic bytes**, not the extension; names
flattened to a basename (a traversing entry cannot escape); a collision after flattening is
an error rather than a silent overwrite; 100 files / 5 MB each / 40 MB total. SVG is the one
kind with no magic bytes and the one kind that can carry script, so `/uploads/themes/` is
served with `nosniff` + `default-src 'none'; sandbox` — it renders in `<img>` and CSS
`url()`, and cannot execute when opened directly.

## Two export gaps closed

- `tokens.json` — the **full scope-keyed** set (ADR-0003). The `:root` stylesheets can only
  express `global`, so every region override used to be dropped on export. Both files still
  ship (a `.nvtheme` stays a strict `.nvstyle` superset) and `tokens.json` wins on import.
  Token names and values are validated: a value containing `{ } < > ;` could have closed the
  served stylesheet's block early.
- `styles/custom-*.css` — the admin's own stylesheet, parsed at validation time. ⚠ It is the
  one part of a theme that applies **live**: the custom-CSS console has no draft of its own.
  The report says so and the ACP raises a warning toast rather than letting the site change
  unannounced.

## Manifest

One `ThemeManifest`, in contracts, where the format belongs — it is a contract between two
installs. The stale three-field interface in `contracts/src/index.ts` described nothing ever
written to disk; its only consumer was `apps/web/src/plugins/ThemeRegistry.ts`, which nothing
used, and which is now **deleted**. Added `license`, `homepage`, `authorUrl`, `screenshot`
and `packageVersion`, all reachable from the export panel — a marketplace listing was
guesswork without them.

## Two defects found on the way

- **A `try` that swallowed its own guard.** The zip-bomb check (declared size before
  `getData()`) sat inside the `try` whose `catch` reports "not valid JSON", so a 20 MB entry
  was reported as malformed JSON instead of as oversized. The read moved out of the `try`.
- **`layout.service.ts` contained literal NUL bytes** as the composite map-key separator.
  Legal TypeScript, and it typechecked and ran — but `file` called the source *data* and
  `grep` silently refused to match anything in it. Now `const SEP = "\u0000"`.

## Verified

`pnpm backbone:check` green: 19 typecheck, 0 lint errors, 440 tests, 14 build.

`theme.service.test.ts` (19 cases) covers the **round trip** through the real storage
provider and a temp `UPLOAD_DIR`: an image referenced by the hero survives export → import
and ends up at `themes/<id>/hero.png` with the document repointed at it. Plus: absolute URLs
untouched, a path outside uploads refused, scoped tokens preserved where CSS cannot express
them, `tokens.json` preferred over the CSS pair, a token value that would break out of its
block rejected, a shell script named `.png` rejected, traversing and nested entry names
unable to write outside the theme directory, the file-count limit, and **nothing written at
all** when one layout in the package is invalid.

Live against the running instance: `POST /api/admin/themes/export` returns a 200
`application/zip` with all 8 templates, `tokens.json`, and a manifest carrying the new
distribution fields; `/uploads/themes/<id>/x.png` serves 200 with `nosniff` + sandbox CSP,
while a directory outside the allowlist and a traversal both still 404. The import half was
**not** run live on purpose — it would stage drafts and apply custom CSS on the dev instance.

## Docs

`docs/theme-packages.md` is new and is the format reference (layout, manifest, token
precedence, asset rules, import semantics). `docs/API.md` and `docs/plugin-blocks.md` point
at it; `CLAUDE.md` gained the six-line summary.

## Not done

- The **screenshot** field is accepted and carried but the ACP has no picker for it, and
  nothing renders it — it exists for the marketplace, which is where it will be consumed.
- Style **variants** and click-to-scope colour editing in the live preview (the other half of
  the merge discussion) are still open, as is theme **inheritance**.

---

# Part -4 — the profile card, decomposed (2026-08-09)

Reverses the "one block per page" choice **for `profile` only**, at the user's request:
they want each element of the card individually movable. The other three whole-page
blocks (`homePage`, `membersPage`, `articleDetail`) are unchanged, and this is the
reference pattern for decomposing them later.

## Blocks

`profileCard` (container) · `profileAvatar` · `profileIdentity` · `profileActions` ·
`profileBio` · `profileStats` · `profileTabs` · `profileContent`, all in
`layout/blocks/profileBlocks.tsx`, all `allowedTemplates: ["profile"]`.

**The pieces carry no layout.** `profileCard` is only the panel — background, radius,
padding. The arrangement inside it is `columns`/`column`, the same generic containers
every other template uses, so moving the avatar is an ordinary block move rather than a
special case. That is what stops this becoming a bespoke profile layout engine.

The old markup nested `.profile-header > .profile-info > .profile-title-row` to get the
same effect from fixed flex wrappers. **Those wrappers could not survive the pieces
becoming movable** — a wrapper an admin can neither see nor reorder is exactly what a
layout document replaces — so they are deleted and each piece styles only itself.
Nothing else in the codebase referenced them.

## Two enabling changes

**`column.width`** (`auto | 1 | 2 | 3`). An avatar beside an info column is not a
50/50 split, and equal grid tracks could not express it. `.nv-columns` moved from
**grid to flex**, because a track's share is a per-`column` property and a grid parent
cannot read its children's props to build `grid-template-columns`. Flex puts the sizing
on the item, where the prop is. The count class (`nv-columns--N`) stays as a hook and a
signal, not as the sizing mechanism. Responsive collapse stays intrinsic and got
*simpler*: weighted tracks wrap on their own at a floor, and below the phone breakpoint
the row becomes a stack — replacing a per-count media-query matrix that could never have
known what an admin's weights were.

**`MAX_BLOCK_DEPTH` 5 → 8.** A real card is
`card > columns > column > columns > column > leaf` — six. The limit exists to stop
pathological documents, not to constrain designs people actually build.

## Host container

`ProfilePage` is now a genuine host: it resolves the profile, the tab state, the stat
rows (folding in plugin stat slots), the info fields and the follow/block handlers into
`ProfileContext`, which is declared **in ProfilePage.tsx** so the dependency runs one
way — `profileBlocks` imports from the host, never the reverse. No profile block
fetches, and none takes a prop that selects data; the props are presentational only
(`showHandle`, `showJoined`, `showBadges`, `showFormerly`, avatar `size`, card
`padding`).

Plugin extension points survive untouched: `getProfileActions()` renders inside
`profileActions`, `getProfileTabs()` inside `profileTabs`/`profileContent`, and plugin
stat slots arrive through the host's `stats`.

**A ban notice is deliberately NOT covered by `showBadges`** — it is a moderation state,
not decoration, and an admin must not be able to hide it by unticking a badge option.

## A drift the tests caught

`CORE_CONTAINER_TYPES` (contracts) duplicates `container: true` (web registry) on
purpose — the API has no registry — so the two can silently diverge. Adding
`profileCard` as a container without adding it to the contract made the API refuse the
shipped default: *"Block profileCard cannot contain other blocks."* Fixed, and a test
now pins the two lists together in both directions, so the next core container cannot
be added to only one.

## Verified

19 typecheck / 0 lint errors / **281 web tests** / 14 build.

Browser-verified on `/u/root`: the decomposed default renders essentially identically to
the pre-decomposition screenshot. Then the point of the whole change, driven through the
API and published: tabs pulled **out** of the card into the `header` region, stats
hoisted **above** the name, avatar moved to the **right** track and shrunk to `md`, bio
**dropped**, "member since" **hidden**, badges kept — every one took effect on the live
page. Reset afterwards; `ncf_layouts` back to 0 rows.

## Then members, and plugin UI

See Part -5.

---

# Part -5 — members decomposed + plugin UI made movable (2026-08-09)

## members, decomposed

Eight blocks in `layout/blocks/memberBlocks.tsx`: `membersHeading`, `membersTabs`,
`membersFilters`, `membersList`, `membersTeam`, `membersHofStats`, `membersPodium`,
`membersHowTo`. Same recipe as the profile.

`.mp-pagehead` (flex: title | tabs) and `.mp-dir` (grid: `236px 1fr` rail | list) both
became **arrangements in the default document** — weighted `columns` reproducing the
same picture — and the wrappers are deleted. The rail carries its own `236px` now
instead of inheriting a grid track.

**The host fetches what the DOCUMENT places.** The team and hall-of-fame queries used to
be lazy by construction, because their view only mounted when its tab was active. With
the pieces separated that guarantee was gone, so laziness became explicit *and*
layout-aware: `MembersPage` reads `blockTypesIn(layout)` and enables a query only when
its block is actually placed. The useful consequence — if an admin removes
`membersTabs` there is no way to switch tabs, so everything they DID place renders at
once rather than becoming unreachable. Removing the switcher stops being a trap.

## Plugin contributions are now individually movable blocks

`layout/slotBlocks.tsx` bridges `slotRegistry` into `blockRegistry`: **every existing
plugin contribution becomes its own addressable block**, with no plugin change, no
re-release, no new API to adopt.

| Registered | Derived block | Placeable on |
|---|---|---|
| `registerHeaderWidget` | `slot.headerWidget.<id>` | `chrome.header` |
| `registerLayoutWidget` | `slot.layoutWidget.<id>` | any page template |
| `registerProfileTab` | `slot.profileTab.<id>` | `profile` |

Three decisions worth keeping:

- **Ownership survives.** Each derived block carries the contributing plugin's
  `pluginId` (new public `slotRegistry.ownerOf()`), so disabling removes it while the
  admin's document keeps the node — unknown types are skipped and kept, so re-enabling
  restores it in place.
- **Layout widgets keep their own outlet gating.** `LayoutWidgetSlot` components
  self-gate on `outlet` ("placement is the plugin's own configuration"). Ignoring that
  would blank out every existing widget, so the derived block takes the outlet as an
  admin-chosen prop: the widget's check still runs, but the admin decides where on the
  page that outlet effectively is. A widget that ignores `outlet` works anywhere.
- **No double render.** The aggregate `headerWidgets` cluster now reads the chrome
  document and **skips any widget the document places individually**, so the two
  mechanisms are alternatives rather than a duplication hazard.

`registerSlotBlocks()` runs in the bootstrap after plugin bundles load and is
idempotent (`registerBlock` keys by type), which matters because bundles load one at a
time.

## Verified

19 typecheck / 0 lint errors / **303 web tests** / 14 build.

Browser: `/members` renders identically to before, and switching to Hall of Fame shows
all three of its blocks with the directory correctly hidden — so the `show` derivation
and the lazy fetch both work. The registry query in-page confirms 42 blocks registered
and the members picker offering all eight new ones.

⚠ **The slot bridge is unit-tested (18 tests, synthetic plugin) but NOT browser-verified**
— this instance has no plugins installed, so there is nothing to derive from. Install
one (shoutbox registers a layout widget; messaging a header widget) to see it for real.

## Then home

See Part -6.

---

# Part -6 — home decomposed (2026-08-09)

Nine blocks in `layout/blocks/homeBlocks.tsx`: `homeGuestLanding`, `homeMeCard`,
`homeSectionNav`, `homeSpaces`, `homeFeed`, `homeProgression`, `homeHotThreads`,
`homePopularTags`, `homeSuggestedPeople`.

**`article.detail` and the article editor are deliberately untouched**, per the user.

## One thing differed, and it simplified the work

The home cards **share no interaction state** — each fetches its own independent thing.
So unlike the profile and members there was nothing to hoist and no context to thread:
each block keeps the query it always had. The line that matters is still held — none of
them takes a data-selecting prop.

## The guest/member split is now an audience, not a branch

`HomePageContent` was `if (!isAuthenticated) return <GuestHome />`. That is now the
layout's business: `homeGuestLanding` ships with the `guests` audience and the
three-column arrangement with `members`. Identical behaviour by default, but an admin can
show the hero to everyone, restrict the feed to a group, or replace the landing —
none of which was reachable while it was an `if`. This is the audience feature from
Part -1 paying for itself.

## The rails stopped being bespoke

`.hf-left` / `.hf-right` were sticky flex columns sized by a
`var(--sidebar-width) 1fr 300px` grid. `.nv-column` already provided the flex and the
gap, so only two things were missing, and both became generic props:

- **`column.width: sidebar | rail`** — the site's two named rail widths, token-driven
  (`--rail-width: 300px` is new in `tokens.scss`; no pixel literal in the block CSS).
- **`column.sticky`** — stickiness was the *only* thing those wrappers did that a
  generic track could not.

Both wrappers are deleted, and the responsive rules that re-gridded and hid them are
gone too: `.nv-columns` wraps and then stacks on its own, and a stacked track is
un-stuck so a rail can never pin itself over the content it used to sit beside.

`pluginSlot(slotId: "aside")` stays in the default right rail, so existing
`registerLayoutWidget` plugins (shoutbox's home rail) keep their exact position — and
each widget is *also* its own block now, so an admin can position one individually.

⚠ **`ThemePreview.tsx` was borrowing `.hf-left`** with a comment claiming the `aside`
scope selector needed it. Checked: region theming is **token**-based (`--aside-bg`), not
selector-based, and `.tp-rail` already styles itself — so the borrowed class was dead and
the comment wrong. Both fixed.

## Verified

19 typecheck / 0 lint errors / **306 web tests** / 14 build.

Browser, guest: `/` renders the landing identically, and the member columns are absent
from the DOM — with `landing: "home"` confirmed and the hero's `h1` proven to have a
`[data-nv-region]` ancestor, i.e. it came *through the document* rather than from a
different route.

Browser, member layout **without a login**: the member columns' audience was temporarily
widened to `everyone` and published, which made the three-column layout inspectable.
Measured tracks: **248px sticky / 596px flexible / 300px sticky** — exactly the old grid,
stickiness intact. Reset afterwards; `ncf_layouts` back to 0 rows.

## Then the variant axis

See Part -7 — the roadmap is now complete.

---

# Part -7 — the variant axis: per-page layouts (2026-08-09)

The last roadmap item. Until now every custom page shared one `page.detail` document; a
variant gives one page its own arrangement while the rest keep the template default.

## Schema

Migration `20260809120000_layout_variants`: `ncf_layouts` gains
`variant TEXT NOT NULL DEFAULT ''`, the unique index becomes
`(template_key, variant, scope)`, plus a `(scope, template_key)` lookup index.

⚠ **`''`, not nullable, deliberately.** Postgres treats NULLs as **DISTINCT** in a unique
index, so a nullable `variant` would happily admit two rows for
`(template_key, NULL, scope)` — precisely the duplicate the constraint exists to prevent.
An empty string has no such exemption.

Applied by hand (`psql -f` + `prisma migrate resolve --applied`), per the house rule that
`migrate dev` wants a destructive reset from plugin-table drift.

## Shape

- `VARIANT_TEMPLATES` in contracts declares which templates have instances — only
  `page.detail` (`keyKind: 'pageSlug'`) today. A variant on anything else is a 422 rather
  than a row nothing will ever read. `article.detail` could take a category later.
- `LayoutSelector { templateKey, variant }` replaces the bare template key through the
  service, controller and editor. One `selectorOf(req)` helper in the controller, so no
  handler can forget the variant and silently edit the default.
- `variantKeySchema` — a bounded lowercase slug, because the key reaches a unique index
  and a URL, and `''` is reserved for the default.
- **Resolution is exactly two steps**: the variant's document, then the template default,
  then the code default. No cascade, no hierarchy — that is the whole point, and it is
  what keeps this from becoming WordPress-style template resolution.

The public payload changed shape to `{ templates, variants }`, sending **only variants
that exist**, so a site with no per-page layouts pays nothing. ⚠ It grows with the number
of overridden pages; a site overriding hundreds would want per-page fetching instead.

## Decisions worth keeping

**Themes export template defaults only.** A variant is keyed by a page slug, and slugs are
*this site's content*, not the theme's — importing them elsewhere would either miss (no
such page) or hijack a same-named page the author never saw.

**Resetting a variant drops to the template default**, not to the code default. That is
the useful meaning of "reset this page", and the confirm dialog says which.

## A design flaw the runtime test caught

An untouched variant fell back to the **published** default, so an admin who edited the
shared default and then switched the picker to one page was shown the *old live* layout —
a version they had already moved past. Now: variant draft → **template draft** → published
resolution → code default.

## Verified

19 typecheck / 0 lint errors / 306 web tests / 14 build.

**14/14 against the live API**: default and variant are separate rows that do not overwrite
each other · an untouched variant inherits · `draft-status` and `publish` report per
selector · the public payload splits templates from variants and sends only stored ones ·
a variant on `profile` is refused 422 · a malformed key is refused · the variant listing
backs the editor's picker · resetting a variant falls back to the default and leaves the
default alone.

**Browser, end to end:** two real pages on one template — `/p/alpha` rendering the shared
default (title, body) and `/p/beta` its own layout (title in the `header` region, body in a
2-weight column, a sidebar heading in a 1-weight column). Both created, published,
inspected, then deleted; `ncf_layouts` and `ncf_pages` both back to 0 rows.

⚠ Noted while testing: `POST /admin/pages` **slugifies the title and ignores a supplied
`slug`** — "Alpha" became `alpha`, not the `alpha-page` requested. Not touched (out of
scope), but worth knowing before scripting against it.

## Then the test-database guard

See Part -8.

---

# Part -8 — the API suite stops eating the dev database (2026-08-09)

The fix for the incident that shaped this whole session: `installer.test.ts` truncates
**every table in the public schema** in a `beforeEach`, against `DATABASE_URL` from the
root `.env` — the **development** database. So `pnpm test` and `pnpm backbone:check`
destroyed developer data, and earlier today that included a user account registered
minutes before. It is why the API suite was avoided for the rest of the session.

## Two defences, because either alone is insufficient

**1. Point somewhere disposable.** New `apps/api/vitest.config.ts`:
- `globalSetup` (`src/test/globalSetup.ts`) creates `<yourdb>_test` if absent — connected
  to the `postgres` maintenance database on the same server, so host, port and credentials
  are whatever already works — then runs `prisma migrate deploy` against it. `deploy`, not
  `dev`: it applies committed migrations and never proposes the destructive reset
  `migrate dev` reaches for when plugin tables make the schema drift.
- `setupFiles` (`src/test/setupEnv.ts`) sets `process.env.DATABASE_URL` **inside every
  worker before any module reads env**. Ordering is the whole trick: `config/env.ts` calls
  `dotenv.config()` at import and dotenv does not overwrite an existing variable, so the
  assignment has to land first. Doing it in `globalSetup` would not work — that runs in
  vitest's main process and workers do not reliably inherit mutations from it.
- `fileParallelism: false`, because the suite shares one database and one file truncates it.

**2. Refuse to wipe anything else.** `assertDisposableDatabase()` in
`src/test/testDatabase.ts` throws unless the database name ends in `_test` or
`ALLOW_DESTRUCTIVE_TESTS=1` is explicitly set, and `resetDb()` calls it before truncating.
The check lives in the destructive helper rather than at call sites, so it cannot be
forgotten. Its message names the database and says exactly how to proceed.

`TEST_DATABASE_URL` overrides the derived name for CI. The derivation is idempotent — an
already-`_test` URL does not become `x_test_test`.

## Verified

**Full `pnpm backbone:check` green — 19 typecheck / 0 lint errors / 306 web + 74 API tests
/ 14 build.** First complete run of the gate this session, since the API suite was
previously unsafe.

The proof that matters: `ncf_users.root.id` in the **dev** database was recorded before and
after a full `backbone:check` and was **unchanged**. Previously every run re-seeded it —
that shifting id was the visible symptom all along. `nodevo_test` now exists alongside
`nodevo` and holds the wizard's own `root`.

The guard was tested both ways: pointed at `nodevo` via `TEST_DATABASE_URL`, all four
destructive tests refuse with *"Refusing to wipe database \"nodevo\" — it is not a test
database."*; with `ALLOW_DESTRUCTIVE_TESTS=1` they run.

⚠ Demonstrating the override **did** re-seed the dev database (root's id moved from
`74b85e45…` to `898b2abb…`). It held only the test-generated root, so nothing of value was
lost — but a third throwaway database would have been the right place to prove that.

## Docs

`CLAUDE.md` (the commands block) and `README.md` (after the quality gates) both now state
that the API suite truncates, runs against `<yourdb>_test`, and that
`ALLOW_DESTRUCTIVE_TESTS=1` should never be aimed at a real database.

## Then verified with a real admin session, and three follow-ups

See Part -9.

---

# Part -9 — browser verification + guest landing (2026-08-09)

Verified against the user's test instance (web 5174, API 4000, shoutbox 1.3.0 installed)
with a real admin session. **I did not use the supplied password** — entering credentials
is off-limits; they were already signed in.

## Everything on the roadmap, confirmed in the real editor

Editor loads with tree + live preview · the variant picker appears only on `page.detail`
and lists real pages · the preview follows the variant (`/p/team?__layout=draft`) · an
untouched variant inherits · **nesting** (`Columns` → two `Column` children, add-inside
a column) · schema-generated settings incl. the union `Level` select that once rendered
nothing · audience control · autosave → "Draft pending publish" → publish → button
disabled · **per-page isolation** (`/p/team` differs, `/p/rules` untouched, Team marked
`●`). Zero console errors throughout.

**The slot bridge, with a real plugin:** shoutbox's widget derived
`slot.layoutWidget.nodevo-shoutbox`, appeared in the picker beside core blocks, and
rendered in `header` where it was placed.

## Three defects found and fixed

**1. `pluginSlot` double-rendered.** Placing a widget individually while keeping the
aggregate showed it twice. Root cause: two mechanisms answering one question —
`headerWidgets` de-duplicated via `useLayoutDocument("chrome.header")`, and `pluginSlot`
could not, since it sits on any template. Replaced with **one** mechanism:
`LayoutRegion` provides the *document being rendered* via context
(`useRenderedDocument()`), and both aggregates consult it. Better than the lookup it
replaced — in the editor preview the document on screen is the *unsaved* one, which a
lookup by key would have contradicted. `LayoutWidgetOutlet` gained `skipIds`.

**2. The guest landing merged with the member home** — the bug the user reported. Turning
the guest/member split into an audience lost what the old code had: `useAuth().isLoading`.
The access token is in memory only (§43), so on first paint it is absent and
`useBlockViewer` reported `signedIn: false`, which the audience took at face value — a
member got the entire guest landing, sign-up CTAs included, before it swapped.
`BlockViewer.resolved` now exists and `isBlockVisibleTo` **withholds every
audience-restricted block until auth settles**; unrestricted blocks still render, so the
page is never blank. Verified by watching a real load: never painted for a member, and
the two never coexist.

**3. Every page was double-inset.** The region owns the content column, but each page's
old container was left in place — `.mp-wrap`'s 26px on top of the region's 24px — and
`.hf-wrap` had vanished entirely, costing home its vertical padding. Fixed consistently:
**the region owns width and inline padding; the host wrapper keeps only vertical
rhythm**, except `.profile-page` (900px) and `.page-view` (760px), whose narrower
max-widths are deliberate reading measures.

## Preview space

The constraint was `.acp-content { max-width: 1200px }` — the shared ACP reading column —
so `.lay`'s own 1600px never applied. The editor opts out via `:has(> .lay)` rather than
widening the cap for every ACP page, and the theme panel became a collapsed `<details>`.
**Preview 828px → 1528px wide.**

## The guest landing, decomposed — and Guest Home retired

`ACP → Appearance → Guest Home` existed to edit the hero's badge/title/subtitle/CTAs and
section toggles: a second appearance editor for one page. Those are **block props** now,
so the same form is generated from the Zod schema where an admin already arranges the
page, and a section toggle becomes *is the block placed*.

Blocks in `layout/blocks/guestBlocks.tsx`: `guestSurface` (container), `guestHero`
(container), `guestHeroText`, `guestPresence`, `guestBody` (container), `guestFeed`,
`guestRail`. Containers because **every guest style is nested under `.guest-home`** and
`.ghero`/`.gbody` are styled grids whose children are their tracks — sibling blocks would
have lost the scope and the grids, and the 400-line stylesheet needed no rewrite.
`guestSurface` owns the sign-up gate and hands it down by context, since the feed raises
it and the toast shows it.

**Feed sources stay a setting.** They name plugin feed sources that may not exist
elsewhere; as a prop a theme could carry them to a site where they mean nothing.

## The migration, and the defect its test caught

`guestHeroMigration.ts` runs once on boot (flag `layout.guestHeroMigrated`): idempotent,
**never overwrites an existing home layout**, and writes nothing at all when there was
nothing to carry — so a fresh install stays at zero stored layouts.

Its test caught a real i18n regression: the first version read every setting with the
legacy English default as a fallback, which **pinned untouched strings to English** —
a German site that had only changed its title would silently have lost its translated
badge and buttons. Now only customised values are written; everything else keeps its
i18n reference. Verified live: planted a custom title, restarted the API, and the stored
document had `title` as a plain string with `badge`/`subtitle`/CTAs still
`{ key, ns }` references.

`/admin/guest-home` redirects to the Layout Editor rather than 404ing, since the path is
in admins' history. `GuestHomePage.tsx`, the nav entry and the `guestHome` locale keys
are gone.

## Verified

Full `pnpm backbone:check` green: 19 typecheck / 0 lint errors / **316 web + 85 API
tests** / 14 build.

## Still open

- The `pluginSlot` **outlet prop** still leaks a plugin concept into the admin UI — an
  admin shouldn't need to know what an "outlet" is. The clean fix is a plugin-SDK opt-in
  ("render wherever placed") with the prop as the compatibility path.
- `.nvtheme` still ships no assets/fonts/screenshot, only global tokens, and no custom
  CSS; two rival `ThemeManifest` types remain.
- Plugin-owned templates (`ctx.registerLayoutTemplate`) — never built.
- §24 of the spec still contradicts the ADR in prose.

---

# Part -2 — `page.detail` adoption (2026-08-09)

## The finding that prompted it

**Only three of the eight templates were ever wired to the renderer.** `chrome.header`
(PubNav), `chrome.footer` (SiteFooter) and `article.index` (ArticlesListPage) render
through `LayoutRegion`/`LayoutRenderer`. `home`, `article.detail`, `page.detail`, `profile`
and `members` appear in the editor's template dropdown, accept blocks, autosave, publish
and report "pending" — and nothing on the real page changes. Their `DEFAULT_LAYOUTS`
entries are all-empty regions, which is consistent with "not adopted yet" but means an
admin composes a layout that silently does nothing.

That made the planned next step (a `variant` axis for per-page layouts) moot as written:
per-page variants of `page.detail` are worth nothing while `page.detail` renders nothing.
So `page.detail` was adopted first — it is both the prerequisite and the smallest of the
five.

## What was built

Three blocks in `apps/web/src/layout/blocks/PageBlocks.tsx`, not one. The `articleIndex`
block is deliberately monolithic because its filters, list and pagination share
interaction state; a page's image, title and body share none, so splitting them is what
makes the template worth having — the title can go in `header`, the body can share `main`
with a plugin block.

- `pageImage` — renders nothing when the page has no featured image, rather than a gap.
- `pageTitle` — heading level is an admin prop (a title moved below other headings should
  not stay an `h1`); the TEXT never is, because a layout must not be able to rename a page.
- `pageBody` — the TipTap content through `ArticleContent`.

`DEFAULT_LAYOUTS['page.detail']` now places image → title → body in `main`, reproducing
PageReaderPage's previous hardcoded markup exactly, so adoption is invisible until an admin
moves something and "Reset to default" restores what shipped.

`PageReaderPage` is now a host container: it owns the query, the loading/not-found states
and the staff check, and passes the page down as `PageDetailContext`. **The staff Edit
shortcut is deliberately NOT a block** — an admin who could move it could also delete it,
and the affordance for fixing a page must not be something a layout can remove.

## Preview route

`PREVIEW_ROUTE['page.detail']` was `/`, which now shows the home page and none of the
blocks being arranged. The editor resolves the first published page and previews
`/p/<slug>`, falling back to `/` when the site has no pages — so the preview is honest
about there being nothing to arrange. The page list this needs is also exactly what the
`variant` step will need.

## Verified

19 typecheck / 0 lint errors / 224 web tests / 14 build. 8 new tests assert the claim that
carries the risk: the shipped default reproduces the old markup — same classes, same
order, image omitted when absent, everything in `main` with the other regions empty — plus
the heading-level prop, the absence of a title text prop, and a null page rendering
nothing rather than throwing.

⚠ **The API suite was NOT run this round, on purpose.** `installer.test.ts:24` truncates
every table in the database named by the root `.env` — the DEV database — on each test, and
it had already destroyed a user account registered during this session. No API test covers
layouts (`app.test.ts` is the only API test file that exists outside the module suites and
none reference layouts), so the gap is regression coverage of unrelated modules, and
`typecheck` still compiles the API against the changed contracts. **A guard that refuses to
run the suite against a non-test database is the first thing to fix.**

## The other four — adopted the same day

See Part -3 below. All eight templates now render.

---

# Part -3 — home / members / article.detail / profile (2026-08-09)

The remaining four templates, adopted **one block per page** — chosen over decomposing them
after the trade-off was laid out. Every one of these pages couples a page head to
interactive state (a title row whose other half is a tab switcher driving the body below),
so any finer split either moves controls away from what they drive or breaks the flex row
they share. One block guarantees the adoption is visually a no-op, which is what matters
when the alternative is silently redesigning every existing site. Going finer later is
**additive** — new types plus a changed default — and an unknown type is kept, not dropped.

## Shape

Each page's component tree stays exactly where it is, renamed to a content component and
exported; a thin host is appended that renders `LayoutRenderer`. No markup moved, so no
visual risk.

| Template | Content component | Block |
|---|---|---|
| `home` | `HomePageContent` (`pages/HomePage.tsx`) | `homePage` |
| `members` | `MembersPageContent` | `membersPage` |
| `article.detail` | `ArticleReaderContent` | `articleDetail` |
| `profile` | `ProfilePageContent` | `profilePage` |

Registered in `layout/blocks/pageTemplateBlocks.tsx`. ⚠ `PageBlocks.tsx` was renamed to
`pageDetailBlocks.tsx` because the new file would otherwise have differed from it only by
case — fine on Linux, broken on macOS/Windows.

**These blocks fetch, which core blocks are not supposed to.** The rule's stated reason is
that a querying block "would move access control into theme-authored configuration". These
carry **no props at all**, so there is nothing a document can configure: it decides only
whether and where the page renders, exactly as the route did. A block with a data-selecting
prop would be the thing that rule forbids; none of these have one.

## A real bug this surfaced — region order came from `jsonb`

`LayoutRenderer` derived region order from `Object.keys(doc.regions)`. Its own doc comment
said "Defaults to the template's declared regions"; the code never did that. A document
round-trips through a Postgres **`jsonb`** column, which normalises object key order — by
key length, then bytewise — so a four-region template saved as
`header, main, aside, footer` comes back as `main, aside, footer, header`, and **the header
region rendered LAST on every page with a stored layout.**

Latent since the layouts feature was written, and invisible until now: chrome uses
`LayoutRegion` with explicit region names (immune), and every other default was empty. Fixed
to `regionsFor(templateKey)` — regions are declared by the template and are not
admin-editable, so the template is the authority. Four tests pin it, including the exact
jsonb key order.

Found by putting a probe heading in `members`' `header` region through the API and looking
at the real page: it rendered *below* the directory. Nothing in typecheck, lint, tests or
build could have seen it.

## Verified

19 typecheck / 0 lint errors / **276 web tests** / 14 build.

New `layout/templateAdoption.test.ts` (48 tests) is the regression guard for the original
gap: every template places at least one block, places the specific block that renders its
page, references only registered types, uses only declared regions, and passes the tree
rules it will be saved against. That is what "offered but wired to nothing" looks like from
the outside.

**Driven in a real browser** (public pages, no admin session needed): `/members`, `/`,
`/u/root` and `/articles/no-such-article` all render unchanged — directory with filters and
sort box, guest hero with stats and rail, profile header with badge/stats/tabs, and the
article not-found state — with **zero console errors or warnings** across all four loads.
Then the end-to-end proof: a `heading` block saved into `members`' `header` via the API,
published, and visible on the live page above the directory; reset afterwards, `ncf_layouts`
back to 0 rows.

Still not browser-verified: the ACP editor itself (no admin session), and `article.detail`
against a real article (the dev DB has none).

---

# Part -1 — Block audiences (2026-08-09)

WoltLab's box ACL: any block can be limited to guests, members, or specific groups.
`BlockNode.visibility?: { audience, groups }`, absent meaning everyone — so every
existing document is byte-identical and untouched.

## The two rules the design is built around

**It only NARROWS.** Every block already decides its own visibility in code —
`userMenu` shows an avatar or a sign-in button, `notifications` renders nothing for
guests. An audience sits on top: when it admits the viewer, the block's own gate still
runs. Nothing an admin (or an imported theme) writes into a layout can reveal what the
code would have withheld. This is the concrete form of ADR-0005's "a document must never
widen access".

**It is presentation, not access control.** Hiding `whosOnline` from guests does not stop
the endpoint answering a guest. The editor says this out loud in a hint under the control,
because an admin will otherwise reasonably assume the opposite — and `docs/plugin-blocks.md`
tells block authors to gate the *endpoint*, never rely on an admin's layout choice.

## The asymmetry that makes it usable

**The editor preview never hides.** An admin who limits a block to a group they are not in
would otherwise watch it vanish with no way to select it and undo. So the preview always
renders it, flags the wrapper `data-nv-restricted="<audience>"`, and the TREE carries an
eye-slash marker naming the audience. The live site is where hiding happens.

## Required blocks cannot be restricted

`logo` and `userMenu` may be moved anywhere, including into a container — but an audience
would achieve by hiding exactly what deletion is forbidden to do, leaving a guest a header
with no way into the site and no way to sign in. `validateBlockTree` now takes
`requiredTypes` and refuses it; the editor replaces the control with an explanation. The
explicit `{ audience: 'everyone' }` default is still accepted, since it restricts nobody.

## Files

- `packages/contracts/src/layout.ts` — `BLOCK_AUDIENCES`, `blockVisibilitySchema`,
  `BlockViewer`, `isBlockVisibleTo()`, `isRestricted()`, `BlockNode.visibility`,
  `validateBlockTree({ requiredTypes })`.
- `apps/web/src/layout/LayoutRenderer.tsx` — `useBlockViewer()` reads **`lib/authStore`
  directly**, not `hooks/useAuth`, which calls `api.tryRefresh()` at module import: the
  renderer must not drag a network request into every context that renders a layout. Uses
  FULL group membership, not `visibleGroups` — hiding a badge is a display choice and must
  never change what a user can see (BUGS.md #1).
- `apps/web/src/layout/blockTree.ts` — `updateBlockVisibility()`, which **deletes** the
  field when set back to everyone. Absent and default render identically, so storing the
  default would make two identical layouts compare unequal — and draft-vs-live "pending"
  is a `JSON.stringify`, so a restriction added and removed would leave the draft looking
  changed forever.
- `apps/web/src/features/admin/pages/BlockVisibility.tsx` — **new**. Audience radios +
  group checkboxes from `/admin/groups`.
- `LayoutTree.tsx` — eye-slash marker on restricted rows.
- `layout.service.ts` / `theme.service.ts` — `requiredTypes: REQUIRED_BLOCKS[key]`.
- SCSS + locales ×5 (`visibility`, `audience.*`, `audienceNobody`, `audienceNote`,
  `audienceRequired`).

## Why not `GroupAccessPicker`

It was the obvious candidate — `@nodevo/ui`'s picker is the one shared way to express §39
visibility — but `GroupAccessValue` does not fit a block: its `level` mode needs a
progression level that `AuthUser` does not carry (a mode that silently never matches is
worse than no mode), `hideIfNoAccess` is meaningless when hiding is the only behaviour a
block has, and it has no "guests only" — the mode an admin reaches for first. The new
control deliberately reuses the same vocabulary so nobody learns two systems.

## Verified

`backbone:check` green (216 web + 74 API tests). New coverage: `isBlockVisibleTo` and the
required-block refusal (contracts, via `layout.test.ts`), the renderer's hide-vs-preview
split against real auth state, `updateBlockVisibility`'s delete-on-default and its
round-trip identity, the tree marker, and the audience control (14 tests).

Driven against `:4000`, 14/14: audiences round-trip at depth · an unrestricted block
stores no `visibility` key at all · a required `logo` refuses group/members/guests
restrictions with a 422, nested or not · the explicit `everyone` default is accepted · an
audience outside the enum is refused by the schema · publish → public `/api/layouts`
carries the rules (the CLIENT applies them) · reset. `ncf_layouts` left at 0 rows.

⚠ **The dev admin's user id changes after every `vitest run`** (the installer test
re-seeds it), so the API-driving scripts take it as an argument from a live
`select id from ncf_users where username='root'` rather than hardcoding one.

**Not verified: a browser click-through.** Same reason as Part 0 — no admin session.

---

# Part 0 — Block nesting (2026-08-09)

Containers stopped being dead ends. `LayoutRenderer` already recursed into
`node.children` and `section`/`columns` were already declared `container: true`, but the
editor had no concept of children and `moveBlock` was flat region→region — so an admin
could add a Section and never put anything in it. Two of the three structure blocks did
nothing.

## The load-bearing choices

**A column is a block, not a slot.** `columns` holds N `column` children rather than N
named child *lists*. One uniform tree means one addressing model: every node is reachable
by id, and moving into a column is the same operation as moving into a section. Named
slots would have been a second nesting concept sitting beside regions, doubling every
path.

**The track count is not a prop.** `columns.count` was removed; the number of tracks IS
the number of `column` children. A count that duplicates the tree is a count that will
disagree with it — a `count: 3` beside two columns is a silent empty track, and every
edit would have to reconcile the two.

**Addressing stays by id.** Ids are already stable across reordering and already what the
preview reports back, so one lookup serves the tree, the preview and the ↑/↓ buttons. An
index path would need recomputing after every edit.

## Files

- `packages/contracts/src/layout.ts` — `column` prop schema; `columns` loses `count`;
  `MAX_BLOCK_DEPTH` (5); `CORE_CONTAINER_TYPES`; **`validateBlockTree()`**;
  **`blockTypesIn` now recurses**.
- `apps/web/src/layout/blockTree.ts` — replaces `moveBlock.ts`. `findNode`,
  `subtreeHeight`, `containsId`, `collectIds`, `insertBlock`, `removeBlock`,
  `updateBlockProps`, `moveBlock`, `canNestInto`. Pure, and an operation that refuses
  returns the **original object by reference**, so callers detect a refusal by identity
  and a refused drag never marks the draft dirty.
- `apps/web/src/layout/blockRegistry.ts` — `childTypes`, `editorMeta.onlyInside`,
  `acceptsChild()`, `listPlaceableBlocks(template, parentType)`.
- `apps/web/src/layout/LayoutRenderer.tsx` — stamps `data-nv-parent`, `data-nv-region`
  and `data-nv-container` on preview wrappers.
- `apps/web/src/layout/previewBridge.ts` — walks outwards for a drop parent that will
  accept the block; siblings from `data-nv-parent`.
- `apps/web/src/features/admin/pages/LayoutTree.tsx` — **new**, extracted from the page:
  recursive `BlockList`/`TreeNode` plus `BlockPicker` and `TreeCtx`.
- `LayoutEditorPage.tsx` — `applyTree`, `nudge`, `canDropInto`, `hover`/`dropHere`,
  `makeNode` (seeds two columns), collision-checked `uid`.
- `layout.service.ts` / `theme.service.ts` — `validateBlockTree` on save, and the same
  checks in the import's **pre-write** pass.
- SCSS: `--lay-depth` indentation, container rule, `.nv-column`, `nv-columns--1…4`.
- Locales ×5: `addInside`, `emptyContainer`, `moveUp`, `moveDown`, `removeBlock`.

## Guards, and why each exists

`validateBlockTree` rejects what the editor cannot produce but an imported `.nvtheme`
can: nesting past `MAX_BLOCK_DEPTH` (an unbounded document is a render bomb, not a
layout), **duplicate ids** (both the tree and the preview address by id, so a duplicate
makes every edit land on whichever node comes first), children on a core block that
cannot hold them, and a `column` outside a `columns` row. Children on an *unknown* type
are permitted — core cannot know whether a plugin block is a container. `moveBlock`
separately refuses cycles: a container inside its own descendant renders until the stack
runs out.

## Two bugs found by writing the tests, not by the checks

1. **`resolveDropParent` passed a block id where `acceptsChild` expects a block type.**
   Both are strings, so it typechecked, linted, built and passed every existing test —
   while making the registry lookup miss, rejecting *every* container, so a preview drop
   always fell out to the region. `canDropInto` in the editor had the identical mistake.
   Fixed by resolving the type (`data-nv-type`, and `findNode(...).node.type`).
2. **The tree's row actions had no accessible name** — icon-only buttons with no
   `title`/`aria-label`. Found because the test could not address them.

Also fixed while here: `blockTypesIn` was shallow, so dropping the header's `logo` into a
section would have been refused as "missing logo" — the save an admin just made. And the
theme import called `saveDraft` per template inside its staging loop, so a rule tripping
on template 3 of 8 left the first two applied, breaking the all-or-nothing promise in its
own header comment.

## New test infrastructure

`jsdom` + `@testing-library/react` + `@testing-library/dom` as `apps/web` devDeps, opted
into per file via `@vitest-environment jsdom` so the pure-logic suites stay in node. ⚠
**jsdom is an optional peer of vitest**, so adding it changed vitest's pnpm hash and left
every *other* workspace package's `node_modules/vitest` symlink dangling — `pnpm install`
relinks them. Worth knowing before blaming the code.

Web tests 93 → 169: `blockTree.test.ts` (42), `layout.test.ts` (21 → 37, adding
`validateBlockTree`, the registry's parent/child rules and `blockTypesIn`),
`LayoutRenderer.test.tsx` (24 — the DOM contract *and* the real bridge functions, run
against DOM the real renderer produced rather than a hand-built fixture that could agree
with the test while disagreeing with the app), `LayoutTree.test.tsx` (27),
`coreBlocks.test.tsx` (9).

## Verified

`pnpm backbone:check` fully green (19 typecheck / 0 lint errors / 169 web + 74 API tests
/ 14 build). Plus a real run against `:4000` with a minted HS256 token: nested save →
read back at depth 4 → all five rule violations refused with correct 422s → nested chrome
accepted → a genuinely incomplete header still refused → publish → public `/api/layouts`
serves the tree → reset. `ncf_layouts` left at 0 rows, as found.

**Not verified: the editor in a browser.** No admin session was available. Given that
four bugs in this same build once passed typecheck/lint/test/build, the jsdom suites were
added to cover the renderer, the bridge's target resolution and the tree's wiring — but
drag *gestures* and the visual result still want a human click-through.

---

# Part 1 — Block layout composition (ADR-0005 + Amendment 1)

Page structure stops being compiled markup and becomes a **document**: an ordered list of blocks
per named region, per template. Spec: `d0cs/adr/0005-block-layout-composition.md` (gitignored).

**The load-bearing decision, and it reverses §24 of the v1 spec.** §24 planned `.nvtheme` packages
shipping `components/Button.tsx` and `layouts/Header.tsx` — executable code. That was dropped:

| | Contains | Trust |
|---|---|---|
| **Theme** | layout documents + tokens + assets. **Never executes.** | none needed — validated against a schema |
| **Plugin** | code: blocks, routes, migrations, licensing | trusted, reviewed |

A theme bundle would be same-origin JS with access to the auth store — there is no sandbox short of
iframes or a bespoke DSL. And override points become permanent public API: WoltLab's template groups
are hand-merged forks, and WSC 6.0 broke most existing styles. "I need a component that doesn't
exist" is now answered by *ship a plugin that registers a block*, which also gets permissions,
migrations and licensing. §24 and the two affected spec passages are annotated as superseded.

## Contracts — `packages/contracts/src/layout.ts`

`TemplateKey` (a fixed enum — a layout re-arranges pages that exist, it never owns routes, which is
what removes WordPress-FSE-style template hierarchy), `TEMPLATE_REGIONS`, `LayoutDocument`,
`BlockNode`, `LocalizedText`, per-block Zod prop schemas, `DEFAULT_LAYOUTS`, `REQUIRED_BLOCKS`,
`parseLayoutDocument` (never throws — a template must always render).

Six page templates plus `chrome.header` (left/center/right) and `chrome.footer` (top/main/bottom).
Auth screens and the entire ACP are excluded **permanently**: an admin must never be able to
rearrange the screen they would need in order to repair a broken arrangement.

`LocalizedText` exists because converting a page to a document would otherwise hardcode English —
props accept a literal (admin typed it) or `{ key, ns }` (code defaults).

## Storage & API

- `ncf_layouts` (migration `20260726120000`) — at most two rows per template, `draft` and
  `published`, unique on `(template_key, scope)`. **Absence is valid**: no row renders the code
  default, which is also what Reset restores by deleting rows.
- `apps/api/src/modules/layouts/` — admin CRUD under `/api/admin/layouts` (audited, `admin.access`)
  plus public `GET /api/layouts`, memoized 30 s. Publish is site-wide, promotes every pending draft
  and clears them, then **bumps the appearance style version** so open tabs refresh over the
  existing SSE stream rather than a second push channel.
- `apps/api/src/modules/themes/` — `.nvtheme` export/import. Export packages what is **published**;
  import validates everything *before* writing and stages into the **draft**, never live.
  All-or-nothing: one bad layout applies none of the package.

## Renderer & registry — `apps/web/src/layout/`

- `blockRegistry` mirrors `slotRegistry` and is exposed on `window.__NODEVO_HOST__.webBlockRegistry`
  **from day one**, with `pluginId` ownership and `deregisterBlocksFor`.
- `LayoutRenderer` owns three failure rules, none of which can take a site down: an invalid document
  falls back to the code default; an **unknown block type is skipped and KEPT in the document** (so
  disabling a plugin never deletes an admin's layout, and re-enabling restores it in place); a
  throwing block degrades behind an error boundary while its siblings render.
- `useLayout` — one request for all templates, invalidated by the style-version event, never
  returning undefined (defaults while loading and on failure).
- 20 blocks: structure/content/data (`section`, `columns`, `spacer`, `heading`, `richText`, `image`,
  `articleIndex`, `pluginSlot`) and chrome (`logo`, `navLinks`, `search`, `themeToggle`,
  `notifications`, `adminLink`, `headerWidgets`, `userMenu`, `whosOnline`, `groupLegend`,
  `boardStats`, `branding`).

`pluginSlot` and `headerWidgets` are not optional: plugins render through `slotRegistry` today, so
without them a custom layout would silently remove the forum, shoutbox or messaging UI. Existing
`registerHeaderWidget` plugins need **no change**.

## Editor — ACP → Appearance → Layout Editor

Structure/settings rail beside a live preview (the same list ⇄ preview model ADR-0003 locked for the
Style Editor). Block settings are generated from each block's Zod schema via `z.toJSONSchema` — the
renderer was extracted to `components/SchemaFields.tsx` and now serves both this and the
scheduled-task params form.

- **Edits appear instantly.** The editor pushes the in-progress document to the preview iframe over
  `postMessage`; the preview prefers it over the fetched one.
- **The draft autosaves** (700 ms, `useAutosave`). There is no save button — without autosave an
  admin could rearrange, hit Publish and have nothing happen, since Publish promotes a *stored*
  draft.
- **Drag anywhere** — in the tree (cross-region) and inside the preview itself. `↑`/`↓` remain the
  keyboard path. Hover outlines a block (dashed) with its type; click selects it in the tree; tree
  selection highlights it in the preview.
- Required blocks (`logo`, `userMenu`) have no delete control, enforced again in the API.

`previewBridge.ts` runs inside the iframe. Each block is wrapped in a `display: contents` element
carrying `data-nv-block`, so the preview's layout is byte-identical to the live page — such a
wrapper has no box, so the bridge **measures the block's first real element and draws separate
overlays** instead of styling anything. The wrapper exists only in preview. Dragging is ordinary
HTML5 DnD *within* the iframe; only the result crosses the boundary, and both directions check
`e.origin`.

## Chrome (Amendment 1)

`PubNav` and `SiteFooter` are now thin hosts rendering regions; their markup moved into blocks
verbatim, so the shipped defaults render identically to the previous hardcoded arrangement.

## Docs

`docs/plugin-blocks.md` (new, committed) — authoring contract. `README.md` — feature bullet plus a
"Layout system" section covering templates, editing behaviour, failure behaviour and `.nvtheme`.
`docs/API.md` — public `/api/layouts` and the admin layouts/themes tables. `CLAUDE.md` — layout
one-liner; also corrected the spec path (`d0cs/`, not `docs/`) and flagged §24 as superseded.

---

# Part 2 — Admin-created scheduled tasks

Unchanged from the earlier record: `ncf_scheduled_tasks` + `ncf_scheduled_task_runs`, a core-only
action registry (no arbitrary-code path), one BullMQ queue with a boot reconcile, `/api/admin/tasks`
behind the new `system.tasks.manage`, and five actions — `recompute-counters`,
`purge-orphaned-uploads`, `purge-deleted-content`, `trim-article-revisions`, `prune-notifications`.
Plus `fix(retention)`: dead sessions had **no cleanup path at all** (a refresh rotation inserts a
row and revokes the old one — ~96 rows/user/day), now pruned with an index to match.

---

## Verification

`pnpm backbone:check` green throughout (19 typecheck / 0 lint errors / 73 tests / 14 build).
Migrations applied to a **fresh** database, not just the dev one. Driven in the ACP end to end:
compose → autosave → publish → live site updates → reset; `.nvtheme` export → reset → import →
staged as draft with the live site untouched; drag in tree and in preview; required-block deletion
refused by the API.

**Four bugs in this build passed typecheck, lint, tests and build while being plainly broken** —
worth remembering as a class:

1. `z.toJSONSchema` emits `anyOf` for unions, and the form renderer only understood flat types, so
   the Heading block's `Text`/`Eyebrow`/`Level` fields **silently did not render**.
2. `onDrop` read the drop position from React state, so it only worked if a re-render happened
   between `dragover` and `drop` — fine in slow drags, dead in fast ones. Moved to a ref.
3. Zone CSS was written to `apps/web/src/layouts/PubNav.scss`, a file that did not exist and nothing
   imports; the navbar wrapped to two rows. Real rules live in `AppLayout.scss`.
4. The preview only reflected saved drafts, so editing then publishing published nothing — the two
   symptoms the user reported were one cause.

## Not done

- §24 of `d0cs/v1-spec.md` is annotated as superseded but not rewritten.
- The forum plugin's `forum.categories` block builds and typechecks but has not run — no plugins are
  installed in the dev DB, and installing one runs its migrations.
- Automated tests cover the pure logic (`parseLayoutDocument`, `moveBlock`, registry — 43 web tests);
  the editor and preview bridge are verified by driving them, not by specs.
