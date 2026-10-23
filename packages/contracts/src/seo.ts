/**
 * Search engines and link previews: what core says about a page, and the slot a
 * plugin fills to turn that into tags, robots.txt and sitemaps.
 *
 * Core and plugins DESCRIBE pages (`PageSource`): what an address is, in words a
 * guest may read. A single `SeoProvider` (the SEO plugin) decides the tags. Without
 * one, core writes plain defaults. Only what a guest can open is ever described or
 * listed: members-only, hidden and unpublished content answers null.
 */

/** What one page is, as a guest may see it. */
export interface PageInfo {
  /** The page's clean path, e.g. `/articles/what-comes-next`. */
  path: string;
  /** `home`, `article`, `profile`, `legal`, `page`, or a plugin's (`forum.thread`). */
  kind: string;
  /** The content's id, when the page shows one item. */
  id?: string;
  /** Which indexing area it belongs to: `articles`, `profiles`, `forum`, … */
  area: string;
  /** The page's own title, without the site name. */
  title: string;
  /** A plain-text summary (an excerpt, a first paragraph, a bio). */
  description?: string | null;
  /** An image for link previews, as a site path (`/uploads/…`) or absolute URL. */
  image?: string | null;
  imageAlt?: string | null;
  author?: { name: string; path?: string } | null;
  publishedAt?: string | null;
  modifiedAt?: string | null;
  /** The way to this page, home first, this page last. */
  breadcrumbs?: Array<{ name: string; path: string }>;
  /** Kind-specific facts for structured data (a thread's reply count, a board name). */
  data?: Record<string, string | number | boolean | null>;
}

/** One address for a sitemap. */
export interface SitemapEntry {
  path: string;
  lastmod?: string | null;
  /** The content behind it, when it is one item: lets the SEO plugin leave out a page
   *  its editor marked "hide from search engines". */
  kind?: string;
  id?: string;
  /** Its indexing area, when it differs from its source's (one source listing pages of
   *  several areas), so turning an area off leaves exactly its pages out. */
  area?: string;
}

/** A provider of page descriptions: core registers its own, plugins theirs. */
export interface PageSource {
  /** Unique: `core.articles`, `xentium-forum.threads`. */
  id: string;
  /** The indexing area its pages belong to (see PageInfo.area). */
  area: string;
  /** A short name for the ACP (`Articles`, `Forum threads`). */
  label: string;
  /** Describe a path this source owns, or null (not ours, or not public). */
  describe?(path: string): Promise<PageInfo | null>;
  /** Every public page this source owns, for the sitemap. */
  list?(): Promise<SitemapEntry[]>;
}

/** One `<meta>` tag. */
export interface MetaTag {
  name?: string;
  property?: string;
  content: string;
}

/** Everything that goes into a page's <head> for search engines and previews. */
export interface HeadTags {
  title: string;
  description?: string | null;
  /** Absolute URL. */
  canonical?: string | null;
  /** `index, follow`, `noindex, follow`, … */
  robots?: string | null;
  meta: MetaTag[];
  /** JSON-LD objects, each written as its own script. */
  jsonLd?: object[];
}

/** The SEO plugin's slot. One provider at a time. */
export interface SeoProvider {
  /** The tags for a page. `defaults` is what core would write without a provider. */
  head(path: string, info: PageInfo | null, defaults: HeadTags): Promise<HeadTags>;
  /** The whole robots.txt. `defaults` is core's. */
  robots?(defaults: string): Promise<string>;
  /** A sitemap file by name (`sitemap.xml` is the index, `sitemap-articles.xml` …), or null. */
  sitemap?(name: string): Promise<string | null>;
}

/** What `GET /api/site/head` answers: the same tags the server writes into the page. */
export type HeadResponse = HeadTags;
