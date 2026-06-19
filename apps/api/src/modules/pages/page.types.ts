export type PageStatus = "draft" | "published";
export type PageVisibility = "public" | "members";

/** Listing shape — no body, used in the ACP table. */
export interface PageListItem {
  id: string;
  slug: string;
  title: string;
  status: PageStatus;
  visibility: PageVisibility;
  publishedAt: Date | null;
  /** Whether any active nav item links to this page. */
  inNav: boolean;
  /** Placement of this page's nav link, or null if not linked. */
  navPlacement: "navbar" | "footer" | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Full shape — public reader + ACP editor. */
export interface PageDetail extends PageListItem {
  body: unknown; // TipTap JSON
  featuredImage: string | null;
  seoDescription: string | null;
}
