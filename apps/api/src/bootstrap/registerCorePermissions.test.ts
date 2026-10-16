/**
 * `registerCorePermissions` runs on every boot. It may CREATE what is missing, never
 * undo what an admin changed: a revoked default stays revoked, a renamed system
 * group keeps its name, and only a permission seen for the first time is granted to
 * its default groups. Until 2026-10-08 every restart re-applied both.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CorePermissions } from "@xentium/contracts";
import { prisma } from "../infrastructure/db.js";
import { assertDisposableDatabase } from "../test/testDatabase.js";
import { staffGroupKeys } from "../shared/utils/staff.js";
import { registerCorePermissions } from "./registerCorePermissions.js";

const KEY = CorePermissions.MODERATION_PROTECTED;

async function holders(): Promise<string[]> {
  const rows = await prisma.groupPermission.findMany({
    where:  { permission: { key: KEY } },
    select: { group: { select: { key: true } } },
  });
  return rows.map((r) => r.group.key).sort();
}

beforeEach(async () => {
  assertDisposableDatabase();
  await registerCorePermissions();
});

afterEach(async () => {
  // Leave the defaults as a fresh install has them, for the files that follow.
  await prisma.group.update({ where: { key: "moderator" }, data: { name: "Moderator" } });
  await prisma.permission.deleteMany({ where: { key: KEY } });
  await registerCorePermissions();
});

describe("registerCorePermissions", () => {
  it("grants a new permission to its default groups", async () => {
    await prisma.permission.deleteMany({ where: { key: KEY } });
    await registerCorePermissions();
    expect(await holders()).toEqual(["admin", "moderator", "supermod"]);
    expect([...(await staffGroupKeys())].sort()).toEqual(["admin", "moderator", "supermod"]);
  });

  it("keeps a revoked default revoked across a restart", async () => {
    const perm = await prisma.permission.findUniqueOrThrow({ where: { key: KEY } });
    const mod = await prisma.group.findUniqueOrThrow({ where: { key: "moderator" } });
    await prisma.groupPermission.delete({ where: { groupId_permissionId: { groupId: mod.id, permissionId: perm.id } } });

    await registerCorePermissions();

    expect(await holders()).toEqual(["admin", "supermod"]);
    expect(await staffGroupKeys()).not.toContain("moderator");
  });

  it("gives a newly created system group its default precedence and badge colour", async () => {
    await prisma.group.delete({ where: { key: "supermod" } });
    await registerCorePermissions();
    const g = await prisma.group.findUniqueOrThrow({ where: { key: "supermod" }, include: { progression: true } });
    expect(g.progression?.badgeColor).toBe("#e0702a");
    expect(g.displayOrder).toBe(2);
    // The recreated group holds no grants (defaults go only to a NEW permission), so
    // give every core permission back to its default groups, as on a fresh install.
    await prisma.permission.deleteMany({ where: { key: { in: Object.values(CorePermissions) } } });
    await registerCorePermissions();
  });

  it("keeps a badge colour an admin changed or cleared", async () => {
    const mod = await prisma.group.findUniqueOrThrow({ where: { key: "moderator" } });
    await prisma.groupProgression.upsert({
      where: { groupId: mod.id }, update: { badgeColor: null }, create: { groupId: mod.id, badgeColor: null },
    });
    await registerCorePermissions();
    expect((await prisma.groupProgression.findUniqueOrThrow({ where: { groupId: mod.id } })).badgeColor).toBeNull();
  });

  it("does not rename a system group back", async () => {
    await prisma.group.update({ where: { key: "moderator" }, data: { name: "Crew" } });
    await registerCorePermissions();
    expect((await prisma.group.findUniqueOrThrow({ where: { key: "moderator" } })).name).toBe("Crew");
  });
});
