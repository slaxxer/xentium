import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { CorePermissions, THEME_ASSET_LIMITS, themeManifestSchema } from "@nodevo/contracts";
import { requirePermission } from "../../shared/middleware/requirePermission.js";
import { NodevoError } from "../../shared/errors/NodevoError.js";
import { NEC } from "../../shared/errors/nec.js";
import { themeService } from "./theme.service.js";
import { appearanceService } from "../appearance/appearance.service.js";
import { layoutService } from "../layouts/layout.service.js";

/**
 * `.nvtheme` export / import (ADR-0005). Mounted under /api/admin so every
 * mutation is audited, gated on ADMIN_ACCESS like the rest of Appearance.
 */
export const themeRouter: Router = Router();

const guard = requirePermission(CorePermissions.ADMIN_ACCESS);

// A package is documents, a stylesheet and its assets, so the cap follows the asset
// budget plus headroom for the JSON — anything past it fails before being unzipped.
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: THEME_ASSET_LIMITS.maxBytesTotal + 2 * 1024 * 1024 },
});

/**
 * The author-supplied half of the manifest. Picked from the manifest schema itself
 * rather than restated, so the two can never disagree about what a version looks like;
 * the version fields the service fills in are deliberately not accepted here.
 */
const exportSchema = themeManifestSchema.pick({
  id: true, name: true, version: true, vendor: true, description: true,
  license: true, homepage: true, authorUrl: true,
}).extend({
  /**
   * Palette only — no layouts, and therefore no assets.
   *
   * This is what `.nvstyle` existed for: handing someone a colour scheme without
   * shipping the arrangement of every page along with it. It is an OPTION on the one
   * format now rather than a second format with its own manifest and its own validator.
   */
  tokensOnly: z.boolean().optional(),
});

/** What theme is installed, if any — the thing the site is inheriting from. */
themeRouter.get("/installed", guard, async (_req, res, next) => {
  try {
    const [manifest, templates] = await Promise.all([
      appearanceService.getInstalledTheme(),
      layoutService.getThemeLayer(),
    ]);
    res.json({ manifest, templates: Object.keys(templates) });
  } catch (err) { next(err); }
});

themeRouter.post("/export", guard, async (req, res, next) => {
  try {
    const { tokensOnly, ...meta } = exportSchema.parse(req.body ?? {});
    const buffer = await themeService.exportTheme(meta, { tokensOnly });
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${meta.id}-${meta.version}.nvtheme"`);
    res.send(buffer);
  } catch (err) { next(err); }
});

themeRouter.post("/import", guard, upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      throw new NodevoError({ code: NEC.API_VALIDATION, httpStatus: 422, message: "No file uploaded" });
    }
    // Lands in the draft — a theme rewrites every page at once, which is exactly
    // the change that should be previewed before it goes live.
    res.json(await themeService.importTheme(req.file.buffer, req.userId!));
  } catch (err) { next(err); }
});
