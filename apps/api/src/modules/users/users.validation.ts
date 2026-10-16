// apps/api/src/modules/users/users.validation.ts

import { z } from "zod";

export const getProfileParamsSchema = z.object({
  username: z.string().min(3).max(50),
});

/** `?preview=1`: a glance (the hover card), not a visit — nothing is recorded. */
export const getProfileQuerySchema = z.object({
  preview: z.enum(["1", "true"]).optional(),
});

export const followParamsSchema = z.object({
  id: z.string().uuid(),
});

export const createCommentSchema = z.object({
  body: z.string().min(1).max(2000),
});

/** A new wall comment; `parentId` makes it a reply. */
export const createProfileCommentSchema = createCommentSchema.extend({
  parentId: z.string().cuid().optional(),
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

/** The visitors card is addressed by user id, like every other per-profile route. */
export const visitorParamsSchema = z.object({ id: z.string().min(1) });

/**
 * ⚠ Bounded at 24. The card shows five avatars and a "+N"; an unbounded limit on a
 * public endpoint is a way to ask for every member who ever looked at someone.
 */
export const visitorQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(24).default(5),
});
