import type { RequestHandler } from "express";
import { verifyAccess } from "../../modules/auth/auth.tokens.js";
import { redis, rkey } from "../../infrastructure/redis.js";
import { NodevoError } from "../errors/NodevoError.js";
import { NEC } from "../errors/nec.js";

const ONLINE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Expected high-frequency rejections (guests, 15-min token expiry) — canonical
// NEC shape via errorMiddleware, but persist:false keeps them out of error_log.
export function unauthenticatedError() {
  return new NodevoError({ code: NEC.AUTH_UNAUTHENTICATED, httpStatus: 401, message: "Authentication required", persist: false });
}
export function invalidTokenError() {
  return new NodevoError({ code: NEC.AUTH_TOKEN_INVALID, httpStatus: 401, message: "Invalid or expired token", persist: false });
}

export const requireAuth: RequestHandler = async (req, _res, next) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) throw unauthenticatedError();

  let userId: string, sessionId: string;
  try {
    ({ userId, sessionId } = await verifyAccess(token));
  } catch {
    throw invalidTokenError();
  }
  req.userId = userId;
  req.sessionId = sessionId;

  // Fire-and-forget: update online presence sorted set (score = timestamp)
  redis.zadd(rkey("online:users"), Date.now(), userId).catch(() => {});

  next();
};

export { ONLINE_TTL_MS };
