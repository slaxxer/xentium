import type { RequestHandler } from "express";
import { groupsService } from "./groups.service.js";
import { z } from "zod";

const idParamSchema = z.object({ id: z.string() });

const createSchema = z.object({
  name: z.string().min(2).max(60),
  key: z.string().regex(/^[a-z0-9_-]+$/).min(2).max(40),
  showInTeam: z.boolean().optional(),
});
const updateSchema = z.object({
  name: z.string().min(2).max(60).optional(),
  showInTeam: z.boolean().optional(),
});
const setPermsSchema = z.object({ permissionKeys: z.array(z.string()) });
const reorderSchema = z.object({
  items: z.array(z.object({ id: z.string(), displayOrder: z.number().int().min(0).max(9999) })).min(1),
});

export const groupsController = {
  list: (async (_req, res) => {
    res.json(await groupsService.list());
  }) as RequestHandler,

  reorder: (async (req, res) => {
    const { items } = reorderSchema.parse(req.body);
    res.json(await groupsService.reorder(items));
  }) as RequestHandler,

  getById: (async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.json(await groupsService.getById(id));
  }) as RequestHandler,

  create: (async (req, res) => {
    const body = createSchema.parse(req.body);
    res.status(201).json(await groupsService.create(body));
  }) as RequestHandler,

  update: (async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const body = updateSchema.parse(req.body);
    res.json(await groupsService.update(id, body));
  }) as RequestHandler,

  remove: (async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    await groupsService.remove(id);
    res.status(204).end();
  }) as RequestHandler,

  setPermissions: (async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const { permissionKeys } = setPermsSchema.parse(req.body);
    res.json(await groupsService.setPermissions(id, permissionKeys));
  }) as RequestHandler,

  uploadIcon: (async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    if (!req.file) {
      res.status(400).json({ code: "XEC-STORE-7000", message: "No file uploaded" });
      return;
    }
    const url = await groupsService.uploadIcon(id, req.file.buffer, req.file.originalname);
    res.json({ url });
  }) as RequestHandler,
};
