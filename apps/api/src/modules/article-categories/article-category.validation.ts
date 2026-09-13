import { z } from "zod";
import { VISIBILITY_MODES } from "@xentium/sdk";

export const visibilityModeSchema = z.enum(VISIBILITY_MODES);

export const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  parentId: z.string().cuid2().nullable().optional(),
  visibility: visibilityModeSchema.default("public"),
  visibilityGroups: z.array(z.string()).default([]),
  visibilityMinLevel: z.number().int().min(1).nullable().optional(),
  hideIfNoAccess: z.boolean().default(true),
});

export const updateCategorySchema = createCategorySchema.partial();

export const categoryIdParamSchema = z.object({ id: z.string().cuid2() });

export const reorderSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().cuid2(),
        parentId: z.string().cuid2().nullable().optional(),
        position: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(500),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type ReorderInput = z.infer<typeof reorderSchema>;
