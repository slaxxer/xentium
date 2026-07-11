import type { RequestHandler } from "express";
import path from "node:path";
import { storage } from "../../infrastructure/storage/LocalStorageProvider.js";
import { pageService } from "./page.service.js";
import {
  addToNavSchema,
  createPageSchema,
  listPagesQuerySchema,
  pageIdParamSchema,
  pageSlugParamSchema,
  setSlotSchema,
  updatePageSchema,
} from "./page.validation.js";

// Express 5 forwards rejected promises from async handlers to the error
// middleware natively — no wrapper needed.
export const pagesController = {
  // Public reader
  getBySlug: (async (req, res) => {
    const { slug } = pageSlugParamSchema.parse(req.params);
    const page = await pageService.getBySlug(slug, req.userId);
    res.json(page);
  }),

  // Admin
  list: (async (req, res) => {
    const query = listPagesQuerySchema.parse(req.query);
    res.json(await pageService.list(query));
  }),

  getById: (async (req, res) => {
    const { id } = pageIdParamSchema.parse(req.params);
    res.json(await pageService.getById(id));
  }),

  create: (async (req, res) => {
    const input = createPageSchema.parse(req.body);
    const page = await pageService.create(req.userId!, input);
    res.status(201).json(page);
  }),

  update: (async (req, res) => {
    const { id } = pageIdParamSchema.parse(req.params);
    const input = updatePageSchema.parse(req.body);
    res.json(await pageService.update(id, input));
  }),

  publish: (async (req, res) => {
    const { id } = pageIdParamSchema.parse(req.params);
    res.json(await pageService.publish(id));
  }),

  unpublish: (async (req, res) => {
    const { id } = pageIdParamSchema.parse(req.params);
    res.json(await pageService.unpublish(id));
  }),

  remove: (async (req, res) => {
    const { id } = pageIdParamSchema.parse(req.params);
    await pageService.remove(id);
    res.status(204).send();
  }),

  addToNav: (async (req, res) => {
    const { id } = pageIdParamSchema.parse(req.params);
    const { placement } = addToNavSchema.parse(req.body);
    res.status(201).json(await pageService.addToNav(id, placement));
  }),

  removeFromNav: (async (req, res) => {
    const { id } = pageIdParamSchema.parse(req.params);
    await pageService.removeFromNav(id);
    res.status(204).send();
  }),

  // Header image — upload middleware already validated size + magic-byte MIME.
  uploadFeaturedImage: (async (req, res) => {
    const { id } = pageIdParamSchema.parse(req.params);
    const file = req.file!;
    const ext = file.detectedExt ?? "bin";
    const relPath = await storage.save(path.join("pages", id), `featured.${ext}`, file.buffer);
    const page = await pageService.setFeaturedImage(id, relPath);
    res.status(201).json({ page, url: storage.publicUrl(relPath) });
  }),

  // Inline body image — stored under the page, returns a URL the editor inserts.
  uploadImage: (async (req, res) => {
    const { id } = pageIdParamSchema.parse(req.params);
    const file = req.file!;
    const ext = file.detectedExt ?? "bin";
    const relPath = await storage.save(path.join("pages", id), `img-${Date.now()}.${ext}`, file.buffer);
    res.status(201).json({ url: storage.publicUrl(relPath) });
  }),

  // Public: slot → { slug, title } for assigned + published pages (footer, register)
  publicSlots: (async (_req, res) => {
    res.json(await pageService.getPublicSlots());
  }),

  // Admin: slot → assigned pageId
  slotAssignments: (async (_req, res) => {
    res.json(await pageService.getSlotAssignments());
  }),

  setSlot: (async (req, res) => {
    const { slot, pageId } = setSlotSchema.parse(req.body);
    await pageService.setSlot(slot, pageId);
    res.status(204).send();
  }),
} satisfies Record<string, RequestHandler>;
