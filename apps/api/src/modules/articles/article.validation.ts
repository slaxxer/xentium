import { z } from "zod";
import { paginatedRequestSchema } from "@xentium/contracts";

// TipTap body: a ProseMirror doc. Loosely validated — must be an object with
// `type` and an array `content`. Deep schema validation would be brittle as
// the editor adds extensions; the FE is trusted to send TipTap output, and
// the server treats it as opaque JSON for storage + bodyPlain extraction.
export const tiptapDocSchema = z.object({
  type: z.string(),
  content: z.array(z.any()).optional(),
});

export const articleStatusSchema = z.enum(["draft", "review", "published"]);
export const articleVisibilitySchema = z.enum(["public", "members", "private"]);

/** Accepts "" / null / undefined as "no category" — the editor form pre-fills
 *  categoryId with "" when an article has no category, which would otherwise
 *  trip cuid validation on PATCH. */
const optionalCategoryId = z.preprocess(
  (v) => (v === "" || v === null ? undefined : v),
  z.string().cuid2().optional(),
);

export const createArticleSchema = z.object({
  title: z.string().trim().min(3).max(200),
  excerpt: z.string().trim().max(500).optional(),
  body: tiptapDocSchema,
  categoryId: optionalCategoryId,
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  visibility: articleVisibilitySchema.default("public"),
  seoTitle: z.string().trim().max(200).optional(),
  seoDescription: z.string().trim().max(500).optional(),
});

export const updateArticleSchema = createArticleSchema.partial();

export const articleIdParamSchema = z.object({
  id: z.string().cuid2(),
});

export const articleSlugParamSchema = z.object({
  slug: z.string().trim().min(1).max(120),
});

export const listArticlesQuerySchema = paginatedRequestSchema.extend({
  status: articleStatusSchema.optional(),
  categoryId: z.string().cuid2().optional(),
  authorId: z.string().optional(),
  q: z.string().trim().min(1).max(100).optional(),
  feed: z.enum(["latest", "following", "top"]).optional(),
});

export type CreateArticleInput = z.infer<typeof createArticleSchema>;
export type UpdateArticleInput = z.infer<typeof updateArticleSchema>;
export type ListArticlesQuery = z.infer<typeof listArticlesQuerySchema>;
