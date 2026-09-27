/**
 * ACP → Moderation → Review Cases, server side.
 *
 * Pins what the redesigned page relies on and what was wrong before it:
 *   - a case's IPs are ITS accounts' IPs (every case used to carry one list for the
 *     whole page);
 *   - "Ban all" skips staff and the already banned — exactly what the preview shows —
 *     records the reason the moderator typed, and signs the banned accounts out
 *     (it used to leave their sessions alive);
 *   - only staff can be assigned a case.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { adminCasesService } from "./adminCases.service.js";
import { moderationService } from "../moderation/moderation.service.js";

const P = "caseprobe";
let ids: Record<"a" | "b" | "c" | "mod" | "actor", string>;
let modGroupId: string;
let createdModGroup = false;

async function user(name: string) {
  return (await prisma.user.create({
    data: { username: `${P}_${name}`, email: `${P}_${name}@example.test`, passwordHash: "x" },
  })).id;
}
async function login(userId: string, ip: string, cookie: string) {
  await prisma.loginEvent.create({
    data: { userId, emailAttempted: "x", success: true, eventType: "login", ip, deviceCookieId: cookie },
  });
}
async function kase(linkedUserIds: string[]) {
  return (await prisma.moderationCase.create({
    data: { type: "multi_account_suspicion", severity: "high", signals: ["probe"], linkedUserIds },
  })).id;
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { username: { startsWith: `${P}_` } }, select: { id: true } });
  const uids = users.map((u) => u.id);
  await prisma.moderationCase.deleteMany({ where: { signals: { equals: ["probe"] } } });
  await prisma.moderationBan.deleteMany({ where: { userId: { in: uids } } });
  await prisma.moderationLog.deleteMany({ where: { OR: [{ targetId: { in: uids } }, { actorId: { in: uids } }] } });
  await prisma.notification.deleteMany({ where: { userId: { in: uids } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: uids } } });
  if (createdModGroup) await prisma.group.deleteMany({ where: { id: modGroupId } });
}

beforeEach(async () => {
  assertDisposableDatabase();
  await cleanup();
  const existing = await prisma.group.findUnique({ where: { key: "moderator" } });
  createdModGroup = !existing;
  modGroupId = existing?.id ?? (await prisma.group.create({ data: { key: "moderator", name: "Moderator", isSystem: true } })).id;
  ids = { a: await user("a"), b: await user("b"), c: await user("c"), mod: await user("mod"), actor: await user("actor") };
  await prisma.userGroup.create({ data: { userId: ids.mod, groupId: modGroupId } });
  await login(ids.a, "10.0.0.1", "dev-1");
  await login(ids.b, "10.0.0.1", "dev-1");
  await login(ids.c, "10.9.9.9", "dev-9");
});

afterEach(cleanup);

describe("the case list", () => {
  it("gives each case its own accounts' IPs and shared identifiers, not the page's", async () => {
    const ab = await kase([ids.a, ids.b]);
    const c = await kase([ids.c]);
    const res = await adminCasesService.listCases({ page: 1, limit: 50, status: "all", sort: "new" });
    const byId = new Map(res.data.map((x) => [x.id, x]));

    expect(byId.get(ab)!.ipAddresses).toEqual(["10.0.0.1"]);
    expect(byId.get(c)!.ipAddresses).toEqual(["10.9.9.9"]);
    expect(byId.get(ab)!.sharedIdentifiers.map((s) => s.type).sort()).toEqual(["device", "ip"]);
    expect(byId.get(c)!.sharedIdentifiers).toEqual([]);
  });

  it("marks who a ban would skip", async () => {
    const id = await kase([ids.a, ids.mod]);
    const res = await adminCasesService.listCases({ page: 1, limit: 50, status: "all", sort: "new" });
    const accounts = res.data.find((x) => x.id === id)!.linkedUsers;
    expect(accounts.find((a) => a.id === ids.a)).toMatchObject({ status: "active", willBeBanned: true });
    expect(accounts.find((a) => a.id === ids.mod)).toMatchObject({ status: "staff", willBeBanned: false });
  });
});

describe("banning a case", () => {
  it("bans exactly what the preview promised, with the reason typed, and signs them out", async () => {
    const id = await kase([ids.a, ids.b, ids.mod]);
    await prisma.moderationBan.create({
      data: { userId: ids.b, issuedById: ids.actor, type: "permanent", reason: "earlier", status: "active" },
    });
    const session = await prisma.session.create({
      data: { userId: ids.a, refreshTokenHash: `${P}-${Date.now()}`, expiresAt: new Date(Date.now() + 86400e3) },
    });

    const results = await moderationService.banCaseUsers(id, ids.actor, "Same person, three accounts");
    const outcome = Object.fromEntries(results.map((r) => [r.userId, r.skipped]));
    expect(outcome).toEqual({ [ids.a]: false, [ids.b]: true, [ids.mod]: true });

    const ban = await prisma.moderationBan.findFirst({ where: { userId: ids.a, status: "active" } });
    expect(ban?.reason).toBe("Same person, three accounts");
    // ⚠ The point of the fix: the banned account's session no longer works.
    expect((await prisma.session.findUnique({ where: { id: session.id } }))?.revokedAt).not.toBeNull();
  });
});

describe("assigning a case", () => {
  it("assigns staff, logs it, and clears", async () => {
    const id = await kase([ids.a]);
    const res = await adminCasesService.assignCase(id, ids.actor, ids.mod);
    expect(res.assignedTo?.id).toBe(ids.mod);
    expect(await prisma.moderationLog.count({ where: { targetId: id, action: "case.assigned" } })).toBe(1);

    await adminCasesService.assignCase(id, ids.actor, null);
    expect((await prisma.moderationCase.findUnique({ where: { id } }))?.assignedTo).toBeNull();
  });

  it("refuses someone who is not staff", async () => {
    const id = await kase([ids.a]);
    await expect(adminCasesService.assignCase(id, ids.actor, ids.c)).rejects.toThrow(/Only staff/);
  });
});
