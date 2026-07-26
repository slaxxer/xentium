import { Router } from "express";
import { requireAuth } from "../../shared/middleware/requireAuth.js";
import { requirePermission } from "../../shared/middleware/requirePermission.js";
import { scheduledTaskController } from "./scheduled-task.controller.js";

/**
 * Admin-created scheduled tasks. Mounted under /api/admin (so the ACP activity
 * logger audits every mutation) but gated on `system.tasks.manage` rather than
 * plain admin.access — these run unattended and some actions destroy data.
 */
export const scheduledTaskRouter: Router = Router();

const guard = [requireAuth, requirePermission("system.tasks.manage")] as const;

// The action catalogue the create-dialog offers.
scheduledTaskRouter.get("/actions", ...guard, scheduledTaskController.listActions);

scheduledTaskRouter.get("/",            ...guard, scheduledTaskController.list);
scheduledTaskRouter.post("/",           ...guard, scheduledTaskController.create);
scheduledTaskRouter.get("/:id",         ...guard, scheduledTaskController.get);
scheduledTaskRouter.patch("/:id",       ...guard, scheduledTaskController.update);
scheduledTaskRouter.delete("/:id",      ...guard, scheduledTaskController.remove);
scheduledTaskRouter.post("/:id/run",    ...guard, scheduledTaskController.runNow);
scheduledTaskRouter.get("/:id/runs",    ...guard, scheduledTaskController.runs);
