import type { Response } from "express";
import { env } from "../../config/env.js";

export const REFRESH_COOKIE_NAME = "nv_rt";
const prod = env.NODE_ENV === "production";

export function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true, secure: prod, sameSite: "strict",
    path: "/api/auth", maxAge: 1000 * 60 * 60 * 24 * 30,
  });
}
export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: "/api/auth" });
}

// The beta cookie used to be declared here. It belongs to whichever plugin gates
// on it now: a guard names the cookies it wants cleared and core drops them on
// logout, so core never has to know what any of them mean.
