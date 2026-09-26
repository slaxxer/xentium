import { Router } from "express";
import { requirePermission } from "../../shared/middleware/requirePermission.js";
import { makeRateLimiter } from "../../shared/middleware/rateLimit.js";
import { CorePermissions, XEC } from "@xentium/contracts";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { adminController } from "./admin.controller.js";
import { groupsRouter } from "../groups/groups.routes.js";
import { adminProvidersHandler, adminProviderUpdateHandler } from "../auth/auth.methods.controller.js";
import { permissionsRouter } from "../permissions/permissions.routes.js";
import { adminProgressionRouter } from "../progression/progression.routes.js";
import { scheduledTaskRouter } from "../scheduled-tasks/scheduled-task.routes.js";
import { adminLayoutRouter } from "../layouts/layout.routes.js";
import { themeRouter } from "../themes/theme.routes.js";
import { adminEmailRouter } from "../email/email.routes.js";

export const adminRouter: Router = Router();

const adminGuard = requirePermission(CorePermissions.ADMIN_ACCESS);
const isDev = process.env.NODE_ENV !== "production";
/**
 * Marketplace artifact operations: authorize → install → update. Named for what
 * it guards; despite the old name this limiter was never applied to licence
 * activation.
 *
 * 5/hr was far too tight, because all three routes share ONE bucket: setting up
 * a fresh instance with a handful of plugins exhausted it, and the 429 surfaces
 * as an opaque failure that reads like the marketplace being down. A visible
 * progress dialog makes people retry more, not less.
 *
 * It stays bounded — each call can pull a multi-megabyte artifact — but the real
 * enforcement is elsewhere: the marketplace re-checks entitlement on every
 * download, and every route here is already behind admin.access. This is a
 * second fence, not the only one.
 */
const marketplaceArtifactLimiter = makeRateLimiter("marketplace-artifact", 60 * 60_000, isDev ? 1000 : 30);

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
adminRouter.get("/license",            adminGuard, adminController.getActiveEntitlement);
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
      case "xentium500":
        // A deliberate XentiumError with a 5xx status → severity 'error', halts.
        throw new XentiumError({ code: XEC.API_INTERNAL, httpStatus: 500, message: "Simulated XentiumError (500)" });
      case "notfound":
        // 4xx → toast only, does NOT halt the site (contrast case).
        throw XentiumError.notFound("Simulated 404 (should NOT halt the site)");
      case "critical":
      default:
        // Unhandled throw → caught by the catch-all → XEC-API-5000, severity 'critical'.
        throw new Error("Simulated critical backend error (unhandled throw)");
    }
  });
}

// Migration history
adminRouter.get("/migration-history", adminGuard, adminController.listMigrationHistory);
// Sign-in providers (Google, GitHub, Discord) and the passkey relying party.
adminRouter.get("/auth-providers", adminGuard, adminProvidersHandler);
adminRouter.patch("/auth-providers/:provider", adminGuard, adminProviderUpdateHandler);

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

// Plugin-registered XEC codes (used by ACP Error Reference page)
adminRouter.get("/xec-codes", adminGuard, async (_req, res, next) => {
  try {
    const { necRegistry } = await import("../../core/xec-registry/xec-registry.js");
    res.json(necRegistry.getAll());
  } catch (err) { next(err); }
});

// Broadcasts from the Xentium team — the marketplace's records, already
// signature-verified by the daily check. Dismissing one removes it from this
// site for every admin; nothing records who read it.
adminRouter.get("/announcements",              adminGuard, adminController.listAnnouncements);
adminRouter.post("/announcements/:id/dismiss", adminGuard, adminController.dismissAnnouncement);

// Marketplace (ADR 0001) — catalogue mirror + server-side account connection.
adminRouter.get("/marketplace/plugins",        adminGuard, adminController.listMarketplacePlugins);
adminRouter.get("/marketplace/connection",     adminGuard, adminController.getMarketplaceConnection);
adminRouter.get("/marketplace/owned",          adminGuard, adminController.getMarketplaceOwned);
adminRouter.get("/marketplace/updates",        adminGuard, adminController.getMarketplaceUpdates);
// "Got it" on the core-update dialog: it carries the whole changelog, so reading it counts.
adminRouter.post("/marketplace/updates/core/acknowledge", adminGuard, adminController.acknowledgeCoreUpdate);
// Aggregated admin-attention signals for the frontend navbar ACP badge.
adminRouter.get("/status-summary",             adminGuard, adminController.getStatusSummary);
adminRouter.post("/marketplace/connection",    adminGuard, adminController.connectMarketplace);
// The one-click handshake: start one, then poll it while the admin approves in
// the marketplace tab. The typed connect code above still works and is the
// fallback for anyone who cannot open a browser tab from this machine.
adminRouter.post("/marketplace/link",          adminGuard, adminController.startMarketplaceLink);
adminRouter.get("/marketplace/link/:linkId",   adminGuard, adminController.pollMarketplaceLink);
adminRouter.delete("/marketplace/connection",  adminGuard, adminController.disconnectMarketplace);
// The authenticated download gate — proves account + per-domain ownership.
adminRouter.post("/marketplace/authorize",     adminGuard, marketplaceArtifactLimiter, adminController.authorizeMarketplaceDownload);
// Direct install (§16.2): authorize → server-side fetch + sha256 verify → normal intake.
adminRouter.post("/marketplace/install",       adminGuard, marketplaceArtifactLimiter, adminController.installFromMarketplace);
// Update-in-place (§16.2): same chokepoint, engine swaps the newer artifact in.
adminRouter.post("/marketplace/update",        adminGuard, marketplaceArtifactLimiter, adminController.updateFromMarketplace);

// Sub-routers
adminRouter.use("/groups",       groupsRouter);
adminRouter.use("/permissions",  permissionsRouter);
adminRouter.use("/progression",  adminProgressionRouter);
// Admin-created scheduled tasks (own permission: system.tasks.manage).
adminRouter.use("/tasks",        scheduledTaskRouter);
// Page layout documents (ADR-0005) — same ADMIN_ACCESS gate as Appearance.
adminRouter.use("/layouts",      adminLayoutRouter);
// .xttheme export/import — layouts + tokens as data, never code.
adminRouter.use("/themes",       themeRouter);
adminRouter.use("/email",        adminEmailRouter);
