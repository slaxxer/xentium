import { Router } from "express";
import { z } from "zod";
import { betaService } from "./beta.service.js";
import { requireAuth } from "../../shared/middleware/requireAuth.js";
import { requirePermission } from "../../shared/middleware/requirePermission.js";
import { optionalAuth } from "../../shared/middleware/optionalAuth.js";
import { CorePermissions } from "@nodevo/contracts";
import { isProd } from "../../config/env.js";
import { clearBetaCookie } from "../../shared/http/cookies.js";
import { prisma } from "../../infrastructure/db.js";

const STAFF_KEYS = new Set(["admin", "supermod", "moderator"]);

export const betaPublicRouter: Router = Router();
export const betaAdminRouter:  Router = Router();

const BETA_COOKIE = "nv_beta";

// ── Public endpoints ──────────────────────────────────────────────────────────

/** Returns whether beta mode is active and whether the current request has access. */
betaPublicRouter.get("/status", optionalAuth, async (req, res, next) => {
  try {
    const enabled = await betaService.isEnabled();
    if (!enabled) return res.json({ enabled: false, hasAccess: true });

    // Authenticated staff members always have access regardless of cookies
    const userId = (req as any).userId as string | undefined;
    if (userId) {
      const groups = await prisma.userGroup.findMany({
        where:  { userId },
        select: { group: { select: { key: true } } },
      });
      if (groups.some((g) => STAFF_KEYS.has(g.group.key))) {
        return res.json({ enabled: true, hasAccess: true });
      }
    }

    const cookieCode = req.signedCookies?.[BETA_COOKIE];
    const check      = await betaService.checkAccess(cookieCode, req.ip ?? "");

    // Cookie references a deleted code — clear it so the browser doesn't hold a ghost cookie
    if (!check.hasAccess && check.necCode === "NEC-AUTH-1031" && cookieCode) {
      clearBetaCookie(res);
    }

    res.json({ enabled: true, hasAccess: check.hasAccess, necCode: check.necCode ?? null });
  } catch (e) { next(e); }
});

/** Redeem a beta code — locks the IP and sets the beta cookie. */
betaPublicRouter.post("/redeem", async (req, res, next) => {
  try {
    const { code } = z.object({ code: z.string().min(1) }).parse(req.body);
    const uaRaw  = req.headers["user-agent"];
    const ua     = Array.isArray(uaRaw) ? uaRaw[0] ?? "" : (uaRaw ?? "");
    const { code: locked, isNew } = await betaService.redeem(code, req.ip ?? "", ua);

    res.cookie(BETA_COOKIE, locked, {
      httpOnly:  true,
      signed:    true,
      sameSite:  "strict",
      secure:    isProd,
      maxAge:    365 * 24 * 60 * 60 * 1000,
      path:      "/",
    });
    res.json({ success: true, isNew });
  } catch (e) { next(e); }
});

/** Log a frontend page visit — requires a valid beta cookie. Staff accounts are excluded. */
betaPublicRouter.post("/log-visit", optionalAuth, async (req, res, next) => {
  try {
    const cookieCode = req.signedCookies?.[BETA_COOKIE] as string | undefined;
    if (!cookieCode) return res.status(204).end();

    // Skip logging for staff accounts
    const userId = (req as any).userId as string | undefined;
    if (userId) {
      const groups = await prisma.userGroup.findMany({
        where:  { userId },
        select: { group: { select: { key: true } } },
      });
      if (groups.some((g) => STAFF_KEYS.has(g.group.key))) {
        return res.status(204).end();
      }
    }

    const { url } = z.object({ url: z.string().max(500) }).parse(req.body);
    const uaRaw   = req.headers["user-agent"];
    const ua      = Array.isArray(uaRaw) ? (uaRaw[0] ?? "") : (uaRaw ?? "");

    let username: string | undefined;
    if (userId) {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
      username = user?.username;
    }

    await betaService.logEvent({
      eventType: "page_visit",
      betaCode:  cookieCode,
      username,
      url,
      ip:        req.ip ?? undefined,
      userAgent: ua || undefined,
    });

    res.status(204).end();
  } catch (e) { next(e); }
});

// ── Admin endpoints (requires admin.access) ───────────────────────────────────

const adminGuard = [requireAuth, requirePermission(CorePermissions.ADMIN_ACCESS)];
const paginated  = z.object({
  page:  z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

betaAdminRouter.get("/", ...adminGuard, async (req, res, next) => {
  try {
    const { page, limit } = paginated.parse(req.query);
    res.json(await betaService.list({ page, limit }));
  } catch (e) { next(e); }
});

betaAdminRouter.get("/log", ...adminGuard, async (req, res, next) => {
  try {
    const { page, limit } = paginated.parse(req.query);
    res.json(await betaService.getLog({ page, limit }));
  } catch (e) { next(e); }
});

betaAdminRouter.post("/", ...adminGuard, async (req, res, next) => {
  try {
    const { note } = z.object({ note: z.string().max(120).optional() }).parse(req.body);
    const createdById = (req as any).userId as string;
    res.status(201).json(await betaService.create(createdById, note));
  } catch (e) { next(e); }
});

betaAdminRouter.delete("/:id", ...adminGuard, async (req, res, next) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id!;
    await betaService.revoke(id);
    res.status(204).end();
  } catch (e) { next(e); }
});
