/**
 * ACP → Moderation → Mod Settings, and the enforcement behind it.
 *
 * Every setting on the page used to be saved and then ignored. These pin that each
 * one now does what its row says:
 *   - the ladder the page edits is the ladder that runs, and a step fires ONCE;
 *   - warnings expire on the policy's schedule and stop counting;
 *   - "clear the count after a ban" restarts the ladder;
 *   - a ban outside the range is refused unless moderators may override;
 *   - an impossible range or a duplicate step is refused on save.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/db.js";
import { bustSettingsCache } from "../../shared/utils/settings.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { modSettingsService, modSettingsPatchSchema } from "./modSettings.service.js";
import { moderationService } from "../moderation/moderation.service.js";
import { adminService } from "./admin.service.js";
import { MOD_POLICY_DEFAULTS } from "../moderation/moderationPolicy.js";

const P = "modpolicy";
const KEYS = Object.keys(MOD_POLICY_DEFAULTS);
let member: string;
let actor: string;

async function user(name: string) {
  return (await prisma.user.create({
    data: { username: `${P}_${name}`, email: `${P}_${name}@example.test`, passwordHash: "x" },
  })).id;
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { username: { startsWith: `${P}_` } }, select: { id: true } });
  const uids = users.map((u) => u.id);
  await prisma.moderationWarning.deleteMany({ where: { userId: { in: uids } } });
  await prisma.moderationBan.deleteMany({ where: { userId: { in: uids } } });
  await prisma.moderationLog.deleteMany({ where: { OR: [{ targetId: { in: uids } }, { actorId: { in: uids } }] } });
  await prisma.notification.deleteMany({ where: { userId: { in: uids } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: uids } } });
  await prisma.setting.deleteMany({ where: { key: { in: KEYS } } });
  for (const k of KEYS) bustSettingsCache(k);
}

beforeEach(async () => {
  assertDisposableDatabase();
  await cleanup();
  member = await user("member");
  actor = await user("actor");
});

afterEach(cleanup);

const warn = () => moderationService.issueWarning({ userId: member, issuedById: actor, reason: "probe warning" });
const activeBans = () => prisma.moderationBan.count({ where: { userId: member, status: "active" } });

describe("the escalation ladder", () => {
  it("runs the ladder the page saved, and each step fires once", async () => {
    await modSettingsService.update({
      ladder: [
        { warningCount: 3, action: "ban_temporary", banDays: 2, notifyModerators: false },
        { warningCount: 2, action: "notify", notifyModerators: false },
      ],
    });
    const saved = await modSettingsService.get();
    expect(saved.ladder.map((s) => s.warningCount)).toEqual([2, 3]);

    await warn(); await warn();
    expect(await activeBans()).toBe(0);           // "notify" never bans
    await warn();
    expect(await activeBans()).toBe(1);

    // Lift it, warn again: the 4th warning is past the step, so nothing re-fires.
    await prisma.moderationBan.updateMany({ where: { userId: member }, data: { status: "lifted" } });
    await warn();
    expect(await activeBans()).toBe(0);
  });
});

describe("warning lifetime", () => {
  it("stamps the policy's expiry and stops counting expired warnings", async () => {
    await modSettingsService.update({ expiry: { enabled: true, days: 10 } });
    const w = await warn();
    const days = (w.expiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(10);

    await prisma.moderationWarning.update({ where: { id: w.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await moderationService.countedWarnings(member, false)).toBe(0);
  });

  it("leaves warnings open-ended when expiry is off", async () => {
    await modSettingsService.update({ expiry: { enabled: false, days: 10 } });
    expect((await warn()).expiresAt).toBeNull();
  });
});

describe("clearing the count after a ban", () => {
  it("counts only warnings issued since the latest ban", async () => {
    await modSettingsService.update({ ladder: [] });
    await warn(); await warn();
    await prisma.moderationBan.create({
      data: { userId: member, issuedById: actor, type: "temporary", reason: "x", status: "expired" },
    });
    await warn();
    expect(await moderationService.countedWarnings(member, false)).toBe(3);
    expect(await moderationService.countedWarnings(member, true)).toBe(1);
  });
});

describe("ban length", () => {
  const inDays = (d: number) => new Date(Date.now() + d * 86_400_000);

  it("refuses a length outside the range when overriding is off", async () => {
    await modSettingsService.update({ bans: { defaultDays: 7, minDays: 3, maxDays: 30, allowOverride: false } });
    await expect(adminService.banUser({ userId: member, issuedById: actor, type: "temporary", reason: "x", expiresAt: inDays(60) }))
      .rejects.toThrow(/between 3 and 30/);
    expect(await activeBans()).toBe(0);
  });

  it("allows it with overriding on, and says so in the mod log", async () => {
    await modSettingsService.update({ bans: { defaultDays: 7, minDays: 3, maxDays: 30, allowOverride: true } });
    await moderationService.issueBan({ userId: member, issuedById: actor, type: "temporary", reason: "x", expiresAt: inDays(60) });
    const log = await prisma.moderationLog.findFirst({ where: { targetId: member, action: "ban.issued" } });
    expect(log?.meta).toMatchObject({ rangeOverride: true, days: 60 });
  });
});

describe("saving", () => {
  it("refuses an impossible range, a default outside it, and two steps on one count", () => {
    const bans = (b: object) => modSettingsPatchSchema.safeParse({ bans: { defaultDays: 7, minDays: 1, maxDays: 30, allowOverride: true, ...b } }).success;
    expect(bans({})).toBe(true);
    expect(bans({ minDays: 40 })).toBe(false);
    expect(bans({ defaultDays: 90 })).toBe(false);
    const step = { warningCount: 3, action: "notify", notifyModerators: true };
    expect(modSettingsPatchSchema.safeParse({ ladder: [step, step] }).success).toBe(false);
  });
});
