import { Router } from "express";
import {
  loginHandler, pinStepHandler, checkInviteHandler, magicLinkRequestHandler, magicLinkConsumeHandler, legalConsentHandler, refreshHandler, logoutHandler, meHandler,
  registerHandler, sendCodeHandler, checkAvailabilityHandler, registrationStatusHandler,
  requestPasswordResetHandler, confirmPasswordResetHandler,
} from "./auth.controller.js";
import { requireAuth } from "../../shared/middleware/requireAuth.js";
import {
  methodsHandler, mySignInMethodsHandler, doorwayHandler,
  passkeyLoginOptionsHandler, passkeyLoginVerifyHandler, passkeyRegisterOptionsHandler, passkeyRegisterVerifyHandler,
  passkeyRenameHandler, passkeyRemoveHandler,
  oauthStartHandler, oauthLinkHandler, oauthUnlinkHandler, oauthCallbackHandler,
} from "./auth.methods.controller.js";
import { makeRateLimiter } from "../../shared/middleware/rateLimit.js";

const isDev = process.env.NODE_ENV !== "production";
// Redis-backed (shared across processes, §55). §26 limits — bumped in dev.
const loginLimiter    = makeRateLimiter("auth-login",    15 * 60_000, isDev ? 1000 : 10);
const registerLimiter = makeRateLimiter("auth-register", 60 * 60_000, isDev ? 1000 : 5);
const codeLimiter     = makeRateLimiter("auth-code",     60 * 60_000, isDev ? 1000 : 5);
const refreshLimiter  = makeRateLimiter("auth-refresh",       60_000, isDev ? 1000 : 20);
const resetLimiter    = makeRateLimiter("auth-reset",    60 * 60_000, isDev ? 1000 : 3);
// Debounced as-you-type probe from the register wizard — needs a far looser
// budget than the code/register limiters, but still bounded against scraping.
const availLimiter    = makeRateLimiter("auth-avail",         60_000, isDev ? 1000 : 30);
// A sign-in link is an email sent on request: the same budget as a reset link.
const magicLimiter    = makeRateLimiter("auth-magic",    60 * 60_000, isDev ? 1000 : 5);

export const authRouter: Router = Router();
authRouter.get("/registration-status", registrationStatusHandler);
authRouter.post("/register/check-availability", availLimiter, checkAvailabilityHandler);
authRouter.post("/register/check-invite", availLimiter, checkInviteHandler);
authRouter.post("/register/send-code", codeLimiter, sendCodeHandler);
authRouter.post("/register", registerLimiter, registerHandler);
authRouter.post("/login", loginLimiter, loginHandler);
authRouter.post("/login/pin", loginLimiter, pinStepHandler);
authRouter.post("/magic-link", magicLimiter, magicLinkRequestHandler);
authRouter.post("/magic-link/consume", loginLimiter, magicLinkConsumeHandler);

// Which sign-in methods this install offers (public), and a member's own.
authRouter.get("/methods", methodsHandler);
authRouter.get("/doorway", doorwayHandler);
authRouter.get("/sign-in-methods", requireAuth, mySignInMethodsHandler);

// Passkeys: sign in (anonymous), then add / rename / remove (signed in).
authRouter.post("/passkey/login/options", loginLimiter, passkeyLoginOptionsHandler);
authRouter.post("/passkey/login/verify", loginLimiter, passkeyLoginVerifyHandler);
authRouter.post("/passkey/register/options", requireAuth, passkeyRegisterOptionsHandler);
authRouter.post("/passkey/register/verify", requireAuth, passkeyRegisterVerifyHandler);
authRouter.patch("/passkeys/:id", requireAuth, passkeyRenameHandler);
authRouter.delete("/passkeys/:id", requireAuth, passkeyRemoveHandler);

// Sign-in providers. start/link return the provider URL; the provider calls back.
authRouter.post("/oauth/:provider/start", loginLimiter, oauthStartHandler);
authRouter.post("/oauth/:provider/link", requireAuth, oauthLinkHandler);
authRouter.delete("/oauth/:provider", requireAuth, oauthUnlinkHandler);
authRouter.get("/oauth/:provider/callback", loginLimiter, oauthCallbackHandler);
authRouter.post("/refresh", refreshLimiter, refreshHandler);
authRouter.post("/password-reset", resetLimiter, requestPasswordResetHandler);
authRouter.post("/password-reset/confirm", resetLimiter, confirmPasswordResetHandler);
authRouter.post("/logout", logoutHandler);
authRouter.get("/me", requireAuth, meHandler);
authRouter.post("/legal-consent", requireAuth, legalConsentHandler);
