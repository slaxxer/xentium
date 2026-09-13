/**
 * Whole-page blocks (ADR-0005) — the bulk template adoption of 2026-08-09.
 *
 * Before this, five of the eight templates were offered by the layout editor and
 * wired to nothing: an admin could compose `home`, `profile`, `members` or
 * `article.detail`, autosave, publish, see "pending" clear — and the real page
 * never changed. `page.detail` was adopted properly (three blocks, see
 * `pageDetailBlocks.tsx`); these four wrap each page's existing component tree whole.
 *
 * ## Why one block per page
 *
 * Chosen deliberately over decomposing them. Every one of these pages couples a
 * page head to interactive state — a title row whose other half is a tab switcher
 * driving the body below — so any finer split either moves controls away from what
 * they drive or breaks the flex row they share. One block guarantees the adoption
 * is visually a no-op, which matters when the alternative is silently redesigning
 * every existing site.
 *
 * What an admin gets today is the regions AROUND the page: a hero in `header`, a
 * plugin block in `aside`, a call to action in `footer`. Going finer later is
 * purely additive — new block types plus a changed default — and an unknown type is
 * kept rather than dropped, so no stored document breaks.
 *
 * ## Why these fetch, when core blocks are not supposed to
 *
 * `blockRegistry`'s rule is "blocks render, the host fetches", and its stated
 * reason is that a querying block "would move access control into theme-authored
 * configuration". These carry **no props at all**, so there is nothing a document
 * can configure: it decides only whether and where the page renders, exactly as the
 * route did before. Every endpoint behind them still applies its own permissions.
 * A block with a data-selecting prop — a group id, a category filter — would be the
 * thing that rule forbids, and none of these have one.
 */
import { blockPropSchemas } from "@xentium/contracts";
import { registerBlock } from "../blockRegistry";
import { ArticleReaderContent } from "../../features/articles/ArticleReaderPage";



registerBlock({
  type:   "articleDetail",
  schema: blockPropSchemas.articleDetail,
  editorMeta: { label: "Article", category: "data", allowedTemplates: ["article.detail"], wide: true },
  component: () => <ArticleReaderContent />,
});
