import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { CorePermissions, THEME_ASSET_LIMITS, themeManifestSchema } from "@xentium/contracts";
import { requirePermission } from "../../shared/middleware/requirePermission.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { XEC } from "../../shared/errors/xec.js";
import { themeService } from "./theme.service.js";
import { appearanceService } from "../appearance/appearance.service.js";
import { layoutService } from "../layouts/layout.service.js";

/**
 * `.xttheme` export / import (ADR-0005). Mounted under /api/admin so every
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
 * The export form, which may carry one preview image.
 *
 * NOT `uploadSingle`: that middleware answers 400 when the field is absent, and a
 * screenshot is optional — most exports are still a form with no file at all.
 * multer passes a plain JSON request straight through untouched, so this route
 * keeps accepting the body it always accepted; the magic-byte check that
 * `uploadSingle` would have run lives in `exportTheme`, next to the rest of the
 * rules about what a package may carry.
 */
const screenshotUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: THEME_ASSET_LIMITS.maxBytesEach, files: 1 },
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
   * This is what `.xtstyle` existed for: handing someone a colour scheme without
   * shipping the arrangement of every page along with it. It is an OPTION on the one
   * format now rather than a second format with its own manifest and its own validator.
   *
   * ⚠ Accepts the STRING "true" as well as the boolean. A multipart body has no types
   * — every field arrives as text — and `z.coerce.boolean()` is not the fix: it is
   * JS truthiness, so the string "false" coerces to `true` and a tokens-only export
   * would silently become a full one.
   */
  tokensOnly: z.union([z.boolean(), z.enum(["true", "false"]).transform((v) => v === "true")]).optional(),
});

/** What theme is installed, if any — the thing the site is inheriting from. */
themeRouter.get("/installed", guard, async (_req, res, next) => {
  try {
    const [manifest, templates] = await Promise.all([
      appearanceService.getInstalledTheme(),
      layoutService.getThemeLayer(),
    ]);
    res.json({ manifest, templates: Object.keys(templates), rollback: await themeService.getRollbackState() });
  } catch (err) { next(err); }
});

/** A theme id in a path. Validated rather than cast: Express 5 types a param as
 *  `string | string[]`, and this one is joined to an upload path on uninstall. */
const themeIdParam = z.object({ id: z.string().regex(/^[a-z0-9-]+$/, "not a theme id") });

/**
 * The theme LIBRARY — everything installed here, active one first.
 *
 * Installed is not active, the same way it is for plugins. Before this existed a
 * single settings key held one manifest, so installing a second theme destroyed the
 * first: an admin could not look at two and choose.
 */
themeRouter.get("/library", guard, async (_req, res, next) => {
  try {
    res.json({ themes: await themeService.listThemes() });
  } catch (err) { next(err); }
});

/** Switch to a theme already installed here. Staged like an import — previewable,
 *  and undoable — so activating is not a commitment either. */
themeRouter.post("/library/:id/activate", guard, async (req, res, next) => {
  try {
    const { id } = themeIdParam.parse(req.params);
    res.json(await themeService.activateTheme(id, req.userId!));
  } catch (err) { next(err); }
});

/** Remove one from the library. Refuses the ACTIVE theme — see the service. */
themeRouter.delete("/library/:id", guard, async (req, res, next) => {
  try {
    const { id } = themeIdParam.parse(req.params);
    await themeService.uninstallTheme(id);
    res.status(204).end();
  } catch (err) { next(err); }
});

/**
 * Undo the last theme import.
 *
 * The verb that makes trying a theme possible at all. Installing one restages every
 * page and until this existed there was no way back — per-template discard covers
 * layouts only, and `resetAppearance` deliberately keeps the theme layer. So an admin
 * could not find out what a theme looked like without accepting it.
 *
 * Idempotent: with nothing to undo it answers `restored: false` rather than erroring,
 * because "there is nothing staged" is a state, not a failure.
 */
themeRouter.post("/discard", guard, async (req, res, next) => {
  try {
    res.json(await themeService.discardImportedTheme(req.userId!));
  } catch (err) { next(err); }
});

themeRouter.post("/export", guard, screenshotUpload.single("screenshot"), async (req, res, next) => {
  try {
    const { tokensOnly, ...meta } = exportSchema.parse(req.body ?? {});
    const buffer = await themeService.exportTheme(meta, { tokensOnly, screenshot: req.file?.buffer });
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${meta.id}-${meta.version}.xttheme"`);
    res.send(buffer);
  } catch (err) { next(err); }
});

themeRouter.post("/import", guard, upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      throw new XentiumError({ code: XEC.API_VALIDATION, httpStatus: 422, message: "No file uploaded" });
    }
    // Lands in the draft — a theme rewrites every page at once, which is exactly
    // the change that should be previewed before it goes live.
    res.json(await themeService.importTheme(req.file.buffer, req.userId!));
  } catch (err) { next(err); }
});
