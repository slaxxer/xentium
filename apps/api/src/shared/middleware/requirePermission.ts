import type { RequestHandler } from "express";
import { prisma } from "../../infrastructure/db.js";
import { verifyAccess } from "../../modules/auth/auth.tokens.js";
import type { PermissionKey } from "@nodevo/contracts";
import { permissionCache } from "../../modules/permissions/permission.cache.js";

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
  return async (req, res, next) => {
    try {
      const token = req.headers.authorization?.replace("Bearer ", "");
      if (!token) return res.status(401).json({ error: "unauthenticated" });

      const { userId } = await verifyAccess(token);
      const effective = await loadEffective(userId);

      if (!effective.includes(key)) {
        return res.status(403).json({ error: "forbidden" });
      }

      req.userId = userId;
      next();
    } catch {
      res.status(401).json({ error: "invalid_token" });
    }
  };
}

/** Grants access if the user holds ANY one of the given permission keys. */
export function requireAnyPermission(...keys: PermissionKey[]): RequestHandler {
  return async (req, res, next) => {
    try {
      const token = req.headers.authorization?.replace("Bearer ", "");
      if (!token) return res.status(401).json({ error: "unauthenticated" });

      const { userId } = await verifyAccess(token);
      const effective = await loadEffective(userId);

      if (!keys.some((k) => effective.includes(k))) {
        return res.status(403).json({ error: "forbidden" });
      }

      req.userId = userId;
      next();
    } catch {
      res.status(401).json({ error: "invalid_token" });
    }
  };
}
