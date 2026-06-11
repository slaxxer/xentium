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

export const BETA_COOKIE_NAME = "nv_beta";

export function clearBetaCookie(res: Response) {
  res.clearCookie(BETA_COOKIE_NAME, { path: "/" });
}
