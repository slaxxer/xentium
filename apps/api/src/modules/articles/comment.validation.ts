import { z } from "zod";
import { paginatedRequestSchema } from "@nodevo/contracts";

export const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  parentId: z.string().cuid2().nullable().optional(),
});

export const updateCommentSchema = z.object({
  body: z.string().trim().min(1).max(4000),
});

export const deleteCommentSchema = z.object({
  reason: z.string().trim().min(1).max(280).optional(),
});

export const commentIdParamSchema = z.object({ commentId: z.string().cuid2() });

export const listCommentsQuerySchema = paginatedRequestSchema;
