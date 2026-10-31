import { Router } from "express";
import { requireAllPermissions, requireAnyPermission, requirePermission } from "../../shared/middleware/requirePermission.js";
import { requireAuth } from "../../shared/middleware/requireAuth.js";
import { CorePermissions } from "@xentium/contracts";
import { progressionController } from "./progression.controller.js";

// ── Admin progression router (mounted at /api/admin/progression) ──────────────
export const adminProgressionRouter: Router = Router();

const guard = requireAllPermissions(CorePermissions.ADMIN_ACCESS, CorePermissions.PROGRESSION_MANAGE);
// One group's rung (its badge, limits) is also edited from the group page.
const groupGuard = [requirePermission(CorePermissions.ADMIN_ACCESS), requireAnyPermission(CorePermissions.PROGRESSION_MANAGE, CorePermissions.GROUP_MANAGE)] as const;

// Global ladder view + settings
adminProgressionRouter.get("/",                guard, progressionController.getLadder);
adminProgressionRouter.get("/groups",          guard, progressionController.getAllGroupsWithProgression);
adminProgressionRouter.patch("/settings",      guard, progressionController.updateGlobalSettings);

// Ladder reorder — must be registered before /:id
adminProgressionRouter.patch("/reorder",       guard, progressionController.reorderLadder);

// Per-group config — :id is the group id
adminProgressionRouter.get("/:id",             ...groupGuard, progressionController.getGroupProgression);
adminProgressionRouter.patch("/:id",           ...groupGuard, progressionController.updateGroupProgression);

// ── User limits router (mounted at /api/users) ────────────────────────────────
export const userLimitsRouter: Router = Router();

// GET /api/users/me/limits — returns the authenticated user's effective content limits
userLimitsRouter.get("/me/limits", requireAuth, progressionController.getMyLimits);
