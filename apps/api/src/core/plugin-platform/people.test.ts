/**
 * Members for plugins: birthdays only as each member allows, against every
 * combination of Account → Privacy, the date field's visibility, blocks and bans.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { birthdays, canSee, userRefs } from "./people.js";
import { dayKeyIn, startOfDayIn } from "../../shared/utils/timeZone.js";

const PREFIX = "ppl_";
const ids: Record<string, string> = {};
let fieldId: string;
let createdField = false;

async function member(name: string, opts: { dobDisplay?: string; dob?: string; privacy?: string; banned?: boolean; active?: boolean } = {}) {
  const u = await prisma.user.create({ data: {
    email: `${PREFIX}${name}@example.test`, username: `${PREFIX}${name}`, passwordHash: "!",
    isActive: opts.active ?? true, dobDisplay: opts.dobDisplay ?? "birthday",
    bannedUntil: opts.banned ? new Date("9999-12-31") : null,
  } });
  ids[name] = u.id;
  if (opts.dob) await prisma.userProfileFieldValue.create({ data: { userId: u.id, fieldId, value: opts.dob, privacy: opts.privacy ?? "public" } });
}

beforeAll(async () => {
  assertDisposableDatabase();
  const existing = await prisma.userProfileField.findUnique({ where: { key: "date_of_birth" } });
  if (existing) fieldId = existing.id;
  else { fieldId = (await prisma.userProfileField.create({ data: { key: "date_of_birth", label: "Date of birth", type: "date" } })).id; createdField = true; }

  await member("shows", { dob: "1990-03-14" });
  await member("ageonly", { dob: "1991-03-14", dobDisplay: "age" });
  await member("hidden", { dob: "1992-03-14", dobDisplay: "hidden" });
  await member("members", { dob: "1993-03-15", privacy: "members" });
  await member("nobody", { dob: "1994-03-15", privacy: "nobody" });
  await member("banned", { dob: "1995-03-14", banned: true });
  await member("other", { dob: "1996-07-01" });
  await member("viewer");
  await member("blocker", { dob: "1997-03-14" });
  await prisma.userBlock.create({ data: { blockerId: ids.blocker!, blockedId: ids.viewer! } });
});

afterAll(async () => {
  const all = Object.values(ids);
  await prisma.userBlock.deleteMany({ where: { OR: [{ blockerId: { in: all } }, { blockedId: { in: all } }] } });
  await prisma.userProfileFieldValue.deleteMany({ where: { userId: { in: all } } });
  await prisma.user.deleteMany({ where: { id: { in: all } } });
  if (createdField) await prisma.userProfileField.delete({ where: { id: fieldId } });
});

const names = (rows: Array<{ userId: string }>) =>
  rows.map((r) => Object.entries(ids).find(([, id]) => id === r.userId)?.[0]).filter(Boolean).sort();

describe("birthdays", () => {
  const from = new Date("2026-03-13T00:00:00Z");
  const to = new Date("2026-03-16T00:00:00Z");

  it("shows a guest only public birthdays of members who chose to show them", async () => {
    expect(names(await birthdays(from, to, null))).toEqual(["blocker", "shows"]);
  });

  it("adds members-only dates for a member, and hides both sides of a block", async () => {
    expect(names(await birthdays(from, to, ids.viewer!))).toEqual(["members", "shows"]);
  });

  it("gives month and day, never the year", async () => {
    const row = (await birthdays(from, to, null)).find((r) => r.userId === ids.shows);
    expect(row).toEqual({ userId: ids.shows, month: 3, day: 14 });
  });

  it("answers nothing for a range that runs backwards", async () => {
    expect(await birthdays(to, from, null)).toEqual([]);
  });
});

describe("refs and privacy", () => {
  it("names members like core does and leaves out unknown ids", async () => {
    const refs = await userRefs([ids.shows!, ids.banned!, "00000000-0000-0000-0000-000000000000"]);
    expect(Object.keys(refs).sort()).toEqual([ids.banned, ids.shows].sort());
    expect(refs[ids.shows!]).toMatchObject({ username: "ppl_shows", profileUrl: "/u/ppl_shows", active: true });
    expect(refs[ids.banned!]!.active).toBe(false);
  });

  it("follows the member's profile and post-history settings", async () => {
    await prisma.userPrivacySettings.create({ data: { userId: ids.other!, settings: { profileVisibility: "members", postHistoryVisibility: "nobody" } } });
    expect(await canSee(null, ids.other!, "profile")).toBe(false);
    expect(await canSee(ids.viewer!, ids.other!, "profile")).toBe(true);
    expect(await canSee(ids.viewer!, ids.other!, "posts")).toBe(false);
    expect(await canSee(ids.other!, ids.other!, "posts")).toBe(true);
    await prisma.userPrivacySettings.delete({ where: { userId: ids.other! } });
  });
});

describe("site time", () => {
  it("finds midnight in the site's zone, across a daylight-saving change", () => {
    // Berlin moves to summer time on 29 March 2026: midnight is still UTC+1.
    expect(startOfDayIn("Europe/Berlin", new Date("2026-03-29T15:00:00Z")).toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(startOfDayIn("Europe/Berlin", new Date("2026-03-30T15:00:00Z")).toISOString()).toBe("2026-03-29T22:00:00.000Z");
    expect(startOfDayIn("UTC", new Date("2026-03-30T15:00:00Z")).toISOString()).toBe("2026-03-30T00:00:00.000Z");
  });

  it("names the calendar day in the site's zone", () => {
    expect(dayKeyIn("Asia/Tokyo", new Date("2026-03-30T20:00:00Z"))).toBe("2026-03-31");
    expect(dayKeyIn("America/New_York", new Date("2026-03-30T02:00:00Z"))).toBe("2026-03-29");
  });
});
