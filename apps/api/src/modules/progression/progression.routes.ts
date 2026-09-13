import { Router } from "express";
import { requirePermission } from "../../shared/middleware/requirePermission.js";
import { requireAuth } from "../../shared/middleware/requireAuth.js";
import { CorePermissions } from "@xentium/contracts";
import { progressionController } from "./progression.controller.js";

// ── Admin progression router (mounted at /api/admin/progression) ──────────────
export const adminProgressionRouter: Router = Router();

const guard = requirePermission(CorePermissions.ADMIN_ACCESS);

// Global ladder view + settings
adminProgressionRouter.get("/",                guard, progressionController.getLadder);
adminProgressionRouter.get("/groups",          guard, progressionController.getAllGroupsWithProgression);
adminProgressionRouter.patch("/settings",      guard, progressionController.updateGlobalSettings);

// Ladder reorder — must be registered before /:id
adminProgressionRouter.patch("/reorder",       guard, progressionController.reorderLadder);

// Per-group config — :id is the group id
adminProgressionRouter.get("/:id",             guard, progressionController.getGroupProgression);
adminProgressionRouter.patch("/:id",           guard, progressionController.updateGroupProgression);

// ── User limits router (mounted at /api/users) ────────────────────────────────
export const userLimitsRouter: Router = Router();

// GET /api/users/me/limits — returns the authenticated user's effective content limits
userLimitsRouter.get("/me/limits", requireAuth, progressionController.getMyLimits);
