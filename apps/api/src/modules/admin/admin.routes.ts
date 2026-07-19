import { Router } from "express";
import { requirePermission } from "../../shared/middleware/requirePermission.js";
import { makeRateLimiter } from "../../shared/middleware/rateLimit.js";
import { CorePermissions, NEC } from "@nodevo/contracts";
import { NodevoError } from "../../shared/errors/NodevoError.js";
import { adminController } from "./admin.controller.js";
import { groupsRouter } from "../groups/groups.routes.js";
import { permissionsRouter } from "../permissions/permissions.routes.js";
import { adminProgressionRouter } from "../progression/progression.routes.js";

export const adminRouter: Router = Router();

const adminGuard = requirePermission(CorePermissions.ADMIN_ACCESS);
const isDev = process.env.NODE_ENV !== "production";
const licenseActivateLimiter = makeRateLimiter("license-activate", 60 * 60_000, isDev ? 1000 : 5); // §26: 5/hr

// Dashboard + health
adminRouter.get("/dashboard",           adminGuard, adminController.dashboard);
adminRouter.get("/dashboard/analytics", adminGuard, adminController.dashboardAnalytics);
adminRouter.get("/health",              adminGuard, adminController.health);

// Users
adminRouter.get("/users", adminGuard, adminController.listUsers);
adminRouter.get("/users/:id", adminGuard, adminController.getUserDetail);
adminRouter.get("/users/:id/login-events", adminGuard, adminController.listUserLoginEvents);
adminRouter.put("/users/:id/groups", adminGuard, adminController.setUserGroups);
adminRouter.patch("/users/:id/active", adminGuard, adminController.setUserActive);
adminRouter.post("/users/:id/ban",     adminGuard, adminController.banUser);
adminRouter.delete("/users/:id/ban",   adminGuard, adminController.liftBan);
adminRouter.post("/users/:id/force-logout",    adminGuard, adminController.forceLogoutUser);
adminRouter.post("/users/:id/password-reset",  adminGuard, adminController.sendPasswordReset);

// Profile fields
adminRouter.get("/profile-fields", adminGuard, adminController.listProfileFields);
adminRouter.post("/profile-fields", adminGuard, adminController.createProfileField);
adminRouter.patch("/profile-fields/:id", adminGuard, adminController.updateProfileField);
adminRouter.delete("/profile-fields/:id", adminGuard, adminController.deleteProfileField);
adminRouter.put("/profile-fields/reorder", adminGuard, adminController.reorderProfileFields);

// Settings
adminRouter.get("/settings",      adminGuard, adminController.getSettings);
adminRouter.get("/settings/:key", adminGuard, adminController.getOneSetting);
adminRouter.put("/settings/:key", adminGuard, adminController.setSetting);

// Articles
adminRouter.get("/articles", adminGuard, adminController.listArticles);
adminRouter.delete("/articles/:id", adminGuard, adminController.deleteArticle);

// Moderation — read + write (Phase 10)
adminRouter.get("/reports",            adminGuard, adminController.listReports);
adminRouter.patch("/reports/:id",      adminGuard, adminController.updateReport);
adminRouter.get("/warnings",           adminGuard, adminController.listWarnings);
adminRouter.post("/warnings",          adminGuard, adminController.issueWarning);
adminRouter.patch("/warnings/:id/pardon", adminGuard, adminController.pardonWarning);
adminRouter.get("/bans",               adminGuard, adminController.listBans);
adminRouter.get("/cases",              adminGuard, adminController.listCases);
adminRouter.patch("/cases/:id",                adminGuard, adminController.updateCase);
adminRouter.patch("/cases/:id/notes",          adminGuard, adminController.updateCaseNotes);
adminRouter.post("/cases/:id/ban-all",         adminGuard, adminController.banCaseUsers);
adminRouter.post("/cases/:id/revoke-exception",adminGuard, adminController.revokeException);
adminRouter.get("/modlog",             adminGuard, adminController.listModLog);
adminRouter.delete("/comments/article/:id", adminGuard, adminController.deleteArticleComment);
adminRouter.delete("/comments/profile/:id", adminGuard, adminController.deleteProfileComment);

// Plugins
adminRouter.get("/installed-plugins", adminGuard, adminController.listInstalledPlugins);

