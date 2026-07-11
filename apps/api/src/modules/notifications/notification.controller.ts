import type { RequestHandler } from "express";
import { z } from "zod";
import { notificationService } from "./notification.service.js";

const paginatedSchema = z.object({
  page:  z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const idParamSchema = z.object({ id: z.string() });

export const notificationController = {
  list: (async (req, res) => {
    const userId = req.userId!;
    const { page, limit } = paginatedSchema.parse(req.query);
    res.json(await notificationService.listForUser(userId, { page, limit }));
  }) as RequestHandler,

  unreadCount: (async (req, res) => {
    const userId = req.userId!;
    const count = await notificationService.getUnreadCount(userId);
    res.json({ count });
  }) as RequestHandler,

  markRead: (async (req, res) => {
    const userId = req.userId!;
    const { id } = idParamSchema.parse(req.params);
    await notificationService.markRead(id, userId);
    res.status(204).end();
  }) as RequestHandler,

  markAllRead: (async (req, res) => {
    const userId = req.userId!;
    await notificationService.markAllRead(userId);
    res.status(204).end();
  }) as RequestHandler,
};
