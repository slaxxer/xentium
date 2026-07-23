import type { RequestHandler } from "express";
import { prisma } from "../../infrastructure/db.js";
import { verifyAccess } from "../../modules/auth/auth.tokens.js";
import type { PermissionKey } from "@nodevo/contracts";
import { permissionCache } from "../../modules/permissions/permission.cache.js";
import { NodevoError } from "../errors/NodevoError.js";
import { NEC } from "../errors/nec.js";
import { unauthenticatedError, invalidTokenError } from "./requireAuth.js";

function permissionDeniedError(keys: PermissionKey[]) {
  return new NodevoError({
    code: NEC.PERM_DENIED, httpStatus: 403,
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
  const effective = [
    ...new Set(
      groups.flatMap((ug) =>
        ug.group.permissions.map((gp) => gp.permission.key),
      ),
    ),
  ];
  await permissionCache.setEffective(userId, effective);
  return effective;
}

export function requirePermission(key: PermissionKey): RequestHandler {
  return async (req, _res, next) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) throw unauthenticatedError();

    let userId: string;
    try {
      ({ userId } = await verifyAccess(token));
    } catch {
      throw invalidTokenError();
    }
    const effective = await loadEffective(userId);

    if (!effective.includes(key)) throw permissionDeniedError([key]);

    req.userId = userId;
    next();
  };
}

/** Grants access if the user holds ANY one of the given permission keys. */
export function requireAnyPermission(...keys: PermissionKey[]): RequestHandler {
  return async (req, _res, next) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) throw unauthenticatedError();

    let userId: string;
    try {
      ({ userId } = await verifyAccess(token));
    } catch {
      throw invalidTokenError();
    }
    const effective = await loadEffective(userId);

    if (!keys.some((k) => effective.includes(k))) throw permissionDeniedError(keys);

    req.userId = userId;
    next();
  };
}
