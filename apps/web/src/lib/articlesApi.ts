import { api } from "./api";
import type { PaginatedResponse } from "@xentium/contracts";

export type ArticleStatus = "draft" | "review" | "published";
export type ArticleVisibility = "public" | "members" | "private";

export interface ArticleAuthorGroup {
  group: {
    id: string; name: string; key: string; icon: string | null; displayOrder: number;
    progression: { badgeColor: string | null; badgeLabel: string | null } | null;
  };
}

export interface ArticleAuthor {
  id:         string;
  username:   string;
  avatar:     string | null;
  badgeColor: string | null;
  groups:     ArticleAuthorGroup[];
}

export interface ArticleCategoryRef {
  id: string;
  name: string;
  slug: string;
}

export interface ArticleTagRef {
  id: string;
  name: string;
  slug: string;
}

export interface ArticleListItem {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  featuredImage: string | null;
  status: ArticleStatus;
  visibility: ArticleVisibility;
  publishedAt: string | null;
  likeCount: number;
  dislikeCount: number;
  commentCount: number;
  viewCount: number;
  /** Estimated reading time in whole minutes (min 1). */
  readTime: number;
  /** Pinned by staff to the top of the article index. */
  pinned?: boolean;
  author: ArticleAuthor;
  category: ArticleCategoryRef | null;
  tags: ArticleTagRef[];
  createdAt: string;
  updatedAt: string;
  /** The signed-in viewer's own state. Absent for guests. */
  viewer?: { liked: boolean; disliked?: boolean; saved: boolean };
}

export interface ArticleDetail extends ArticleListItem {
  body: unknown;
  seoTitle: string | null;
  seoDescription: string | null;
  /** Staff closed the comments; `article.comment.closed` may still post. */
  commentsClosed: boolean;
  /** Staff hid the article; only its author and `article.hide` see it. */
  hidden: boolean;
}

export interface ArticleComment {
  id: string;
  articleId: string;
  parentId: string | null;
  body: string | null;
  author: ArticleAuthor;
  deletedAt: string | null;
  deletedReason: string | null;
  deletedByUsername: string | null;
  editedAt: string | null;
  createdAt: string;
  likeCount: number;
  dislikeCount: number;
  /** How the signed-in viewer reacted (thumbs up / down). Absent for guests. */
  viewerReaction?: "like" | "dislike" | null;
  replies: ArticleComment[];
}

export interface CommentReactionCounts { likeCount: number; dislikeCount: number }

export interface ArticleCategoryNode {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  position: number;
  visibility: string;
  visibilityGroups: string[];
  visibilityMinLevel: number | null;
  hideIfNoAccess: boolean;
  effectiveVisibility: string;
  children: ArticleCategoryNode[];
  /** Published articles in it the viewer may see. */
  count?: number;
}

export type ArticlePeriod = "week" | "month" | "year";
export type ArticleLength = "short" | "medium" | "long";
export type ArticleSort = "latest" | "popular" | "discussed";

export interface TrendingArticle { id: string; slug: string; title: string; likeCount: number; commentCount: number }

export type HomeFeed = "latest" | "following" | "top" | "liked" | "saved" | "mine";

/** The categories and tags a member follows (their Following feed). */
export interface FollowedTopics {
  categories: { id: string; name: string; slug: string }[];
  tags: { id: string; name: string; slug: string }[];
}

export interface ListArticlesParams {
  page?: number;
  limit?: number;
  categoryId?: string;
  authorId?: string;
  status?: ArticleStatus;
  /** following = followed categories and tags; liked / saved / mine = the viewer's own. */
  feed?: HomeFeed;
  /** The article index's filters (see the API's listArticlesQuerySchema). */
  q?: string;
  tag?: string;
  period?: ArticlePeriod;
  length?: ArticleLength;
  sort?: ArticleSort;
  exclude?: string;
}

export interface CreateArticleInput {
  title: string;
  body: unknown; // TipTap JSON
  excerpt?: string;
  categoryId?: string;
  tags?: string[];
  visibility?: ArticleVisibility;
  seoTitle?: string;
  seoDescription?: string;
}

export type UpdateArticleInput = Partial<CreateArticleInput>;

function qs(params: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length === 0 ? "" : `?${parts.join("&")}`;
}

