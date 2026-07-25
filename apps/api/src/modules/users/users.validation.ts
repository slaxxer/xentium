// apps/api/src/modules/users/users.validation.ts

import { z } from "zod";

export const getProfileParamsSchema = z.object({
  username: z.string().min(3).max(50),
});

export const followParamsSchema = z.object({
  id: z.string().uuid(),
});

export const createCommentSchema = z.object({
  body: z.string().min(1).max(2000),
});

// ProfileComment ids are cuid (Prisma @default(cuid())), NOT uuid — validating
// as uuid rejected every real id with a 422 before the handler ran (profile
// comment update/delete never worked; surfaced by the #3 live E2E).
export const updateCommentSchema = z.object({
  commentId: z.string().cuid(),
});

export const deleteCommentParamsSchema = z.object({
  commentId: z.string().cuid(),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const searchQuerySchema = z.object({
  q: z.string().min(1).max(50),
  limit: z.coerce.number().int().min(1).max(10).default(5),
});
