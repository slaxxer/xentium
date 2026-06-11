export type ArticleStatus = "draft" | "review" | "published";
export type ArticleVisibility = "public" | "members" | "private";

export interface ArticleListItem {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  featuredImage: string | null;
  status: ArticleStatus;
  visibility: ArticleVisibility;
  publishedAt: Date | null;
  likeCount: number;
  dislikeCount: number;
  commentCount: number;
  viewCount: number;
  /** Estimated reading time in whole minutes (min 1). Computed from body word count. */
  readTime: number;
  author: {
    id: string; username: string; avatar: string | null; badgeColor: string | null;
    groups: Array<{
      group: {
        id: string; name: string; key: string; icon: string | null;
        progression: { badgeColor: string | null; badgeLabel: string | null } | null;
      };
    }>;
  };
  category: { id: string; name: string; slug: string } | null;
  tags: { id: string; name: string; slug: string }[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ArticleDetail extends ArticleListItem {
  body: unknown; // TipTap JSON
  seoTitle: string | null;
  seoDescription: string | null;
}