export const articlesApi = {
  list: (params: ListArticlesParams = {}) =>
    api.get<PaginatedResponse<ArticleListItem>>(`/articles${qs({ ...params })}`),
  listMine: (params: ListArticlesParams = {}) =>
    api.get<PaginatedResponse<ArticleListItem>>(`/articles/me${qs({ ...params })}`),
  popularTags: () =>
    api.get<{ name: string; slug: string; count: number }[]>("/articles/tags/popular"),
  featured: () => api.get<{ article: ArticleListItem | null }>("/articles/featured"),
  trending: (days = 30, max = 5) => api.get<TrendingArticle[]>(`/articles/trending?days=${days}&max=${max}`),
  pin: (id: string, pinned: boolean) => api.post<{ pinned: boolean }>(`/articles/${id}/pin`, { pinned }),
  closeComments: (id: string, closed: boolean) => api.post<{ closed: boolean }>(`/articles/${id}/comments-closed`, { closed }),
  hide: (id: string, hidden: boolean) => api.post<{ hidden: boolean }>(`/articles/${id}/hidden`, { hidden }),
  getBySlug: (slug: string) => api.get<ArticleDetail>(`/articles/${encodeURIComponent(slug)}`),
  create: (input: CreateArticleInput) => api.post<ArticleDetail>("/articles", input),
  update: (id: string, input: UpdateArticleInput) =>
    api.patch<ArticleDetail>(`/articles/${id}`, input),
  publish: (id: string) => api.post<ArticleDetail>(`/articles/${id}/publish`),
  unpublish: (id: string) => api.post<ArticleDetail>(`/articles/${id}/unpublish`),
  remove: (id: string) => api.delete<void>(`/articles/${id}`),
  like: (id: string) => api.post<{ likeCount: number; dislikeCount: number }>(`/articles/${id}/like`),
  unlike: (id: string) => api.delete<{ likeCount: number; dislikeCount: number }>(`/articles/${id}/like`),
  dislike: (id: string) => api.post<{ likeCount: number; dislikeCount: number }>(`/articles/${id}/dislike`),
  undislike: (id: string) => api.delete<{ likeCount: number; dislikeCount: number }>(`/articles/${id}/dislike`),
  comments: (id: string, page = 1, limit = 20) =>
    api.get<PaginatedResponse<ArticleComment>>(`/articles/${id}/comments${qs({ page, limit })}`),
  postComment: (id: string, body: string, parentId?: string | null) =>
    api.post<ArticleComment>(`/articles/${id}/comments`, { body, parentId }),
  updateComment: (commentId: string, body: string) =>
    api.patch<ArticleComment>(`/article-comments/${commentId}`, { body }),
  deleteComment: (commentId: string, reason?: string) =>
    api.delete<void>(`/article-comments/${commentId}`, reason ? { reason } : undefined),
  likeComment: (commentId: string) => api.post<CommentReactionCounts>(`/article-comments/${commentId}/like`),
  unlikeComment: (commentId: string) => api.delete<CommentReactionCounts>(`/article-comments/${commentId}/like`),
  dislikeComment: (commentId: string) => api.post<CommentReactionCounts>(`/article-comments/${commentId}/dislike`),
  undislikeComment: (commentId: string) => api.delete<CommentReactionCounts>(`/article-comments/${commentId}/dislike`),
  uploadFeaturedImage: (id: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return api.post<{ article: ArticleDetail; url: string }>(`/articles/${id}/featured-image`, fd);
  },
  registerView: (id: string) => api.post<{ counted: boolean }>(`/articles/${id}/view`),
  save:   (id: string) => api.post<{ saved: true }>(`/articles/${id}/bookmark`),
  unsave: (id: string) => api.delete<{ saved: false }>(`/articles/${id}/bookmark`),
  followedTopics:   () => api.get<FollowedTopics>("/articles/topics/following"),
  followCategory:   (id: string) => api.post<FollowedTopics>(`/articles/categories/${id}/follow`),
  unfollowCategory: (id: string) => api.delete<FollowedTopics>(`/articles/categories/${id}/follow`),
  followTag:        (id: string) => api.post<FollowedTopics>(`/articles/tags/${id}/follow`),
  unfollowTag:      (id: string) => api.delete<FollowedTopics>(`/articles/tags/${id}/follow`),
};

export const articleCategoriesApi = {
  tree: () => api.get<ArticleCategoryNode[]>("/article-categories"),
};
