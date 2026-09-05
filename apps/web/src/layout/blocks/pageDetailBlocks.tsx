/**
 * Blocks for the `page.detail` template (ADR-0005).
 *
 * A custom page's own parts, as three separate blocks rather than one. The
 * `articleIndex` block is a single block because its filters, list and pagination
 * share interaction state — split across regions, a control in one would be
 * driving a list in another. A page's image, title and body share nothing, so
 * splitting them is what makes the template worth having: the title can sit in the
 * header region, the image can span full width above it, the body can share `main`
 * with a plugin block.
 *
 * None of them fetch. `PageReaderPage` is the host container: it owns the query and
 * the staff check, and passes the resolved page down as context.
 */
import { blockPropSchemas } from "@nodevo/contracts";
import { ArticleContent } from "../../features/articles/components/ArticleContent";
import { registerBlock, type BlockProps } from "../blockRegistry";

/** What `PageReaderPage` resolves and every page block reads. */
export interface PageDetailContext {
  page: {
    id: string;
    title: string;
    body: unknown;
    featuredImage: string | null;
  } | null;
}

/** Blocks restricted to this template, since they need a page to render. */
const ON_PAGE: { allowedTemplates: string[] } = { allowedTemplates: ["page.detail"] };

registerBlock({
  type:   "pageImage",
  schema: blockPropSchemas.pageImage,
  editorMeta: { label: "Page image", category: "data", ...ON_PAGE },
  // Absent rather than a placeholder: most pages carry no featured image, and a
  // gap where one would be is worse than nothing at all.
  component: ({ context }: BlockProps<unknown, PageDetailContext>) =>
    context.page?.featuredImage
      ? <img className="page-view__header-image" src={`/uploads/${context.page.featuredImage}`} alt="" />
      : null,
});

registerBlock({
  type:   "pageTitle",
  schema: blockPropSchemas.pageTitle,
  editorMeta: { label: "Page title", category: "data", ...ON_PAGE },
  component: ({ props, context }: BlockProps<{ level: 1 | 2 }, PageDetailContext>) => {
    if (!context.page) return null;
    // The heading level is an admin choice because a title moved into a region
    // below other headings should not stay an h1, but the TEXT is never one — it
    // is the page's own title, and a layout must not be able to rename a page.
    const Tag = (`h${props.level}`) as "h1" | "h2";
    return <Tag className="page-view__title">{context.page.title}</Tag>;
  },
});

registerBlock({
  type:   "pageBody",
  schema: blockPropSchemas.pageBody,
  editorMeta: { label: "Page body", category: "data", ...ON_PAGE, wide: true },
  component: ({ context }: BlockProps<unknown, PageDetailContext>) =>
    context.page
      ? <div className="page-view__body"><ArticleContent body={context.page.body} /></div>
      : null,
});
