import { z } from "zod";

export const paginatedRequestSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().optional(),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export type PaginatedRequest = z.infer<typeof paginatedRequestSchema>;

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

export function buildPaginationMeta(opts: {
  page: number;
  limit: number;
  total: number;
}): PaginationMeta {
  const totalPages = Math.max(1, Math.ceil(opts.total / opts.limit));
  return {
    page: opts.page,
    limit: opts.limit,
    total: opts.total,
    totalPages,
    hasNext: opts.page < totalPages,
    hasPrev: opts.page > 1,
  };
}
