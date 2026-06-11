import { Router } from "express";
import { accountController } from "./account.controller.js";
import { requireAuth } from "../../shared/middleware/requireAuth.js";
import { uploadSingle } from "../../shared/middleware/upload.js";

export const accountRouter: Router = Router();

// All account routes require authentication
accountRouter.use(requireAuth);

accountRouter.patch("/profile", accountController.updateProfile);
accountRouter.post("/avatar", ...uploadSingle("AVATAR", "file"), accountController.uploadAvatar);
accountRouter.patch("/username", accountController.changeUsername);
accountRouter.post("/email", accountController.requestEmailChange);
accountRouter.post("/email/verify-code", accountController.verifyEmailCode);
accountRouter.post("/password", accountController.changePassword);
accountRouter.get("/sessions", accountController.getSessions);
accountRouter.delete("/sessions/:sessionId", accountController.revokeSession);
accountRouter.get("/privacy", accountController.getPrivacy);
accountRouter.patch("/privacy", accountController.updatePrivacy);
accountRouter.get("/username-history", accountController.getUsernameHistory);
accountRouter.get("/profile-fields", accountController.getProfileFieldValues);
accountRouter.patch("/profile-fields", accountController.updateProfileFieldValues);
accountRouter.post("/pin", accountController.setPin);
accountRouter.delete("/pin", accountController.disablePin);
accountRouter.get("/badges",   accountController.getBadgeVisibility);
accountRouter.patch("/badges", accountController.updateBadgeVisibility);
accountRouter.get("/notifications",   accountController.getNotificationPreferences);
accountRouter.patch("/notifications", accountController.updateNotificationPreferences);
