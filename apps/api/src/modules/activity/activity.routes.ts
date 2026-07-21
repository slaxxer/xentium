import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../infrastructure/db.js";
import { optionalAuth } from "../../shared/middleware/optionalAuth.js";
import { requireAuth } from "../../shared/middleware/requireAuth.js";
import { requirePermission } from "../../shared/middleware/requirePermission.js";
import { CorePermissions } from "@nodevo/contracts";
import { normalizeIp } from "../../shared/http/requestMeta.js";
import { activityService } from "./activity.service.js";

function ua(req: { headers: Record<string, unknown> }): string | undefined {
  const raw = req.headers["user-agent"];
  return Array.isArray(raw) ? (raw[0] as string) : (raw as string | undefined);
}

// Public: log a page movement for the signed-in user. No-op for guests.
export const activityRouter: Router = Router();
activityRouter.post("/visit", optionalAuth, async (req, res, next) => {
  try {
    const userId = (req as { userId?: string }).userId;
    if (!userId) return res.status(204).end();
    const { url } = z.object({ url: z.string().max(500) }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
    activityService.log({
      category: "page_visit",
      userId,
      username: user?.username,
      path: url,
      ip: normalizeIp(req.ip),
      userAgent: ua(req),
    });
    // Durable last-visit mark (dialog acknowledgment) — survives log retention.
    activityService.markVisit(userId, url);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Admin: read the activity log (movements + ACP actions), filterable.
export const activityAdminRouter: Router = Router();
const listSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  category: z.enum(["page_visit", "acp_action"]).optional(),
});
activityAdminRouter.get(
  "/",
  requireAuth,
  requirePermission(CorePermissions.ADMIN_ACCESS),
  async (req, res, next) => {
    try {
      const { page, limit, category } = listSchema.parse(req.query);
      res.json(await activityService.list({ page, limit, category }));
    } catch (err) {
      next(err);
    }
  },
);
