import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { CorePermissions, emojiCategorySchema, emojiShortcodeSchema } from "@xentium/contracts";
import { requirePermission } from "../../shared/middleware/requirePermission.js";
import { uploadSingle } from "../../shared/middleware/upload.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { XEC } from "../../shared/errors/xec.js";
import { emojiService } from "./emojis.service.js";

const idParam = z.object({ id: z.string().min(1).max(64) });
const createBody = z.object({
  shortcode: emojiShortcodeSchema,
  name: z.string().trim().max(60).optional(),
  category: emojiCategorySchema.optional(),
});
const updateBody = z.object({
  shortcode: emojiShortcodeSchema.optional(),
  name: z.string().trim().max(60).optional(),
  category: emojiCategorySchema.optional(),
});

// Public — mounted at /api/emojis. What the editor's picker offers.
export const emojiRouter: Router = Router();
emojiRouter.get("/", (async (_req, res) => {
  // The picker asks on every editor; the list changes only when an admin edits it.
  res.setHeader("Cache-Control", "no-cache");
  res.json(await emojiService.listActive());
}) as RequestHandler);

// ACP — mounted at /api/admin/emojis.
export const emojiAdminRouter: Router = Router();
emojiAdminRouter.use(requirePermission(CorePermissions.EMOJI_MANAGE));

emojiAdminRouter.get("/", (async (_req, res) => {
  res.json(await emojiService.listActive());
}) as RequestHandler);

// multipart: `file` + shortcode, name, category.
emojiAdminRouter.post("/", ...uploadSingle("EMOJI", "file"), (async (req, res) => {
  const body = createBody.parse(req.body ?? {});
  if (!req.file) {
    throw new XentiumError({ code: XEC.API_VALIDATION, httpStatus: 422, message: "No image uploaded" });
  }
  const row = await emojiService.create(body, { buffer: req.file.buffer, ext: req.file.detectedExt ?? "png" }, req.userId!);
  res.status(201).json(row);
}) as RequestHandler);

emojiAdminRouter.patch("/:id", (async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.json(await emojiService.update(id, updateBody.parse(req.body ?? {})));
}) as RequestHandler);

// Retire: out of the picker; posts that used it keep showing it.
emojiAdminRouter.delete("/:id", (async (req, res) => {
  const { id } = idParam.parse(req.params);
  await emojiService.retire(id);
  res.status(204).end();
}) as RequestHandler);
