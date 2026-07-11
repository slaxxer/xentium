import type { RequestHandler } from "express";
import path from "node:path";
import { prisma } from "../../infrastructure/db.js";
import { storage } from "../../infrastructure/storage/LocalStorageProvider.js";
import { CorePermissions } from "@nodevo/contracts";
import { articleService } from "./article.service.js";
import { trackArticleView } from "./article.views.js";
import { getSetting } from "../../shared/utils/settings.js";
import {
  articleIdParamSchema,
  articleSlugParamSchema,
  createArticleSchema,
  listArticlesQuerySchema,
  updateArticleSchema,
} from "./article.validation.js";

async function viewerPerms(userId: string | undefined): Promise<Set<string>> {
  if (!userId) return new Set();
  const rows = await prisma.groupPermission.findMany({
    where: { group: { users: { some: { userId } } } },
    select: { permission: { select: { key: true } } },
  });
  return new Set(rows.map((r) => r.permission.key));
}

export const articlesController = {
  list: (async (req, res) => {
    // Use admin's articles.per_page setting as default when client doesn't specify limit
    const perPage = await getSetting("articles.per_page", 20);
    const query = listArticlesQuerySchema.parse({
      ...req.query,
      limit: req.query.limit ?? perPage,
    });
    const viewerId = req.userId;
    const result = await articleService.list(query, viewerId);
    res.json(result);
  }),

  listMine: (async (req, res) => {
    const viewerId = req.userId!;
    const { page, limit, status } = listArticlesQuerySchema.parse(req.query);
    const result = await articleService.listMine(viewerId, { page, limit, status });
    res.json(result);
  }),

  popularTags: (async (_req, res) => {
    res.json(await articleService.popularTags(12));
  }),

  getBySlug: (async (req, res) => {
    const { slug } = articleSlugParamSchema.parse(req.params);
    const viewerId = req.userId;
    const perms = await viewerPerms(viewerId);
    const canEditAny = perms.has(CorePermissions.ARTICLE_EDIT_ANY);
    const article = await articleService.getBySlug(slug, viewerId, canEditAny);
    res.json(article);
  }),

  create: (async (req, res) => {
    const input = createArticleSchema.parse(req.body);
    const viewerId = req.userId!;
    const article = await articleService.create(viewerId, input);
    res.status(201).json(article);
  }),

  update: (async (req, res) => {
    const { id } = articleIdParamSchema.parse(req.params);
    const input = updateArticleSchema.parse(req.body);
    const viewerId = req.userId!;
    const perms = await viewerPerms(viewerId);
    const canEditAny = perms.has(CorePermissions.ARTICLE_EDIT_ANY);
    const article = await articleService.update(id, viewerId, canEditAny, input);
    res.json(article);
  }),

  publish: (async (req, res) => {
    const { id } = articleIdParamSchema.parse(req.params);
    const viewerId = req.userId!;
    // requirePermission(ARTICLE_PUBLISH) gates this route — no inline check needed
    const article = await articleService.publish(id, viewerId);
    res.json(article);
  }),

  unpublish: (async (req, res) => {
    const { id } = articleIdParamSchema.parse(req.params);
    const viewerId = req.userId!;
    const perms = await viewerPerms(viewerId);
    const canEditAny = perms.has(CorePermissions.ARTICLE_EDIT_ANY);
    const article = await articleService.unpublish(id, canEditAny);
    res.json(article);
  }),

  remove: (async (req, res) => {
    const { id } = articleIdParamSchema.parse(req.params);
    const viewerId = req.userId!;
    const perms = await viewerPerms(viewerId);
    const canDeleteAny = perms.has(CorePermissions.ARTICLE_DELETE_ANY);
    await articleService.softDelete(id, viewerId, canDeleteAny);
    res.status(204).send();
  }),

  listRevisions: (async (req, res) => {
    const { id } = articleIdParamSchema.parse(req.params);
    const viewerId = req.userId!;
    const perms = await viewerPerms(viewerId);
    const canEditAny = perms.has(CorePermissions.ARTICLE_EDIT_ANY);
    const revisions = await articleService.listRevisions(id, viewerId, canEditAny);
    res.json(revisions);
  }),

  registerView: (async (req, res) => {
    const { id } = articleIdParamSchema.parse(req.params);
    const counted = await trackArticleView(id, req.ip);
    res.json({ counted });
  }),

  uploadFeaturedImage: (async (req, res) => {
    const { id } = articleIdParamSchema.parse(req.params);
    const viewerId = req.userId!;
    const perms = await viewerPerms(viewerId);
    const canEditAny = perms.has(CorePermissions.ARTICLE_EDIT_ANY);

    // upload middleware already validated size + magic-byte MIME
    const file = req.file!;
    const ext = file.detectedExt ?? "bin";
    const filename = `featured.${ext}`;
    const relPath = await storage.save(path.join("articles", id), filename, file.buffer);

    const article = await articleService.setFeaturedImage(id, relPath, viewerId, canEditAny);
    res.status(201).json({ article, url: storage.publicUrl(relPath) });
  }),
} satisfies Record<string, RequestHandler>;
