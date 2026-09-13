import { Router } from "express";
import { requirePermission } from "../../shared/middleware/requirePermission.js";
import { optionalAuth } from "../../shared/middleware/optionalAuth.js";
import { uploadSingle } from "../../shared/middleware/upload.js";
import { CorePermissions } from "@xentium/contracts";
import { pagesController } from "./page.controller.js";

// Public reader — mounted at /api/pages. optionalAuth so 'members' visibility
// can see the viewer's auth state.
export const pagesRouter: Router = Router();
// Static segment must precede /:slug so it isn't shadowed.
pagesRouter.get("/slots", pagesController.publicSlots);
pagesRouter.get("/:slug", optionalAuth, pagesController.getBySlug);

// Admin CRUD — mounted at /api/admin/pages, gated by page.manage. Publish/
// unpublish additionally require page.publish.
export const pagesAdminRouter: Router = Router();

pagesAdminRouter.get("/", requirePermission(CorePermissions.PAGE_MANAGE), pagesController.list);
pagesAdminRouter.post("/", requirePermission(CorePermissions.PAGE_MANAGE), pagesController.create);

// Slot management — static segment before /:id.
pagesAdminRouter.get("/slots", requirePermission(CorePermissions.PAGE_MANAGE), pagesController.slotAssignments);
pagesAdminRouter.put("/slots", requirePermission(CorePermissions.PAGE_MANAGE), pagesController.setSlot);

pagesAdminRouter.get("/:id", requirePermission(CorePermissions.PAGE_MANAGE), pagesController.getById);
pagesAdminRouter.patch("/:id", requirePermission(CorePermissions.PAGE_MANAGE), pagesController.update);
pagesAdminRouter.delete("/:id", requirePermission(CorePermissions.PAGE_MANAGE), pagesController.remove);
pagesAdminRouter.post("/:id/nav", requirePermission(CorePermissions.PAGE_MANAGE), pagesController.addToNav);
pagesAdminRouter.delete("/:id/nav", requirePermission(CorePermissions.PAGE_MANAGE), pagesController.removeFromNav);

pagesAdminRouter.post(
  "/:id/featured-image",
  requirePermission(CorePermissions.PAGE_MANAGE),
  ...uploadSingle("FEATURED_IMAGE", "file"),
  pagesController.uploadFeaturedImage,
);
pagesAdminRouter.post(
  "/:id/image",
  requirePermission(CorePermissions.PAGE_MANAGE),
  ...uploadSingle("ARTICLE_IMAGE", "file"),
  pagesController.uploadImage,
);

pagesAdminRouter.post("/:id/publish", requirePermission(CorePermissions.PAGE_PUBLISH), pagesController.publish);
pagesAdminRouter.post("/:id/unpublish", requirePermission(CorePermissions.PAGE_PUBLISH), pagesController.unpublish);
