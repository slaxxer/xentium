import { Router } from "express";
import { CorePermissions } from "@xentium/contracts";
import { requirePermission } from "../../shared/middleware/requirePermission.js";
import { uploadSingle } from "../../shared/middleware/upload.js";
import { layoutController } from "./layout.controller.js";

/**
 * Admin layout editing (ADR-0005). Mounted under /api/admin so acpActivityLogger
 * audits every mutation, and gated on ADMIN_ACCESS to match the rest of the
 * Appearance area — layout and tokens are one job, and splitting the permission
 * would let an admin publish half a design.
 */
export const adminLayoutRouter: Router = Router();

const guard = requirePermission(CorePermissions.ADMIN_ACCESS);

adminLayoutRouter.get("/",                       guard, layoutController.draftAll);
adminLayoutRouter.get("/templates",              guard, layoutController.templates);
adminLayoutRouter.get("/draft-status",           guard, layoutController.draftStatus);
adminLayoutRouter.post("/publish",               guard, layoutController.publish);
adminLayoutRouter.get("/:templateKey/variants",  guard, layoutController.variants);
adminLayoutRouter.get("/:templateKey",           guard, layoutController.getDraft);
adminLayoutRouter.put("/:templateKey",           guard, layoutController.saveDraft);
adminLayoutRouter.post("/:templateKey/discard",  guard, layoutController.discardDraft);
adminLayoutRouter.post("/:templateKey/reset",    guard, layoutController.reset);
// Inheritance: back to what the installed theme ships, as distinct from `/reset`, which
// goes back to the CODE default. With a theme installed those are two different documents.
adminLayoutRouter.post("/:templateKey/revert-theme", guard, layoutController.revertToTheme);

/**
 * An image a block references — the `section` background, today.
 *
 * Not under `/:templateKey`: the file is not owned by one template. The same
 * background can sit in the chrome and on a landing page, and an upload that lived
 * under whichever template happened to be open when it was chosen would be a path
 * that lies about what it belongs to.
 */
adminLayoutRouter.post("/images", guard, ...uploadSingle("LAYOUT_IMAGE", "file"), layoutController.uploadImage);

/**
 * Public: the published documents the frontend renders. Unauthenticated —
 * layouts are global page structure, and every block resolves its own data
 * through endpoints that apply their own permission checks.
 */
export const publicLayoutRouter: Router = Router();
publicLayoutRouter.get("/", layoutController.publicList);
