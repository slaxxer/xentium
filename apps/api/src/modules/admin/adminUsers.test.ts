/**
 * ACP → Users, server side.
 *
 * Pins four things the page depends on and that were each wrong or missing:
 * the detail response carrying password hashes, the status filter being
 * silently ignored, what counts as "flagged", and group membership saved as a
 * replacement set instead of a delta.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { adminUsersService, FAILED_SIGNIN_FLAG } from "./adminUsers.service.js";

const PREFIX = "usrprobe";
const GROUP_KEYS = [`${PREFIX}_a`, `${PREFIX}_b`, `${PREFIX}_admin`];
type Ids = Record<"active" | "banned" | "expired" | "inactive" | "failing" | "signup" | "installer", string>;
let ids = {} as Ids;
const groups: Record<string, string> = {};

async function makeUser(name: string, data: Record<string, unknown> = {}) {
  const u = await prisma.user.create({
    data: {
      username: `${PREFIX}_${name}`, email: `${PREFIX}_${name}@example.test`,
      passwordHash: "argon2-not-a-real-hash", ...data,
    },
  });
  return u.id;
}

async function cleanup() {
  await prisma.user.deleteMany({ where: { username: { startsWith: `${PREFIX}_` } } });
  await prisma.group.deleteMany({ where: { key: { in: GROUP_KEYS } } });
}

beforeEach(async () => {
  assertDisposableDatabase();
  await cleanup();
  ids = {
    active:     await makeUser("active"),
    banned:     await makeUser("banned", { bannedUntil: new Date(Date.now() + 86400e3) }),
    expired:    await makeUser("expired", { bannedUntil: new Date(Date.now() - 86400e3) }),
    inactive:   await makeUser("inactive", { isActive: false }),
    failing:    await makeUser("failing"),
    signup:     await makeUser("signup"),
    installer:  await makeUser("installer"),
  };
  // Repeated failed sign-ins in the last 24 hours.
  await prisma.loginEvent.createMany({
    data: Array.from({ length: FAILED_SIGNIN_FLAG }, () => ({
      userId: ids.failing, emailAttempted: "x", success: false, eventType: "login",
    })),
  });
  // Signed up through the form and never verified — flagged. `installer` never
  // verified either, but never registered, like the site owner's own account.
  await prisma.loginEvent.create({
    data: { userId: ids.signup, emailAttempted: "x", success: true, eventType: "register" },
  });
  for (const key of GROUP_KEYS) {
    groups[key] = (await prisma.group.create({ data: { name: key, key, isSystem: false } })).id;
  }
});

afterEach(cleanup);

const search = { search: `${PREFIX}_`, page: 1, limit: 50 };
const names = (rows: { username: string }[]) => rows.map((r) => r.username.replace(`${PREFIX}_`, "")).sort();

describe("the user list", () => {
  it("filters by status, and an expired ban counts as active", async () => {
    const banned = await adminUsersService.listUsers({ ...search, status: "banned" });
    expect(names(banned.data)).toEqual(["banned"]);

    const inactive = await adminUsersService.listUsers({ ...search, status: "inactive" });
    expect(names(inactive.data)).toEqual(["inactive"]);

    const active = await adminUsersService.listUsers({ ...search, status: "active" });
    expect(names(active.data)).toEqual(["active", "expired", "failing", "installer", "signup"]);
  });

  it("flags repeated failed sign-ins and an unverified sign-up, and nothing else", async () => {
    const flagged = await adminUsersService.listUsers({ ...search, status: "flagged" });
    expect(names(flagged.data)).toEqual(["failing", "signup"]);
    const byName = Object.fromEntries(flagged.data.map((u) => [u.username.replace(`${PREFIX}_`, ""), u.flags]));
    expect(byName.failing).toEqual(["failed_signins"]);
    expect(byName.signup).toEqual(["unverified_email"]);
  });

  it("reports the total of the FILTERED set, and site-wide counts beside it", async () => {
    const res = await adminUsersService.listUsers({ ...search, status: "banned" });
    expect(res.meta.total).toBe(1);
    expect(res.counts.total).toBeGreaterThanOrEqual(7);
    expect(res.counts.banned).toBeGreaterThanOrEqual(1);
  });

  it("sorts by name", async () => {
    const res = await adminUsersService.listUsers({ ...search, sort: "name" });
    const got = res.data.map((u) => u.username);
    expect(got).toEqual([...got].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
  });
});

describe("one member's page", () => {
  it("never carries a password or PIN hash", async () => {
    const detail = await adminUsersService.getUserDetail(ids.active) as Record<string, unknown>;
    expect(detail).not.toHaveProperty("passwordHash");
    expect(detail).not.toHaveProperty("loginPinHash");
    expect(JSON.stringify(detail)).not.toContain("argon2-not-a-real-hash");
  });
});

describe("group membership", () => {
  it("adds and removes only what was named", async () => {
    const [a, b] = [groups[`${PREFIX}_a`]!, groups[`${PREFIX}_b`]!];
    await prisma.userGroup.create({ data: { userId: ids.active, groupId: a } });

    // Something else grants B after the page opened. Removing A must not take B.
    await prisma.userGroup.create({ data: { userId: ids.active, groupId: b } });
    const res = await adminUsersService.patchUserGroups(ids.active, [], [a], ids.installer);
    expect(res.groups.map((g) => g.id)).toEqual([b]);
  });

  it("is idempotent", async () => {
    const a = groups[`${PREFIX}_a`]!;
    await adminUsersService.patchUserGroups(ids.active, [a], [], ids.installer);
    const res = await adminUsersService.patchUserGroups(ids.active, [a], [], ids.installer);
    expect(res.groups.map((g) => g.id)).toEqual([a]);
  });

  it("refuses to take an admin out of the administrator group by their own hand", async () => {
    let adminGroup = await prisma.group.findUnique({ where: { key: "admin" } });
    const created = !adminGroup;
    if (!adminGroup) adminGroup = await prisma.group.create({ data: { name: "Administrator", key: "admin", isSystem: true } });
    await prisma.userGroup.create({ data: { userId: ids.active, groupId: adminGroup.id } });
    try {
      await expect(adminUsersService.patchUserGroups(ids.active, [], [adminGroup.id], ids.active))
        .rejects.toThrow(/Administrator group/);
    } finally {
      await prisma.userGroup.deleteMany({ where: { userId: ids.active } });
      if (created) await prisma.group.delete({ where: { id: adminGroup.id } });
    }
  });

  it("refuses a group that does not exist", async () => {
    await expect(adminUsersService.patchUserGroups(ids.active, ["no-such-group"], [], ids.installer))
      .rejects.toThrow(/Group not found/);
  });
});
