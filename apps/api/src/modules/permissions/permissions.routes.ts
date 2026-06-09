import { Router } from "express";
import { requirePermission } from "../../shared/middleware/requirePermission.js";
import { CorePermissions } from "@nodevo/contracts";
import { permissionsController } from "./permissions.controller.js";

export const permissionsRouter: Router = Router();

const guard = requirePermission(CorePermissions.GROUP_MANAGE);
permissionsRouter.get("/", guard, permissionsController.listAll);
