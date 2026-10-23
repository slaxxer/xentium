/**
 * Core announces what happens and asks before it acts: checked through the real
 * services against the test database, the way a plugin would see it.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { XEC } from "../../shared/errors/xec.js";
import { _resetEvents, addFilter, addListener } from "./events.js";
import { adminService } from "../../modules/admin/admin.service.js";
import { adminUsersService } from "../../modules/admin/adminUsers.service.js";
import { moderationService } from "../../modules/moderation/moderation.service.js";
import { handleCallback, startFlow, updateProviderConfig } from "../../modules/auth/oauth.service.js";

const EMAILS = ["events-made@example.test", "events-oauth@example.test", "events-mod@example.test", "events-blocked@example.test"];
const settle = () => new Promise((r) => setTimeout(r, 20));

let modId: string;
let groupId: string;

beforeAll(async () => {
  assertDisposableDatabase();
  const mod = await prisma.user.create({ data: { email: "events-mod@example.test", username: "events_mod", passwordHash: "!", isActive: true } });
  modId = mod.id;
  groupId = (await prisma.group.create({ data: { key: "events_test", name: "Events test" } })).id;
  await updateProviderConfig("google", { enabled: true, clientId: "c", clientSecret: "s" });
});
afterEach(() => _resetEvents());
afterAll(async () => {
  await prisma.moderationBan.deleteMany({ where: { user: { email: { in: EMAILS } } } });
  await prisma.moderationLog.deleteMany({ where: { actorId: modId } });
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
  await prisma.group.deleteMany({ where: { key: "events_test" } });
  await prisma.setting.deleteMany({ where: { key: "auth.oauth.google" } });
});

describe("events from core", () => {
  it("announces a new account, its group change, a ban and the ban lifted", async () => {
    const seen: Array<[string, unknown]> = [];
    for (const e of ["user.registered", "user.groupsChanged", "user.banned", "user.unbanned"]) {
      addListener("probe", e, (p) => { seen.push([e, p]); });
    }

    const made = await adminService.createUser({ email: "events-made@example.test", username: "events_made", password: "a-long-password-1", verified: true });
    await settle();
    expect(seen).toContainEqual(["user.registered", { userId: made.id, method: "admin" }]);

    await adminUsersService.patchUserGroups(made.id, [groupId], [], modId);
    await settle();
    expect(seen.find(([e]) => e === "user.groupsChanged")?.[1]).toMatchObject({ userId: made.id, added: [groupId], removed: [] });

    await moderationService.issueBan({ userId: made.id, issuedById: modId, type: "permanent", reason: "test", notify: false });
    await settle();
    expect(seen).toContainEqual(["user.banned", { userId: made.id, until: null, byUserId: modId }]);

    const ban = await prisma.moderationBan.findFirstOrThrow({ where: { userId: made.id, status: "active" } });
    await moderationService.liftBanById(ban.id, modId);
    await settle();
    expect(seen).toContainEqual(["user.unbanned", { userId: made.id }]);
  });
});

describe("filters in core", () => {
  it("lets an add-on refuse a sign-up, with its own message", async () => {
    addFilter("names", "registration.validate", (i) => (i.username.startsWith("events_") ? { refuse: "names:errors.reserved" } : undefined));
    await expect(adminService.createUser({ email: "events-blocked@example.test", username: "events_blocked", password: "a-long-password-1", verified: true }))
      .rejects.toMatchObject({ code: XEC.PLUGIN_REFUSED, httpStatus: 422, details: { key: "names:errors.reserved", pluginId: "names" } });
    expect(await prisma.user.count({ where: { username: "events_blocked" } })).toBe(0);
  });

  it("sends a refused sign-in-provider sign-up back with the refusal, and makes no account", async () => {
    addFilter("names", "registration.validate", () => ({ refuse: "names:errors.reserved" }));
    const { state } = await startFlow("google", { intent: "signin", persistent: true, returnTo: "/" });
    const out = await handleCallback("google", { code: "c", state }, state, { ip: "127.0.0.1", userAgent: "vitest" }, {
      exchange: async () => "t",
      fetchProfile: async () => ({ id: "events-g1", email: "events-oauth@example.test", emailVerified: true, handle: "events.oauth", name: "E" }),
    });
    expect(out).toMatchObject({ kind: "error", code: XEC.PLUGIN_REFUSED });
    expect(await prisma.user.count({ where: { email: "events-oauth@example.test" } })).toBe(0);
  });

  it("adds an add-on's data to a profile, under its id", async () => {
    addFilter("shop", "profile.extra", ({ userId }) => ({ for: userId }));
    const { userService } = await import("../../modules/users/users.service.js");
    const profile = await userService.getPublicProfile("events_mod");
    expect(profile?.extra).toEqual({ shop: { for: modId } });
  });
});
