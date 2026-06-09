import { Router } from "express";
import { requireAuth } from "../../shared/middleware/requireAuth.js";
import { requirePermission, requireAnyPermission } from "../../shared/middleware/requirePermission.js";
import { CorePermissions } from "@nodevo/contracts";
import { moderationController } from "./moderation.controller.js";

export const moderationRouter: Router = Router();

const modGuard  = requirePermission(CorePermissions.MODERATION_WARN_MANAGE);
const repGuard  = requirePermission(CorePermissions.MODERATION_REPORT_MANAGE);
const banGuard  = requirePermission(CorePermissions.MODERATION_BAN_MANAGE);
const caseGuard = requirePermission(CorePermissions.MODERATION_CASES_MANAGE);
const logGuard  = requirePermission(CorePermissions.MODERATION_LOG_VIEW);
// User typeahead is used by both the warn and ban forms — allow any mod action perm.
const userSearchGuard = requireAnyPermission(
  CorePermissions.MODERATION_WARN_MANAGE,
  CorePermissions.MODERATION_BAN_MANAGE,
  CorePermissions.MODERATION_REPORT_MANAGE,
);

// ── Public (authenticated) ───────────────────────────────────────────────────
moderationRouter.post("/reports", requireAuth, moderationController.fileReport);

// ── Canvas read endpoints (ModCanvas uses these, not admin routes) ───────────
moderationRouter.get("/summary",  requireAuth, moderationController.getSummary);
moderationRouter.get("/users",    userSearchGuard, moderationController.searchUsers);
moderationRouter.get("/users/:id/profile",  userSearchGuard, moderationController.getUserProfile);
moderationRouter.get("/users/:id/warnings", userSearchGuard, moderationController.getUserWarnings);
moderationRouter.get("/users/:id/bans",     userSearchGuard, moderationController.getUserBans);
moderationRouter.get("/reports",  repGuard,   moderationController.listReports);
moderationRouter.get("/warnings", modGuard,   moderationController.listWarnings);
moderationRouter.get("/bans",     banGuard,   moderationController.listBans);
moderationRouter.get("/cases",    caseGuard,  moderationController.listCases);
moderationRouter.get("/log",      logGuard,   moderationController.listLog);

// ── Write actions ────────────────────────────────────────────────────────────
moderationRouter.patch("/reports/:id",         repGuard,   moderationController.updateReport);
moderationRouter.post("/warnings",             modGuard,   moderationController.issueWarning);
moderationRouter.patch("/warnings/:id/pardon", modGuard,   moderationController.pardonWarning);
moderationRouter.post("/bans",                 banGuard,   moderationController.issueBan);
moderationRouter.patch("/bans/:id/lift",       banGuard,   moderationController.liftBan);
moderationRouter.post("/users/:id/sessions/revoke-all", banGuard, moderationController.revokeAllSessions);
moderationRouter.patch("/cases/:id",           caseGuard,  moderationController.updateCase);
moderationRouter.post("/cases/:id/ban-all",    caseGuard,  moderationController.banCaseUsers);
moderationRouter.delete("/comments/article/:id", modGuard, moderationController.deleteArticleComment);
moderationRouter.delete("/comments/profile/:id", modGuard, moderationController.deleteProfileComment);
