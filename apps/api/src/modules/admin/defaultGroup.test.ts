/**
 * The sign-up group setting: it must name a real group, and never one that opens
 * the ACP (a wrong pick there would make every newcomer staff).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CorePermissions } from "@xentium/contracts";

const { prisma } = await import("../../infrastructure/db.js");
const { assertDisposableDatabase } = await import("../../test/testDatabase.js");
const { adminService } = await import("./admin.service.js");

const P = "dgtest";

async function clean() {
  await prisma.setting.deleteMany({ where: { key: "auth.default_group" } });
  await prisma.group.deleteMany({ where: { key: { startsWith: P } } });
}

beforeEach(async () => {
  assertDisposableDatabase();
  await clean();
  await prisma.group.create({ data: { key: `${P}_plain`, name: "Plain" } });
  const staff = await prisma.group.create({ data: { key: `${P}_staff`, name: "Staff" } });
  const perm = await prisma.permission.upsert({
    where: { key: CorePermissions.ADMIN_ACCESS }, update: {}, create: { key: CorePermissions.ADMIN_ACCESS, label: "ACP" },
  });
  await prisma.groupPermission.create({ data: { groupId: staff.id, permissionId: perm.id } });
});
afterEach(clean);

describe("auth.default_group", () => {
  it("takes an ordinary group", async () => {
    await adminService.setSetting("auth.default_group", `${P}_plain`);
    expect((await prisma.setting.findUnique({ where: { key: "auth.default_group" } }))?.value).toBe(`${P}_plain`);
  });

  it("refuses a group with ACP access, and one that does not exist", async () => {
    await expect(adminService.setSetting("auth.default_group", `${P}_staff`)).rejects.toMatchObject({ code: "XEC-GROUP-4010", httpStatus: 422 });
    await expect(adminService.setSetting("auth.default_group", `${P}_nope`)).rejects.toMatchObject({ code: "XEC-GROUP-4010" });
    await expect(adminService.setSetting("auth.default_group", 42)).rejects.toMatchObject({ code: "XEC-GROUP-4010" });
    expect(await prisma.setting.findUnique({ where: { key: "auth.default_group" } })).toBeNull();
  });
});
