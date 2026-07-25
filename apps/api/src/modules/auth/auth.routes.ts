import { Router } from "express";
import {
  loginHandler, refreshHandler, logoutHandler, meHandler,
  registerHandler, sendCodeHandler, checkAvailabilityHandler, registrationStatusHandler,
  requestPasswordResetHandler, confirmPasswordResetHandler,
} from "./auth.controller.js";
import { requireAuth } from "../../shared/middleware/requireAuth.js";
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

export const authRouter: Router = Router();
authRouter.get("/registration-status", registrationStatusHandler);
authRouter.post("/register/check-availability", availLimiter, checkAvailabilityHandler);
authRouter.post("/register/send-code", codeLimiter, sendCodeHandler);
authRouter.post("/register", registerLimiter, registerHandler);
authRouter.post("/login", loginLimiter, loginHandler);
authRouter.post("/refresh", refreshLimiter, refreshHandler);
authRouter.post("/password-reset", resetLimiter, requestPasswordResetHandler);
authRouter.post("/password-reset/confirm", resetLimiter, confirmPasswordResetHandler);
authRouter.post("/logout", logoutHandler);
authRouter.get("/me", requireAuth, meHandler);
