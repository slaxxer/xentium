import { Router } from "express";
import { CorePermissions } from "@xentium/contracts";
import { requirePermission } from "../../shared/middleware/requirePermission.js";
import { makeRateLimiter } from "../../shared/middleware/rateLimit.js";
import { emailController } from "./email.controller.js";

/**
 * Admin email: SMTP status, the test send, and the template editor. Mounted
 * under /api/admin so acpActivityLogger audits every mutation, and gated on
 * ADMIN_ACCESS — editing what a password-reset mail says is equivalent to
 * editing the site's trust surface, so it belongs with the other admin-only
 * configuration rather than behind a narrower key.
 */
export const adminEmailRouter: Router = Router();

const guard = requirePermission(CorePermissions.ADMIN_ACCESS);

// The test send is an authenticated outbound-mail trigger: rate-limit it so a
// compromised admin session cannot turn the instance into a relay for spam.
const isDev = process.env.NODE_ENV !== "production";
const testSendLimiter = makeRateLimiter("email-test", 60 * 60_000, isDev ? 1000 : 20);

adminEmailRouter.get("/status", guard, emailController.smtpStatus);
adminEmailRouter.post("/test", guard, testSendLimiter, emailController.sendTest);

// The frame every template is sent in: accent, page colour, header, footer note.
adminEmailRouter.get("/design", guard, emailController.getDesign);
adminEmailRouter.put("/design", guard, emailController.saveDesign);
adminEmailRouter.post("/design/preview", guard, emailController.previewDesign);

adminEmailRouter.get("/templates", guard, emailController.listTemplates);
adminEmailRouter.get("/templates/:key", guard, emailController.getTemplate);
adminEmailRouter.put("/templates/:key", guard, emailController.saveTemplate);
adminEmailRouter.post("/templates/:key/reset", guard, emailController.resetTemplate);
adminEmailRouter.get("/templates/:key/preview", guard, emailController.previewTemplate);
