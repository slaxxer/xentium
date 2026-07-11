import type { RequestHandler } from "express";
import { verifyAccess } from "../../modules/auth/auth.tokens.js";
import { redis, rkey } from "../../infrastructure/redis.js";

const ONLINE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export const requireAuth: RequestHandler = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "unauthenticated" });
    const { userId, sessionId } = await verifyAccess(token);
    req.userId = userId;
    req.sessionId = sessionId;

    // Fire-and-forget: update online presence sorted set (score = timestamp)
    redis.zadd(rkey("online:users"), Date.now(), userId).catch(() => {});

    next();
  } catch {
    res.status(401).json({ error: "invalid_token" });
  }
};

export { ONLINE_TTL_MS };
