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

  // A failed action keeps WHY it failed — the error's code and message, read off the
  // response as it is sent — so the log can say "SMTP connection refused", not just 500.
  let failure: { code?: string; message?: string } | undefined;
  const json = res.json.bind(res);
  res.json = (body: unknown) => {
    if (res.statusCode >= 400) {
      const e = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
      if (e && typeof e === "object") {
        failure = {
          ...(typeof e.code === "string" ? { code: e.code.slice(0, 40) } : {}),
          ...(typeof e.message === "string" ? { message: e.message.slice(0, 300) } : {}),
        };
      }
    }
    return json(body);
  };

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
          ...(failure ? { meta: { error: failure } } : {}),
        }),
      )
      .catch(() => { /* best-effort */ });
  });

  next();
};
