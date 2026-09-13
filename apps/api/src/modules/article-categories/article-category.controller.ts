import type { RequestHandler } from "express";
import { z } from "zod";
import { articleCategoryService } from "./article-category.service.js";
import {
  categoryIdParamSchema,
  createCategorySchema,
  reorderSchema,
  updateCategorySchema,
} from "./article-category.validation.js";
import { prisma } from "../../infrastructure/db.js";
import type { ViewerContext } from "@xentium/sdk";

async function resolveViewer(userId: string | undefined): Promise<ViewerContext | null> {
  if (!userId) return { userId: undefined, groupIds: [] };
  const groupRows = await prisma.userGroup.findMany({
    where: { userId },
    select: { groupId: true },
  });
  return { userId, groupIds: groupRows.map((g) => g.groupId) };
}

const removeQuerySchema = z.object({
  reparentChildren: z
    .union([z.literal("true"), z.literal("false")])
    .default("false")
    .transform((v) => v === "true"),
});

export const articleCategoryController = {
  tree: (async (req, res) => {
    const userId = req.userId;
    const viewer = await resolveViewer(userId);
    const result = await articleCategoryService.tree(viewer);
    res.json(result);
  }),

  create: (async (req, res) => {
    const input = createCategorySchema.parse(req.body);
    const created = await articleCategoryService.create(input);
    res.status(201).json(created);
  }),

  update: (async (req, res) => {
    const { id } = categoryIdParamSchema.parse(req.params);
    const input = updateCategorySchema.parse(req.body);
    const updated = await articleCategoryService.update(id, input);
    res.json(updated);
  }),

  remove: (async (req, res) => {
    const { id } = categoryIdParamSchema.parse(req.params);
    const { reparentChildren } = removeQuerySchema.parse(req.query);
    await articleCategoryService.remove(id, { reparentChildren });
    res.status(204).send();
  }),

  reorder: (async (req, res) => {
    const input = reorderSchema.parse(req.body);
    await articleCategoryService.reorder(input);
    res.status(204).send();
  }),
} satisfies Record<string, RequestHandler>;
