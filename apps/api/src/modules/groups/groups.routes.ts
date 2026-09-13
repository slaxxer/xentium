import { Router } from "express";
import { requirePermission } from "../../shared/middleware/requirePermission.js";
import { CorePermissions } from "@xentium/contracts";
import { groupsController } from "./groups.controller.js";
import { uploadSingle } from "../../shared/middleware/upload.js";

export const groupsRouter: Router = Router();

const guard = requirePermission(CorePermissions.GROUP_MANAGE);

groupsRouter.get("/", guard, groupsController.list);
groupsRouter.put("/reorder", guard, groupsController.reorder);
groupsRouter.get("/:id", guard, groupsController.getById);
groupsRouter.post("/", guard, groupsController.create);
groupsRouter.patch("/:id", guard, groupsController.update);
groupsRouter.delete("/:id", guard, groupsController.remove);
groupsRouter.put("/:id/permissions", guard, groupsController.setPermissions);
groupsRouter.post("/:id/icon", guard, uploadSingle("GROUP_ICON", "file"), groupsController.uploadIcon);
