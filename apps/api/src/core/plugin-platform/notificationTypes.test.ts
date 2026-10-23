/**
 * Add-ons' notification types: members see a switch per type (staff types only for
 * staff), and a type switched off is not delivered.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { pluginRegistry } from "../plugin-engine/plugin-registry.js";
import { _resetNotificationTypes, registerNotificationTypes } from "./notificationTypes.js";
import { accountService } from "../../modules/account/account.service.js";
import { notificationService } from "../../modules/notifications/notification.service.js";

const P = "nt-test";
let userId = "";

beforeAll(async () => {
  assertDisposableDatabase();
  userId = (await prisma.user.create({ data: { email: "nt@example.test", username: "nt_member", passwordHash: "x" } })).id;
  pluginRegistry.register({ id: P, name: "Gallery" } as never, "enabled");
  registerNotificationTypes(P, [
    { type: "gallery.comment", label: "Comments on your photos", email: true },
    { type: "gallery.review", label: "Photos waiting for review", permission: "gallery.moderate" },
    "gallery.featured",
  ]);
});
afterAll(async () => {
  _resetNotificationTypes();
  pluginRegistry.deregister(P);
  await prisma.notification.deleteMany({ where: { userId } });
  await prisma.notificationPreference.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
});

describe("add-on notification types", () => {
  it("refuses core's own prefixes and malformed types", () => {
    expect(() => registerNotificationTypes("bad", ["mention.everyone"])).toThrow(/prefix/);
    expect(() => registerNotificationTypes("bad", ["nodot"])).toThrow();
  });

  it("offers a switch per type, hiding staff types from members", async () => {
    const prefs = await accountService.getNotificationPreferences(userId);
    const group = prefs.addons.find((g) => g.pluginId === P)!;
    expect(group.name).toBe("Gallery");
    expect(group.types.map((t) => t.type)).toEqual(["gallery.comment", "gallery.featured"]);
    expect(group.types[0]).toMatchObject({ label: "Comments on your photos", inApp: true, email: false, emailOffered: true });
    expect(group.types[1]!.label).toBe("Featured");
  });

  it("stops delivering a type the member switched off", async () => {
    const base = await accountService.getNotificationPreferences(userId);
    await accountService.updateNotificationPreferences(userId, {
      inApp: base.inApp, email: base.email,
      addons: { "gallery.comment": { inApp: false, email: false }, "gallery.unknown": { inApp: false, email: true } },
    });
    const after = await accountService.getNotificationPreferences(userId);
    expect(after.addons.find((g) => g.pluginId === P)!.types[0]!.inApp).toBe(false);
    expect(await prisma.notificationPreference.count({ where: { userId, typePattern: "gallery.unknown" } })).toBe(0);

    await notificationService.dispatch({ userId, type: "gallery.comment", title: "x", body: "y", channels: ["in_app"] });
    await notificationService.dispatch({ userId, type: "gallery.featured", title: "x", body: "y", channels: ["in_app"] });
    const got = await prisma.notification.findMany({ where: { userId }, select: { type: true } });
    expect(got.map((n) => n.type)).toEqual(["gallery.featured"]);
  });
});
