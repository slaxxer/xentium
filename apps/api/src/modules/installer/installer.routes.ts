import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { installerController } from "./installer.controller.js";
import { requireAuth } from "../../shared/middleware/requireAuth.js";
export const installerRouter: Router = Router();

// In-memory limiter (NOT Redis): the installer runs before infra is verified, so
// it must not depend on Redis. §26: throttle install attempts per IP.
const isDev = process.env.NODE_ENV !== "production";
const limitHandler = (_req: Request, res: Response) => {
  res.status(429).json({ error: { code: "XEC-API-4290", message: "Rate limit exceeded" } });
};

// The marketplace link poll is a TIMER, not a user action: the marketplace names
// the cadence (~3s) and the handshake stays open for minutes, so one link burns
// far more than a per-minute budget meant for form submissions. It gets its own
// window sized to a whole handshake and is skipped by the general limiter —
// folding it in would mean a rate-limited installer as soon as someone links an
// account.
const LINK_POLL_PATH = /^\/marketplace\/link\/[^/]+$/;

installerRouter.use(rateLimit({
  windowMs: 60_000,
  limit: isDev ? 100000 : 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: (req) => LINK_POLL_PATH.test(req.path),
  handler: limitHandler,
}));

const linkPollLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: isDev ? 100000 : 400,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: limitHandler,
});

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

// ── Add-ons step ────────────────────────────────────────────────────────────
// The catalogue, the account link and the selection are all reachable without a
// session: the administrator does not exist yet at this point in the wizard, and
// what gates these is the installer being unfinished at all (installGuard 410s
// the whole router the moment it is).
installerRouter.get("/addons", installerController.addons);
installerRouter.post("/addons", installerController.selectAddons);
installerRouter.post("/marketplace/link", installerController.startMarketplaceLink);
installerRouter.get("/marketplace/link/:linkId", linkPollLimiter, installerController.pollMarketplaceLink);
installerRouter.delete("/marketplace/connection", installerController.unlinkMarketplace);

installerRouter.post("/admin", installerController.admin);

// Downloads a licensed artifact and attributes the install to a user, so unlike
// its neighbours it needs one — the ADMIN step above hands the wizard the access
// token it presents here.
installerRouter.post("/addons/install", requireAuth, installerController.installAddon);

installerRouter.post("/finalize", installerController.finalize);
