import { Router } from "express";
import rateLimit from "express-rate-limit";
import { installerController } from "./installer.controller.js";
export const installerRouter: Router = Router();

// In-memory limiter (NOT Redis): the installer runs before infra is verified, so
// it must not depend on Redis. §26: throttle install attempts per IP.
const isDev = process.env.NODE_ENV !== "production";
installerRouter.use(rateLimit({
  windowMs: 60_000,
  limit: isDev ? 100000 : 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (_req, res) =>
    res.status(429).json({ error: { code: "XEC-API-4290", message: "Rate limit exceeded" } }),
}));

// Installer responses must never be cached — a reset or completed install must reflect immediately.
installerRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

installerRouter.get("/status", installerController.status);
installerRouter.get("/environment", installerController.environment);
installerRouter.post("/database", installerController.database);
installerRouter.get("/database/test", installerController.testDatabase);
installerRouter.post("/site", installerController.site);
installerRouter.post("/admin", installerController.admin);
installerRouter.post("/finalize", installerController.finalize);
