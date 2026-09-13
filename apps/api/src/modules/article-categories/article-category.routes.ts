import { Router } from "express";
import { optionalAuth } from "../../shared/middleware/optionalAuth.js";
import { requirePermission } from "../../shared/middleware/requirePermission.js";
import { CorePermissions } from "@xentium/contracts";
import { articleCategoryController } from "./article-category.controller.js";

export const articleCategoriesRouter: Router = Router();

// Public tree (visibility-filtered)
articleCategoriesRouter.get("/", optionalAuth, articleCategoryController.tree);

// Admin write endpoints — gated by admin.access. Dedicated category.manage
// permission can be split out in Phase 6 if needed.
articleCategoriesRouter.post(
  "/",
  requirePermission(CorePermissions.ADMIN_ACCESS),
  articleCategoryController.create,
);

articleCategoriesRouter.patch(
  "/reorder",
  requirePermission(CorePermissions.ADMIN_ACCESS),
  articleCategoryController.reorder,
);

articleCategoriesRouter.patch(
  "/:id",
  requirePermission(CorePermissions.ADMIN_ACCESS),
  articleCategoryController.update,
);

articleCategoriesRouter.delete(
  "/:id",
  requirePermission(CorePermissions.ADMIN_ACCESS),
  articleCategoryController.remove,
);
