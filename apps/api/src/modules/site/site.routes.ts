import { Router } from "express";
import { z } from "zod";
import { siteService } from "./site.service.js";
import { headFor } from "../seo/seo.service.js";

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

// The head tags for a page (title, description, canonical, previews, JSON-LD): the
// same ones the server writes into the page, asked by the app on every navigation.
siteRouter.get("/head", async (req, res, next) => {
  try {
    const { path } = z.object({ path: z.string().max(512).default("/") }).parse(req.query);
    res.set("Cache-Control", "no-store").json(await headFor(path));
  } catch (err) {
    next(err);
  }
});
