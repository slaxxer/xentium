import { Router } from "express";
import { siteService } from "./site.service.js";

export const siteRouter: Router = Router();

// Public site config — feature flags + landing. Consumed by the SPA at boot.
siteRouter.get("/config", async (_req, res, next) => {
  try {
    res.json(await siteService.getConfig());
  } catch (err) {
    next(err);
  }
});

// Footer meta — site name, server uptime, plugin-contributed counters.
siteRouter.get("/footer", async (_req, res, next) => {
  try {
    res.json(await siteService.getFooter());
  } catch (err) {
    next(err);
  }
});
