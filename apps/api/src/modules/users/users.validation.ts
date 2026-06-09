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

export const updateCommentSchema = z.object({
  commentId: z.string().uuid(),
});

export const deleteCommentParamsSchema = z.object({
  commentId: z.string().uuid(),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const searchQuerySchema = z.object({
  q: z.string().min(1).max(50),
  limit: z.coerce.number().int().min(1).max(10).default(5),
});
