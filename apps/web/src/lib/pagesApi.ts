import { api } from "./api";
import type { PaginatedResponse } from "@nodevo/contracts";

export type PageStatus = "draft" | "published";
export type PageVisibility = "public" | "members";

export type NavPlacement = "navbar" | "footer";

export interface PageListItem {
  id: string;
  slug: string;
  title: string;
  status: PageStatus;
  visibility: PageVisibility;
  publishedAt: string | null;
  inNav: boolean;
  navPlacement: NavPlacement | null;
  createdAt: string;
  updatedAt: string;
}

export interface PageDetail extends PageListItem {
  body: unknown; // TipTap JSON
  featuredImage: string | null;
  seoDescription: string | null;
}

export interface CreatePageInput {
  title: string;
  body: unknown;
  visibility?: PageVisibility;
  seoDescription?: string;
}

export type UpdatePageInput = Partial<CreatePageInput>;

interface ListParams {
  page?: number;
  limit?: number;
  status?: PageStatus;
  q?: string;
}

function qs(params: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length === 0 ? "" : `?${parts.join("&")}`;
}

export const pagesApi = {
  // Public reader
  getBySlug: (slug: string) => api.get<PageDetail>(`/pages/${encodeURIComponent(slug)}`),

  // ACP
  list: (params: ListParams = {}) =>
    api.get<PaginatedResponse<PageListItem>>(`/admin/pages${qs({ ...params })}`),
  getById: (id: string) => api.get<PageDetail>(`/admin/pages/${id}`),
  create: (input: CreatePageInput) => api.post<PageDetail>("/admin/pages", input),
  update: (id: string, input: UpdatePageInput) => api.patch<PageDetail>(`/admin/pages/${id}`, input),
  publish: (id: string) => api.post<PageDetail>(`/admin/pages/${id}/publish`),
  unpublish: (id: string) => api.post<PageDetail>(`/admin/pages/${id}/unpublish`),
  remove: (id: string) => api.delete<void>(`/admin/pages/${id}`),
  addToNav: (id: string, placement: NavPlacement) =>
    api.post<{ navItemId: string }>(`/admin/pages/${id}/nav`, { placement }),
  removeFromNav: (id: string) => api.delete<void>(`/admin/pages/${id}/nav`),
  uploadFeaturedImage: (id: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return api.post<{ page: PageDetail; url: string }>(`/admin/pages/${id}/featured-image`, fd);
  },
  uploadImage: (id: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return api.post<{ url: string }>(`/admin/pages/${id}/image`, fd);
  },
};

/** Public path for a page. Pages live under /p/ to avoid root-route collisions. */
export function pagePath(slug: string): string {
  return `/p/${slug}`;
}
