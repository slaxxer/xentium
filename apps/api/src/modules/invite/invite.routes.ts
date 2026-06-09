import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../shared/middleware/requireAuth.js";
import { requirePermission } from "../../shared/middleware/requirePermission.js";
import { CorePermissions } from "@nodevo/contracts";
import { inviteService } from "./invite.service.js";

export const inviteRouter: Router = Router();

const adminGuard = requirePermission(CorePermissions.ADMIN_ACCESS);

const paginatedSchema = z.object({
  page:  z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const createSchema = z.object({
  note:      z.string().max(120).optional(),
  expiresAt: z.string().datetime().optional().nullable(),
  maxUses:   z.number().int().min(1).max(100).optional().default(1),
});

inviteRouter.use(requireAuth, adminGuard);

inviteRouter.get("/", async (req, res, next) => {
  try {
    const { page, limit } = paginatedSchema.parse(req.query);
    res.json(await inviteService.list({ page, limit }));
  } catch (e) { next(e); }
});

inviteRouter.post("/", async (req, res, next) => {
  try {
    const { note, expiresAt, maxUses } = createSchema.parse(req.body);
    const createdById = (req as any).userId as string;
    const code = await inviteService.create(
      createdById,
      note,
      expiresAt ? new Date(expiresAt) : null,
      maxUses,
    );
    res.status(201).json(code);
  } catch (e) { next(e); }
});

inviteRouter.delete("/:id", async (req, res, next) => {
  try {
    await inviteService.revoke(req.params.id!);
    res.status(204).end();
  } catch (e) { next(e); }
});
