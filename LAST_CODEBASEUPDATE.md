# Last codebase update — 2026-09-16

Storefront presentation for the five first-party plugins, plus the plugin-side
half of a listing gallery. Two repos; the marketplace carries most of it.

## xentium (this repo)

| File | Why |
|---|---|
| `packages/plugin-engine/src/manifest.ts` | `screenshots: string[]` (max 6) on the manifest schema. Storefront metadata the host ignores at every step — it is carried so a marketplace can extract a listing's gallery from the artifact it already verifies, instead of from a second upload that drifts out of step with the bytes being sold. |
| `scripts/package-plugin.mjs` | Packs the declared `assets/` into the archive, and FAILS the build on a screenshot that is missing or outside `assets/` — a listing that silently ships four of its five pictures is a packaging bug nobody sees until it is in the shop. |
| `e2e/capture-shots.mjs` | New, and not part of the suite: drives a real logged-in browser over the dev instance and writes the gallery PNGs into each plugin's `assets/`. Viewport is 16:10 to match the storefront's frame exactly; one forced colour scheme, because a gallery that alternates light and dark reads as a mistake; `domcontentloaded` rather than `networkidle`, because the appearance live-sync stream never goes idle. |

Also regenerated (all gitignored): `plugins/official/*/manifest.json` gained
`screenshots`, `plugins/official/*/assets/*.png` are the ten new captures, and
`plugins/packaged/*.xtplugin` were rebuilt at **1.0.0** with those assets inside.

⚠ The repackaged 1.0.0 artifacts have different bytes from the 1.0.0 already
ingested on plugins.xentium.org. `createRelease` refuses to replace a published
version on purpose, so ingesting these needs either the draft releases removed
first or a patch bump — see the session notes.

## xentium-marketplace

| File | Why |
|---|---|
| `prisma/schema.prisma` + `migrations/20260916182803_product_gallery` | `Product.screenshots String[]`. Distinct from a theme's single `screenshotPath`, which is the one picture its CARD leads with. |
| `src/modules/catalog/ingest.service.ts` | `readPackagedImage` factored out of the theme extractor so one copy of the guards serves both, and `extractGallery` on top of it. Stale images are deleted, not orphaned. |
| `src/modules/catalog/listing.routes.ts` | Gallery out as absolute URLs, nulls dropped. |
| `src/modules/ops/ops.routes.ts` | `tags` on the product upsert body — it was settable nowhere. |
| `web/src/pages/PluginDetail.tsx` + `Detail.scss` | A lead image and a thumbnail strip. `contain`, never `cover`: cropping is cropping the thing the picture was taken to show. |
| `web/src/components/ListingCard.tsx` | A listing that CHOSE a colour and a glyph gets them; the hashed hue and the initial stay as the fallback. |
| `scripts/ingest-official.ts` | Icon, accent and tags for the five; capitalised categories; `audited`; and it no longer resets an existing listing's price and state on a re-run. |
| `src/modules/catalog/ingest.e2e.test.ts` | Four gallery cases: ordering, one bad image, a replacing release, and a release that ships none. |
