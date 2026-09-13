import type { RequestHandler } from "express";
import { NEC } from "@xentium/contracts";
import { verifyAccess } from "../../modules/auth/auth.tokens.js";
import { maintenanceService } from "../../modules/maintenance/maintenance.service.js";

// Endpoints that must stay reachable while in maintenance so the SPA can render
// the maintenance screen and staff can sign in to bypass.
const EXEMPT_PREFIXES = [
  "/api/maintenance",
  "/api/auth",          // login / refresh / logout / me
  "/api/site/config",
  "/api/health",
  "/api/install",
  "/api/appearance",    // served stylesheet + version poll + branding
  "/api/meta",
];

/** Blocks the site for everyone except the allowed group (and admins) while
 *  maintenance mode is on. Non-/api requests (e.g. /uploads) pass through. */
export const maintenanceGuard: RequestHandler = async (req, res, next) => {
  try {
    if (!req.path.startsWith("/api/")) return next();
    if (EXEMPT_PREFIXES.some((p) => req.path === p || req.path.startsWith(p + "/"))) {
      return next();
    }

    if (!(await maintenanceService.isEnabled())) return next();

    // Identify the requester (if signed in) and check bypass eligibility.
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (token) {
      try {
        const { userId } = await verifyAccess(token);
        if (await maintenanceService.userMayBypass(userId)) return next();
      } catch {
        /* invalid token → treated as anonymous below */
      }
    }

    res.status(503).json({
      error: { code: NEC.CORE_MAINTENANCE, message: "The site is under maintenance." },
      maintenance: true,
    });
  } catch {
    // Never let the guard itself take the site down.
    next();
  }
};
