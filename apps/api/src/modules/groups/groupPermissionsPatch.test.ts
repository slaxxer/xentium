/**
 * Granting or revoking one key must leave every other key alone.
 *
 * The ACP's group page used to save by REPLACING the whole set with the copy it
 * loaded, so anything granted since the page opened (a plugin's defaults,
 * another admin) was silently revoked on the next click. It lost a real grant
 * that way while the page was being built. The page now sends only what
 * changed; this pins that the endpoint behind it cannot do the same damage.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { groupsService } from "./groups.service.js";

const KEY = "perm_patch_probe";
const PERMS = ["probe.alpha", "probe.beta", "probe.gamma"];
let groupId: string;

const held = async () => (await prisma.groupPermission.findMany({
  where: { groupId }, include: { permission: true },
})).map((gp) => gp.permission.key).sort();

beforeEach(async () => {
  assertDisposableDatabase();
  await prisma.group.deleteMany({ where: { key: KEY } });
  for (const key of PERMS) {
    await prisma.permission.upsert({ where: { key }, update: {}, create: { key, label: key } });
  }
  groupId = (await prisma.group.create({ data: { name: "Patch probe", key: KEY, isSystem: false } })).id;
  await groupsService.setPermissions(groupId, ["probe.alpha", "probe.beta"]);
});

afterEach(async () => {
  await prisma.group.deleteMany({ where: { key: KEY } });
  await prisma.permission.deleteMany({ where: { key: { in: PERMS } } });
});

describe("patching a group's permissions", () => {
  it("grants one key and keeps the rest", async () => {
    await groupsService.patchPermissions(groupId, ["probe.gamma"], []);
    expect(await held()).toEqual(["probe.alpha", "probe.beta", "probe.gamma"]);
  });

  it("revokes one key and keeps the rest", async () => {
    await groupsService.patchPermissions(groupId, [], ["probe.alpha"]);
    expect(await held()).toEqual(["probe.beta"]);
  });

  it("is idempotent, and ignores keys nobody registered", async () => {
    await groupsService.patchPermissions(groupId, ["probe.alpha", "no.such.key"], ["probe.gamma"]);
    expect(await held()).toEqual(["probe.alpha", "probe.beta"]);
  });

  it("revokes a key named in both lists", async () => {
    await groupsService.patchPermissions(groupId, ["probe.beta"], ["probe.beta"]);
    expect(await held()).toEqual(["probe.alpha"]);
  });
});
