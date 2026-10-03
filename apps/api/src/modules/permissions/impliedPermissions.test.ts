/**
 * A stronger key carries the weaker one (PERMISSION_IMPLIES): the ACP draws
 * `article.edit.own` as held-but-locked for a group that holds
 * `article.edit.any`, so the server checks must agree or the ACP would promise
 * a right nobody enforces.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { groupsService } from "../groups/groups.service.js";
import { permissionsService } from "./permissions.service.js";
import { assertPermission } from "../../shared/middleware/requirePermission.js";
import { permissionCache } from "./permission.cache.js";

const KEY = "implied_probe";
const EMAIL = "implied-probe@example.test";
let userId: string;

beforeEach(async () => {
  assertDisposableDatabase();
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  await prisma.group.deleteMany({ where: { key: KEY } });
  for (const key of ["article.edit.any", "article.edit.own", "article.revisions.view"]) {
    await prisma.permission.upsert({ where: { key }, update: {}, create: { key, label: key } });
  }
  const group = await prisma.group.create({ data: { name: "Implied probe", key: KEY, isSystem: false } });
  userId = (await prisma.user.create({ data: { email: EMAIL, username: "implied_probe", passwordHash: "x" } })).id;
  await prisma.userGroup.create({ data: { userId, groupId: group.id } });
  await groupsService.setPermissions(group.id, ["article.edit.any"]);
  await permissionCache.invalidate(userId);
});

afterEach(async () => {
  await permissionCache.invalidate(userId);
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  await prisma.group.deleteMany({ where: { key: KEY } });
});

describe("implied permissions", () => {
  it("a one-off check honours the implication", async () => {
    expect(await permissionsService.userHasPermission(userId, "article.edit.own")).toBe(true);
    expect(await permissionsService.userHasPermission(userId, "article.revisions.view")).toBe(false);
  });

  it("the route guards honour it", async () => {
    await expect(assertPermission(userId, "article.edit.own")).resolves.toBeUndefined();
    await expect(assertPermission(userId, "article.revisions.view")).rejects.toThrow();
  });
});
