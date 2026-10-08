import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../infrastructure/db.js";
import { optionalAuth } from "../../shared/middleware/optionalAuth.js";
import { requireAuth } from "../../shared/middleware/requireAuth.js";
import { requirePermission } from "../../shared/middleware/requirePermission.js";
import { CorePermissions } from "@xentium/contracts";
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
  limit: z.coerce.number().int().min(1).max(100).default(50),
  category: z.enum(["page_visit", "acp_action"]).optional(),
  q: z.string().trim().max(200).optional(),
  user: z.string().max(64).optional(),
  ip: z.string().max(64).optional(),
  since: z.coerce.date().optional(),
  // Comma-separated: `methods=POST,PATCH`.
  methods: z.string().max(60).optional()
    .transform((v) => (v ? v.split(",").filter((m) => ["POST", "PUT", "PATCH", "DELETE"].includes(m)) : undefined)),
  result: z.enum(["ok", "err"]).optional(),
});
activityAdminRouter.get(
  "/",
  requireAuth,
  requirePermission(CorePermissions.ADMIN_ACCESS),
  async (req, res, next) => {
    try {
      const { user, q, ...rest } = listSchema.parse(req.query);
      res.json(await activityService.list({ ...rest, ...(q ? { q } : {}), ...(user ? { userId: user } : {}) }));
    } catch (err) {
      next(err);
    }
  },
);

/** What the filter menus offer. */
activityAdminRouter.get(
  "/facets",
  requireAuth,
  requirePermission(CorePermissions.ADMIN_ACCESS),
  async (_req, res, next) => {
    try {
      res.json(await activityService.facets());
    } catch (err) {
      next(err);
    }
  },
);
