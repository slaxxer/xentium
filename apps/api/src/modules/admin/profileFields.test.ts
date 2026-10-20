/**
 * ACP → Profile Fields against the real test database.
 *
 * What must hold: the fill-in figures count only active members' non-empty
 * answers; a field's type is fixed once it is built in or answered; a choice
 * always has options; and "required at sign-up" always means "asked at sign-up".
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { prisma } = await import("../../infrastructure/db.js");
const { assertDisposableDatabase } = await import("../../test/testDatabase.js");
const { adminService } = await import("./admin.service.js");

const PREFIX = "pft_";
const EMAILS = ["pft-a@example.test", "pft-b@example.test"];

async function cleanup() {
  const ids = (await prisma.userProfileField.findMany({ where: { key: { startsWith: PREFIX } }, select: { id: true } })).map((f) => f.id);
  await prisma.userProfileFieldValue.deleteMany({ where: { fieldId: { in: ids } } });
  await prisma.userProfileField.deleteMany({ where: { key: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { in: EMAILS } } });
}
beforeEach(async () => { assertDisposableDatabase(); await cleanup(); });
afterEach(cleanup);

const user = (email: string, isActive = true) =>
  prisma.user.create({ data: { email, username: email.split("@")[0]!.replace(/-/g, "_"), passwordHash: "x", isActive } });

describe("profile field stats", () => {
  it("counts non-empty answers of active members only", async () => {
    const f = await adminService.createProfileField({ key: `${PREFIX}game`, label: "Game", type: "text" });
    const [a, b] = [await user(EMAILS[0]!), await user(EMAILS[1]!, false)];
    await prisma.userProfileFieldValue.createMany({
      data: [
        { userId: a.id, fieldId: f.id, value: "Chess" },
        { userId: b.id, fieldId: f.id, value: "Go" }, // deactivated: not counted
      ],
    });
    const stats = await adminService.profileFieldStats();
    expect(stats.filled[f.id]).toBe(1);
    expect(stats.members).toBeGreaterThanOrEqual(1);
  });
});

describe("profile field rules", () => {
  it("lets a field change type until a member has answered it", async () => {
    const f = await adminService.createProfileField({ key: `${PREFIX}town`, label: "Town", type: "text" });
    await expect(adminService.updateProfileField(f.id, { type: "longtext" })).resolves.toMatchObject({ type: "longtext" });

    const a = await user(EMAILS[0]!);
    await prisma.userProfileFieldValue.create({ data: { userId: a.id, fieldId: f.id, value: "Berlin" } });
    await expect(adminService.updateProfileField(f.id, { type: "date" })).rejects.toMatchObject({ httpStatus: 409 });
    // Everything else stays editable.
    await expect(adminService.updateProfileField(f.id, { label: "Home town" })).resolves.toMatchObject({ label: "Home town" });
  });

  it("never changes a built-in field's type", async () => {
    const f = await prisma.userProfileField.create({ data: { key: `${PREFIX}sys`, label: "Sys", type: "text", isSystem: true } });
    await expect(adminService.updateProfileField(f.id, { type: "url" })).rejects.toMatchObject({ httpStatus: 403 });
  });

  it("requires options for a choice, on create and when switching to it", async () => {
    await expect(adminService.createProfileField({ key: `${PREFIX}pick`, label: "Pick", type: "choice" }))
      .rejects.toMatchObject({ httpStatus: 422 });
    const f = await adminService.createProfileField({ key: `${PREFIX}pick2`, label: "Pick", type: "text" });
    await expect(adminService.updateProfileField(f.id, { type: "choice" })).rejects.toMatchObject({ httpStatus: 422 });
    await expect(adminService.updateProfileField(f.id, { type: "choice", options: ["A", "B"] }))
      .resolves.toMatchObject({ type: "choice", options: ["A", "B"] });
  });

  it("asks at sign-up whatever is required at sign-up, and stores blank text as nothing", async () => {
    const f = await adminService.createProfileField({ key: `${PREFIX}req`, label: "Req", type: "text", helpText: "  " });
    expect(f.helpText).toBeNull();
    const after = await adminService.updateProfileField(f.id, { requiredOnRegistration: true, showOnRegistration: false, linkPrefix: "" });
    expect(after).toMatchObject({ requiredOnRegistration: true, showOnRegistration: true, linkPrefix: null });
  });
});
