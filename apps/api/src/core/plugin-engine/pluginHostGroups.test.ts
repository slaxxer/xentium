/** The plugin host's group helpers: grants apply at once, and never an admin group. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { addToGroup, ensureGroup, removeFromGroup } from "./plugin-context.js";

const P = "hostgrp";
let userId: string; let plainGroup: string; let adminGroup: string;

async function clean() {
  await prisma.userGroup.deleteMany({ where: { user: { username: { startsWith: P } } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: P } } });
  await prisma.groupPermission.deleteMany({ where: { group: { key: { startsWith: P } } } });
  await prisma.groupProgression.deleteMany({ where: { group: { key: { startsWith: P } } } });
  await prisma.group.deleteMany({ where: { key: { startsWith: P } } });
}

beforeEach(async () => {
  assertDisposableDatabase();
  await clean();
  userId = (await prisma.user.create({ data: { username: `${P}_u`, email: `${P}@example.test`, passwordHash: "x" } })).id;
  plainGroup = (await prisma.group.create({ data: { key: `${P}_supporter`, name: "Probe supporter" } })).id;
  const perm = await prisma.permission.upsert({ where: { key: "admin.access" }, update: {}, create: { key: "admin.access", label: "admin.access" } });
  adminGroup = (await prisma.group.create({
    data: { key: `${P}_admins`, name: "Probe admins", permissions: { create: [{ permissionId: perm.id }] } },
  })).id;
});
afterEach(clean);

describe("plugin host: groups", () => {
  it("adds a member to a group and takes them out again", async () => {
    await addToGroup(userId, plainGroup);
    await addToGroup(userId, plainGroup); // twice is still once
    expect(await prisma.userGroup.count({ where: { userId, groupId: plainGroup } })).toBe(1);
    await removeFromGroup(userId, plainGroup);
    expect(await prisma.userGroup.count({ where: { userId, groupId: plainGroup } })).toBe(0);
  });

  it("never adds anyone to a group with admin access", async () => {
    await expect(addToGroup(userId, adminGroup)).rejects.toMatchObject({ httpStatus: 403 });
    expect(await prisma.userGroup.count({ where: { userId, groupId: adminGroup } })).toBe(0);
  });

  it("creates a group a plugin needs once, with its badge, and then leaves it to the admin", async () => {
    const id = await ensureGroup({ key: `${P}_customer`, name: "Customer", badgeColor: "#c8a24a", nameGlow: true, displayOrder: 80 });
    const made = await prisma.group.findUniqueOrThrow({ where: { id }, include: { progression: true, permissions: true } });
    expect(made).toMatchObject({ name: "Customer", isSystem: false, displayOrder: 80 });
    expect(made.permissions).toEqual([]);
    expect(made.progression).toMatchObject({ isProgressionGroup: false, badgeColor: "#c8a24a", badgeTextShadow: true });

    // The admin renames it; the plugin asks again on its next enable and changes nothing.
    await prisma.group.update({ where: { id }, data: { name: "Kunde" } });
    expect(await ensureGroup({ key: `${P}_customer`, name: "Customer", badgeColor: "#000000" })).toBe(id);
    expect((await prisma.group.findUniqueOrThrow({ where: { id } })).name).toBe("Kunde");
  });

  it("refuses a key that is not one", async () => {
    await expect(ensureGroup({ key: "Not A Key!", name: "x" })).rejects.toBeTruthy();
  });
});
