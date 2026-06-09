import type { RequestHandler } from "express";
import { verifyAccess } from "../../modules/auth/auth.tokens.js";

/**
 * Soft authentication: if a valid Bearer token is present, attach userId/sessionId.
 * Missing or invalid tokens are silently ignored — the route still runs.
 * Use on endpoints that change behaviour based on viewer identity but do not require it
 * (e.g. public profile pages, privacy-filtered field reads).
 */
export const optionalAuth: RequestHandler = async (req, _res, next) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return next();
  try {
    const { userId, sessionId } = await verifyAccess(token);
    (req as any).userId = userId;
    (req as any).sessionId = sessionId;
  } catch {
    // ignore invalid tokens — treat as anonymous
  }
  next();
};
