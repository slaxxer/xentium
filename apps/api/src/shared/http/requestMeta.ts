import type { Request, Response } from "express";
import crypto from "node:crypto";
import { env } from "../../config/env.js";

const DEVICE_COOKIE = "nv_did";

export function getRequestMeta(req: Request, res: Response) {
  let deviceCookieId = req.cookies?.[DEVICE_COOKIE];
  if (!deviceCookieId) {
    deviceCookieId = crypto.randomUUID();
    res.cookie(DEVICE_COOKIE, deviceCookieId, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 730, // ~2y
    });
  }
  return { ip: req.ip, userAgent: req.headers["user-agent"], deviceCookieId };
}
