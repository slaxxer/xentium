/**
 * `hasPermission` — the non-throwing twin of `requirePermission`, exposed to plugins
 * as `host.permissions.has` (e.g. whether a member may still reply to a
 * closed thread). It must give the same answer the middleware acts on.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { permissionCache } from "../../modules/permissions/permission.cache.js";
import { assertPermission, hasPermission } from "./requirePermission.js";

const KEY = "hasperm_probe";
const PERM = "probe.moderate";
let holder = "", other = "";

async function cleanup() {
  await prisma.user.deleteMany({ where: { username: { startsWith: KEY } } });
  await prisma.group.deleteMany({ where: { key: KEY } });
  await prisma.permission.deleteMany({ where: { key: PERM } });
}

beforeEach(async () => {
  assertDisposableDatabase();
  await cleanup();
  const perm = await prisma.permission.create({ data: { key: PERM, label: PERM } });
  const group = await prisma.group.create({ data: { name: "Probe mods", key: KEY, isSystem: false } });
  await prisma.groupPermission.create({ data: { groupId: group.id, permissionId: perm.id } });
  holder = (await prisma.user.create({ data: { username: `${KEY}_mod`, email: `${KEY}_mod@example.test`, passwordHash: "x" } })).id;
  other = (await prisma.user.create({ data: { username: `${KEY}_member`, email: `${KEY}_member@example.test`, passwordHash: "x" } })).id;
  await prisma.userGroup.create({ data: { userId: holder, groupId: group.id } });
  await permissionCache.invalidate(holder);
  await permissionCache.invalidate(other);
});

afterEach(cleanup);

describe("hasPermission", () => {
  it("answers yes for a holder and no for anyone else, without throwing", async () => {
    expect(await hasPermission(holder, PERM as never)).toBe(true);
    expect(await hasPermission(other, PERM as never)).toBe(false);
  });

  it("agrees with the middleware's check", async () => {
    await expect(assertPermission(holder, PERM as never)).resolves.toBeUndefined();
    await expect(assertPermission(other, PERM as never)).rejects.toMatchObject({ httpStatus: 403 });
  });
});
