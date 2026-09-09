/**
 * The public half of themes: what a READER may choose between.
 *
 * ⚠ Its own router, mounted at `/api/themes`, deliberately away from `theme.routes.ts`.
 * That file is mounted under `/api/admin`, where every route is guarded and the ACP
 * activity logger wraps the lot. An unguarded route living there works today and is
 * one blanket `adminRouter.use(adminGuard)` away from 404ing for the readers it
 * exists for — and it would be a reader's browser calling `/api/admin/…`, which is
 * alarming on its own.
 */
import { Router } from "express";
import { themeService } from "./theme.service.js";

export const themePublicRouter: Router = Router();

/**
 * The installed themes a visitor may wear, the site's own first.
 *
 * An id, a name, a version, and which one is the site's — nothing else. The vendor,
 * the manifest, the install timestamps and who installed it are an admin's inventory
 * and stay behind `/api/admin/themes/library`.
 */
themePublicRouter.get("/choices", async (_req, res, next) => {
  try {
    res.json({ themes: await themeService.listThemesForVisitors() });
  } catch (err) { next(err); }
});
