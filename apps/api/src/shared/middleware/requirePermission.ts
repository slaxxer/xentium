import type { RequestHandler } from "express";
import { prisma } from "../../infrastructure/db.js";
import { verifyAccess } from "../../modules/auth/auth.tokens.js";
import { isAccessTokenRevoked } from "../../modules/auth/session-revocation.js";
import { expandImplied, type PermissionKey } from "@xentium/contracts";
import { permissionCache } from "../../modules/permissions/permission.cache.js";
import { XentiumError } from "../errors/XentiumError.js";
import { XEC } from "../errors/xec.js";
import { unauthenticatedError, invalidTokenError } from "./requireAuth.js";

/**
 * Verify the Bearer access token AND enforce the revocation denylist — these
 * permission guards are sometimes mounted standalone (not after requireAuth), so
 * they must run the same immediate-revocation check (BUGS.md #4).
 */
async function authedUserId(authHeader: string | undefined): Promise<{ userId: string; sessionId: string }> {
  const token = authHeader?.replace("Bearer ", "");
  if (!token) throw unauthenticatedError();
  let userId: string, sessionId: string, issuedAtMs: number | undefined;
  try {
    ({ userId, sessionId, issuedAtMs } = await verifyAccess(token));
  } catch {
    throw invalidTokenError();
  }
  if (await isAccessTokenRevoked(userId, sessionId, issuedAtMs)) throw invalidTokenError();
  return { userId, sessionId };
}

function permissionDeniedError(keys: PermissionKey[]) {
  return new XentiumError({
    code: XEC.PERM_DENIED, httpStatus: 403,
    message: "You don't have permission to do that",
    details: { required: keys },
  });
}

// Load (cache-first) the set of effective permission keys for a user.
async function loadEffective(userId: string): Promise<string[]> {
  const cached = await permissionCache.getEffective(userId);
  if (cached) return cached;

  // Cache miss — load all granted keys from DB and cache them
  const groups = await prisma.userGroup.findMany({
    where: { userId },
    include: {
      group: {
        include: {
          permissions: {
            include: { permission: { select: { key: true } } },
          },
        },
      },
    },
  });
  // Implied keys (PERMISSION_IMPLIES) are expanded here, once, so every guard
  // and the cache see them without storing them on the group.
  const effective = expandImplied(
    groups.flatMap((ug) => ug.group.permissions.map((gp) => gp.permission.key)),
  );
  await permissionCache.setEffective(userId, effective);
  return effective;
}

export function requirePermission(key: PermissionKey): RequestHandler {
  return async (req, _res, next) => {
    const { userId, sessionId } = await authedUserId(req.headers.authorization);
    const effective = await loadEffective(userId);

    if (!effective.includes(key)) throw permissionDeniedError([key]);

    req.userId = userId;
    req.sessionId = sessionId;
    next();
  };
}

/** Grants access if the user holds ANY one of the given permission keys. */
export function requireAnyPermission(...keys: PermissionKey[]): RequestHandler {
  return async (req, _res, next) => {
    const { userId, sessionId } = await authedUserId(req.headers.authorization);
    const effective = await loadEffective(userId);

    if (!keys.some((k) => effective.includes(k))) throw permissionDeniedError(keys);

    req.userId = userId;
    req.sessionId = sessionId;
    next();
  };
}

/**
 * The same check, for a route whose required permission depends on its INPUT — the
 * ModCanvas action endpoint needs warn, ban or report rights depending on the mode.
 */
/** Whether the user holds `key` (implied permissions included) — the same answer
 *  `requirePermission` acts on, for code that must DECIDE rather than refuse. */
/** The user's effective keys (implied ones expanded) — what `/auth/me` hands the browser. */
export async function effectivePermissions(userId: string): Promise<string[]> {
  return loadEffective(userId);
}

export async function hasPermission(userId: string, key: PermissionKey): Promise<boolean> {
  return (await loadEffective(userId)).includes(key);
}

export async function assertPermission(userId: string, key: PermissionKey): Promise<void> {
  const effective = await loadEffective(userId);
  if (!effective.includes(key)) throw permissionDeniedError([key]);
}
