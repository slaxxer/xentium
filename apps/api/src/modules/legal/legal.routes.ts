import { Router } from "express";
import { requirePermission } from "../../shared/middleware/requirePermission.js";
import { CorePermissions } from "@xentium/contracts";
import { legalController } from "./legal.controller.js";

// Public — mounted at /api/legal. What the footer, registration and the
// /legal/<key> pages read; published text only.
export const legalRouter: Router = Router();
legalRouter.get("/", legalController.listPublished);
legalRouter.get("/:key", legalController.getPublished);

// ACP — mounted at /api/admin/legal.
export const legalAdminRouter: Router = Router();
legalAdminRouter.use(requirePermission(CorePermissions.LEGAL_MANAGE));
legalAdminRouter.get("/", legalController.listAll);
legalAdminRouter.put("/:key/draft", legalController.saveDraft);
legalAdminRouter.post("/:key/publish", legalController.publish);
legalAdminRouter.post("/:key/unpublish", legalController.unpublish);
legalAdminRouter.post("/:key/discard", legalController.discardDraft);
legalAdminRouter.put("/:key/acceptance", legalController.setAcceptance);
legalAdminRouter.post("/:key/ask-again", legalController.askAgain);
