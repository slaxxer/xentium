import { Router } from "express";
import { maintenanceService } from "./maintenance.service.js";

export const maintenanceRouter: Router = Router();

// Public status — always reachable (exempt from the maintenance guard) so the
// SPA can render the maintenance screen with live copy/progress/ETA.
maintenanceRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await maintenanceService.getStatus());
  } catch (err) {
    next(err);
  }
});
