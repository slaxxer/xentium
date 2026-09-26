import type { Response } from "express";
import { env } from "../../config/env.js";

export const REFRESH_COOKIE_NAME = "xt_rt";
const prod = env.NODE_ENV === "production";

/**
 * `persistent: false` ("don't keep me signed in") sets no max-age, so the
 * browser drops the cookie when it closes; the session row has its own
 * shorter expiry for a browser that never closes.
 */
export function setRefreshCookie(res: Response, token: string, persistent = true) {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true, secure: prod, sameSite: "strict",
    path: "/api/auth", ...(persistent ? { maxAge: 1000 * 60 * 60 * 24 * 30 } : {}),
  });
}
export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: "/api/auth" });
}

// The beta cookie used to be declared here. It belongs to whichever plugin gates
// on it now: a guard names the cookies it wants cleared and core drops them on
// logout, so core never has to know what any of them mean.
