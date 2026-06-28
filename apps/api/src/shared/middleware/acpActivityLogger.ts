import type { RequestHandler } from "express";
import { prisma } from "../../infrastructure/db.js";
import { activityService } from "../../modules/activity/activity.service.js";
import { normalizeIp } from "../http/requestMeta.js";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Records ACP actions. Mounted on /api/admin so it wraps every admin router;
 *  logs mutating requests on response finish (by which point the route's
 *  requireAuth has populated req.userId and the status is known). Read-only GETs
 *  are skipped to keep the log to actual actions. */
export const acpActivityLogger: RequestHandler = (req, res, next) => {
  if (!MUTATING.has(req.method)) return next();

  const startPath = req.originalUrl.split("?")[0] ?? req.originalUrl;
  res.on("finish", () => {
    const userId = (req as { userId?: string }).userId;
    if (!userId) return; // unauthenticated attempt — not an ACP action
    const uaRaw = req.headers["user-agent"];
    void prisma.user
      .findUnique({ where: { id: userId }, select: { username: true } })
      .then((u) =>
        activityService.log({
          category: "acp_action",
          userId,
          username: u?.username,
          method: req.method,
          path: startPath,
          status: res.statusCode,
          ip: normalizeIp(req.ip),
          userAgent: Array.isArray(uaRaw) ? uaRaw[0] : uaRaw,
        }),
      )
      .catch(() => { /* best-effort */ });
  });

  next();
};
