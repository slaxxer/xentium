/**
 * The profile's Warnings tab: who may read it, what each reader gets, and the
 * "one more warning and…" ladder position.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/db.js";
import { bustSettingsCache } from "../../shared/utils/settings.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { effectiveStatus, getStanding, ladderPosition } from "./standing.js";

const P = "stdprobe";
let member = "", stranger = "", mod = "";

async function cleanup() {
  await prisma.moderationWarning.deleteMany({ where: { user: { username: { startsWith: P } } } });
  await prisma.moderationBan.deleteMany({ where: { user: { username: { startsWith: P } } } });
  await prisma.loginEvent.deleteMany({ where: { emailAttempted: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: P } } });
  await prisma.setting.deleteMany({ where: { key: "moderation.policy" } });
  bustSettingsCache();
}

beforeEach(async () => {
  assertDisposableDatabase();
  await cleanup();
  const mk = (n: string) => prisma.user.create({ data: { username: `${P}_${n}`, email: `${P}_${n}@example.test`, passwordHash: "x" } });
  member = (await mk("member")).id;
  stranger = (await mk("stranger")).id;
  mod = (await mk("mod")).id;
  const modGroup = await prisma.group.upsert({
    where: { key: "moderator" }, update: {}, create: { key: "moderator", name: "Moderator", isSystem: true },
  });
  await prisma.userGroup.create({ data: { userId: mod, groupId: modGroup.id } });
  await prisma.setting.create({ data: { key: "moderation.policy", value: { thresholds: [
    { warningCount: 2, action: "notify" },
    { warningCount: 3, action: "ban_temporary", banDays: 7 },
    { warningCount: 5, action: "ban_permanent" },
  ] } } });
  bustSettingsCache();
  const day = 86400e3;
  await prisma.moderationWarning.createMany({ data: [
    { userId: member, issuedById: mod, reason: "spam", expiresAt: new Date(Date.now() + 30 * day) },
    { userId: member, issuedById: mod, reason: "flame", expiresAt: new Date(Date.now() + 60 * day) },
    { userId: member, issuedById: mod, reason: "old", expiresAt: new Date(Date.now() - day) }, // past its date, row still "active"
    { userId: member, issuedById: mod, reason: "forgiven", status: "pardoned", pardonedAt: new Date(), pardonedBy: mod },
  ] });
  await prisma.moderationBan.create({ data: { userId: member, issuedById: mod, type: "temporary", reason: "earlier", status: "expired" } });
  await prisma.loginEvent.createMany({ data: [
    { userId: member, emailAttempted: `${P}_member`, success: true, eventType: "login", ip: "10.9.8.7" },
    { userId: stranger, emailAttempted: `${P}_stranger`, success: true, eventType: "login", ip: "10.9.8.7" },
  ] });
});

afterEach(cleanup);

describe("who may read a member's standing", () => {
  it("refuses anyone but the member and staff", async () => {
    await expect(getStanding(member, stranger)).rejects.toMatchObject({ httpStatus: 403 });
  });

  it("gives the member their warnings, with the issuer, but no bans or IPs", async () => {
    const s = await getStanding(member, member);
    expect(s.isOwn).toBe(true);
    expect(s.warnings.map((w) => [w.reason, w.status])).toEqual(expect.arrayContaining([
      ["spam", "active"], ["flame", "active"], ["old", "expired"], ["forgiven", "pardoned"],
    ]));
    expect(s.warnings.find((w) => w.reason === "spam")?.issuedBy.username).toBe(`${P}_mod`);
    expect(s.warnings.find((w) => w.reason === "forgiven")?.pardonedBy).toBe(`${P}_mod`);
    expect(s).not.toHaveProperty("bans");
    expect(s).not.toHaveProperty("ips");
  });

  it("gives staff the bans and the IPs, with other accounts on each", async () => {
    const s = await getStanding(member, mod) as Awaited<ReturnType<typeof getStanding>> & {
      bans: unknown[]; ips: Array<{ ip: string; otherAccounts: number; country: string | null }>;
    };
    expect(s.isStaff).toBe(true);
    expect(s.bans).toHaveLength(1);
    expect(s.ips).toEqual([expect.objectContaining({ ip: "10.9.8.7", otherAccounts: 1, country: null })]);
  });
});

describe("the ladder", () => {
  it("counts only warnings that still count, and names the next sanction", async () => {
    const s = await getStanding(member, member);
    expect(s.counted).toBe(2);
    // The 2-warning step only notifies the moderators; the next SANCTION is at 3.
    expect(s.next).toEqual({ warningCount: 3, action: "ban_temporary", banDays: 7, remaining: 1 });
  });

  it("says nothing past the last step", () => {
    expect(ladderPosition([{ warningCount: 3, action: "ban_permanent" }], 3).next).toBeNull();
  });

  it("treats a warning past its date as expired before the nightly job runs", () => {
    expect(effectiveStatus({ status: "active", expiresAt: new Date(Date.now() - 1000) })).toBe("expired");
    expect(effectiveStatus({ status: "active", expiresAt: null })).toBe("active");
  });
});
