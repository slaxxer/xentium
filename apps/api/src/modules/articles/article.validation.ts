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
  // following = the categories and tags the viewer follows; liked / saved / mine are
  // the viewer's own lists (home menu). All but latest and top need a signed-in viewer.
  feed: z.enum(["latest", "following", "top", "liked", "saved", "mine"]).optional(),
  // The article index's filters. `tag` is a tag slug. `period`: published within the
  // last week / 30 days / this calendar year. `length`: reading time under 5 minutes,
  // 5 to 10, or over 10. `sort`: newest, most liked, most commented.
  tag: z.string().trim().min(1).max(80).optional(),
  period: z.enum(["week", "month", "year"]).optional(),
  length: z.enum(["short", "medium", "long"]).optional(),
  sort: z.enum(["latest", "popular", "discussed"]).optional(),
  /** Leave one article out: the index's featured card shows it above the grid. */
  exclude: z.string().max(40).optional(),
});

/** Trending on the article index: top articles of the last `days`, by likes + comments × 2. */
export const trendingQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  max: z.coerce.number().int().min(1).max(20).default(5),
});

export const pinArticleSchema = z.object({ pinned: z.boolean() });

export type CreateArticleInput = z.infer<typeof createArticleSchema>;
export type UpdateArticleInput = z.infer<typeof updateArticleSchema>;
export type ListArticlesQuery = z.infer<typeof listArticlesQuerySchema>;