// License
adminRouter.get("/license",            adminGuard, adminController.getActiveLicense);
// Manual key activation removed 2026-07-18: the ACP requires a linked
// marketplace account — activation happens from the account (connect/refresh).
adminRouter.post("/license/refresh",   adminGuard, adminController.refreshLicense);
adminRouter.delete("/license",         adminGuard, adminController.deactivateLicense);

// Error log
adminRouter.get("/error-log",    adminGuard, adminController.listErrorLog);
adminRouter.delete("/error-log", adminGuard, adminController.clearErrorLog);

// Dev-only error simulator — lets an admin trigger a real backend error to verify
// error_log persistence + the frontend fatal-halt UI. Never mounted in production.
if (isDev) {
  adminRouter.get("/_debug/throw", adminGuard, (req, _res) => {
    const type = String(req.query.type ?? "critical");
    switch (type) {
      case "nodevo500":
        // A deliberate NodevoError with a 5xx status → severity 'error', halts.
        throw new NodevoError({ code: NEC.API_INTERNAL, httpStatus: 500, message: "Simulated NodevoError (500)" });
      case "notfound":
        // 4xx → toast only, does NOT halt the site (contrast case).
        throw NodevoError.notFound("Simulated 404 (should NOT halt the site)");
      case "critical":
      default:
        // Unhandled throw → caught by the catch-all → NEC-API-5000, severity 'critical'.
        throw new Error("Simulated critical backend error (unhandled throw)");
    }
  });
}

// Migration history
adminRouter.get("/migration-history", adminGuard, adminController.listMigrationHistory);

// Scheduled tasks (cron jobs)
adminRouter.get("/jobs",            adminGuard, adminController.listJobs);
adminRouter.put("/jobs/:key",       adminGuard, adminController.updateJob);
adminRouter.post("/jobs/:key/run",  adminGuard, adminController.runJob);

// Style history
adminRouter.get("/style-history", adminGuard, adminController.listStyleHistory);

// Nav items
adminRouter.get("/nav-items",             adminGuard, adminController.listNavItems);
adminRouter.post("/nav-items",            adminGuard, adminController.createNavItem);
adminRouter.patch("/nav-items/reorder",   adminGuard, adminController.reorderNavItems);
adminRouter.patch("/nav-items/:id",       adminGuard, adminController.updateNavItem);
adminRouter.delete("/nav-items/:id",      adminGuard, adminController.deleteNavItem);

// Plugin-registered ACP pages (used by ACP sidebar nav)
adminRouter.get("/registered-pages", adminGuard, async (_req, res, next) => {
  try {
    const { acpPageRegistry } = await import("../../core/plugin-engine/acp-page-registry.js");
    res.json(acpPageRegistry.getAll());
  } catch (err) { next(err); }
});

// Plugin-registered NEC codes (used by ACP Error Reference page)
adminRouter.get("/nec-codes", adminGuard, async (_req, res, next) => {
  try {
    const { necRegistry } = await import("../../core/nec-registry/nec-registry.js");
    res.json(necRegistry.getAll());
  } catch (err) { next(err); }
});

// Marketplace (ADR 0001) — catalogue mirror + server-side account connection.
adminRouter.get("/marketplace/plugins",        adminGuard, adminController.listMarketplacePlugins);
adminRouter.get("/marketplace/connection",     adminGuard, adminController.getMarketplaceConnection);
adminRouter.get("/marketplace/updates",        adminGuard, adminController.getMarketplaceUpdates);
adminRouter.post("/marketplace/connection",    adminGuard, adminController.connectMarketplace);
adminRouter.delete("/marketplace/connection",  adminGuard, adminController.disconnectMarketplace);
// The authenticated download gate — proves account + per-domain ownership.
adminRouter.post("/marketplace/authorize",     adminGuard, licenseActivateLimiter, adminController.authorizeMarketplaceDownload);
// Direct install (§16.2): authorize → server-side fetch + sha256 verify → normal intake.
adminRouter.post("/marketplace/install",       adminGuard, licenseActivateLimiter, adminController.installFromMarketplace);
// Update-in-place (§16.2): same chokepoint, engine swaps the newer artifact in.
adminRouter.post("/marketplace/update",        adminGuard, licenseActivateLimiter, adminController.updateFromMarketplace);

// Sub-routers
adminRouter.use("/groups",       groupsRouter);
adminRouter.use("/permissions",  permissionsRouter);
adminRouter.use("/progression",  adminProgressionRouter);
