import { z } from "zod";
import { paginatedRequestSchema } from "@nodevo/contracts";

// TipTap body — a ProseMirror doc. Loosely validated (same rationale as
// articles): the editor extends over time and the server treats it as opaque
// JSON for storage. The FE is trusted to send TipTap output.
export const tiptapDocSchema = z.object({
  type: z.string(),
  content: z.array(z.any()).optional(),
});

export const pageStatusSchema = z.enum(["draft", "published"]);
export const pageVisibilitySchema = z.enum(["public", "members"]);

export const createPageSchema = z.object({
  title: z.string().trim().min(2).max(200),
  body: tiptapDocSchema,
  visibility: pageVisibilitySchema.default("public"),
  seoDescription: z.string().trim().max(500).optional(),
});

export const updatePageSchema = createPageSchema.partial();

export const pageIdParamSchema = z.object({
  id: z.string().cuid2(),
});

export const pageSlugParamSchema = z.object({
  slug: z.string().trim().min(1).max(200),
});

export const listPagesQuerySchema = paginatedRequestSchema.extend({
  status: pageStatusSchema.optional(),
  q: z.string().trim().min(1).max(100).optional(),
});

export const addToNavSchema = z.object({
  placement: z.enum(["navbar", "footer"]),
});

export const pageSlotSchema = z.enum(["terms", "privacy", "imprint", "guidelines"]);

export const setSlotSchema = z.object({
  slot: pageSlotSchema,
  pageId: z.string().cuid2().nullable(),
});

export type CreatePageInput = z.infer<typeof createPageSchema>;
export type UpdatePageInput = z.infer<typeof updatePageSchema>;
export type ListPagesQuery = z.infer<typeof listPagesQuerySchema>;
