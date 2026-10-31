import { Router } from "express";
import { requirePermission } from "../../shared/middleware/requirePermission.js";
import { CorePermissions } from "@xentium/contracts";
import { groupsController } from "./groups.controller.js";
import { uploadSingle } from "../../shared/middleware/upload.js";
import { requireStepUp } from "../auth/twoFactor.service.js";

export const groupsRouter: Router = Router();

const guard = requirePermission(CorePermissions.GROUP_MANAGE);

groupsRouter.get("/", guard, groupsController.list);
groupsRouter.put("/reorder", guard, groupsController.reorder);
groupsRouter.get("/:id", guard, groupsController.getById);
groupsRouter.post("/", guard, requireStepUp, groupsController.create);
groupsRouter.patch("/:id", guard, groupsController.update);
groupsRouter.delete("/:id", guard, requireStepUp, groupsController.remove);
groupsRouter.put("/:id/permissions", guard, requireStepUp, groupsController.setPermissions);
groupsRouter.patch("/:id/permissions", guard, requireStepUp, groupsController.patchPermissions);
groupsRouter.post("/:id/icon", guard, uploadSingle("GROUP_ICON", "file"), groupsController.uploadIcon);
groupsRouter.delete("/:id/icon", guard, groupsController.removeIcon);
groupsRouter.post("/:id/rank-image", guard, uploadSingle("RANK_IMAGE", "file"), groupsController.uploadRankImage);
groupsRouter.delete("/:id/rank-image", guard, groupsController.removeRankImage);
