import { Router } from "express";
import { homeService } from "./home.service.js";

export const homeRouter: Router = Router();

homeRouter.get("/guest-config", async (_req, res, next) => {
  try {
    res.json(await homeService.getGuestConfig());
  } catch (err) {
    next(err);
  }
});

homeRouter.get("/stats", async (_req, res, next) => {
  try {
    res.json(await homeService.getStats());
  } catch (err) {
    next(err);
  }
});

homeRouter.get("/feed-source/:id", async (req, res, next) => {
  try {
    const limit = Number(req.query.limit) || 10;
    res.json(await homeService.getFeedSourceItems(req.params.id, limit));
  } catch (err) {
    next(err);
  }
});

homeRouter.get("/hot-threads", async (_req, res, next) => {
  try {
    res.json(await homeService.getHotThreads());
  } catch (err) {
    next(err);
  }
});
