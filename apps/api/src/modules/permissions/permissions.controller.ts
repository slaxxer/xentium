import type { RequestHandler } from "express";
import { permissionsService } from "./permissions.service.js";

export const permissionsController = {
  listAll: (async (_req, res) => {
    res.json(await permissionsService.listAll());
  }) as RequestHandler,
};
