import type { Request, Response } from "express";
import crypto from "node:crypto";
import { env } from "../../config/env.js";

const DEVICE_COOKIE = "nv_did";

/** Normalize a client IP for storage: strip the IPv4-mapped IPv6 prefix so a
 *  dual-stack socket records `127.0.0.1` instead of `::ffff:127.0.0.1`. Keeps
 *  real IPv6 addresses intact. Use everywhere an IP is persisted (login events,
 *  activity log, etc.) so geo/IP-intel joins match on a clean value. */
export function normalizeIp(ip: string | undefined | null): string | undefined {
  if (!ip) return undefined;
  return ip.startsWith("::ffff:") ? ip.slice("::ffff:".length) : ip;
}

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
  // `cookies` is carried so AUTH GUARDS can read their own (a beta plugin needs
  // `nv_beta`). Signed only — an unsigned cookie is attacker-controlled, and a
  // gate that trusted one could be walked straight through.
  return {
    ip:             normalizeIp(req.ip),
    userAgent:      req.headers["user-agent"],
    deviceCookieId,
    cookies:        (req.signedCookies ?? {}) as Record<string, string>,
  };
}
