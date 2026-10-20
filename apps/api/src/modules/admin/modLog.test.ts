/**
 * The Moderation Log's reading side against the real test database.
 *
 * What must hold: actions group into the five kinds by prefix (a "ban all" on a
 * case is a ban); every filter narrows, and the chip counts ignore only the kind;
 * targets come back named; and the CSV quotes every cell and defuses formulas.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { prisma } = await import("../../infrastructure/db.js");
const { assertDisposableDatabase } = await import("../../test/testDatabase.js");
const { modLogService, kindOf, csvCell } = await import("./modLog.service.js");

const TAG = "mltest";
let mod: { id: string };
let member: { id: string };

async function cleanup() {
  await prisma.moderationLog.deleteMany({ where: { reason: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: "@mltest.example" } } });
}

beforeEach(async () => {
  assertDisposableDatabase();
  await cleanup();
  mod = await prisma.user.create({ data: { email: "mod@mltest.example", username: "mltest_mod", passwordHash: "x" } });
  member = await prisma.user.create({ data: { email: "m@mltest.example", username: "mltest_member", passwordHash: "x" } });
  const old = new Date(Date.now() - 10 * 24 * 60 * 60_000);
  await prisma.moderationLog.createMany({
    data: [
      { actorId: mod.id, actorType: "user", action: "ban.issued", targetType: "user", targetId: member.id, reason: `${TAG} spam links` },
      { actorId: mod.id, actorType: "user", action: "warning.issued", targetType: "user", targetId: member.id, reason: `${TAG} off-topic` },
      { actorId: null, actorType: "system", action: "case.assigned", targetType: "moderation_case", targetId: "nope", reason: `${TAG} auto` },
      { actorId: mod.id, actorType: "user", action: "user.account_edited", targetType: "user", targetId: member.id, reason: `${TAG} Username a → b`, createdAt: old },
      { actorId: mod.id, actorType: "user", action: "case.ban_all", targetType: "moderation_case", targetId: "nope", reason: `${TAG} =HYPERLINK("x")` },
    ],
  });
});
afterEach(cleanup);

const mine = { q: TAG };

describe("kinds", () => {
  it("groups actions by prefix, with a case's ban-all under Bans", () => {
    expect(kindOf("ban.lifted")).toBe("ban");
    expect(kindOf("case.ban_all")).toBe("ban");
    expect(kindOf("case.assigned")).toBe("case");
    expect(kindOf("report.resolved")).toBe("case");
    expect(kindOf("user.account_edited")).toBe("account");
    expect(kindOf("article.comments_closed")).toBe("content");
    expect(kindOf("profile_comment.deleted")).toBe("content");
    expect(kindOf("warning.pardoned")).toBe("warning");
    expect(kindOf("plugin.enabled")).toBe("other");
  });
});

describe("filters", () => {
  it("narrows by kind, and counts every kind under the other filters", async () => {
    const bans = await modLogService.list({ ...mine, kind: "ban", page: 1, limit: 50 });
    expect(bans.data.map((r) => r.action).sort()).toEqual(["ban.issued", "case.ban_all"]);
    const cases = await modLogService.list({ ...mine, kind: "case", page: 1, limit: 50 });
    expect(cases.data.map((r) => r.action)).toEqual(["case.assigned"]);
    const counts = await modLogService.kindCounts({ ...mine, kind: "ban" });
    expect(counts).toMatchObject({ all: 5, ban: 2, warning: 1, case: 1, account: 1, content: 0 });
  });

  it("narrows by who did it", async () => {
    const auto = await modLogService.list({ ...mine, actor: "system", page: 1, limit: 50 });
    expect(auto.data.map((r) => r.action)).toEqual(["case.assigned"]);
    const staff = await modLogService.list({ ...mine, actor: "staff", page: 1, limit: 50 });
    expect(staff.meta.total).toBe(4);
    const one = await modLogService.list({ ...mine, actor: mod.id, page: 1, limit: 50 });
    expect(one.meta.total).toBe(4);
  });

  it("narrows by period", async () => {
    const week = await modLogService.list({ ...mine, since: new Date(Date.now() - 7 * 24 * 60 * 60_000), page: 1, limit: 50 });
    expect(week.data.map((r) => r.action)).not.toContain("user.account_edited");
    expect(week.meta.total).toBe(4);
  });

  it("finds a member by name, and words in the reason", async () => {
    const byName = await modLogService.list({ q: "mltest_member", page: 1, limit: 50 });
    expect(byName.meta.total).toBe(3); // the three entries that target them
    const byReason = await modLogService.list({ q: "spam links", page: 1, limit: 50 });
    expect(byReason.data.map((r) => r.action)).toEqual(["ban.issued"]);
  });
});

describe("rows", () => {
  it("names actors and member targets, and marks automatic entries", async () => {
    const { data } = await modLogService.list({ ...mine, page: 1, limit: 50 });
    const ban = data.find((r) => r.action === "ban.issued")!;
    expect(ban.actor).toMatchObject({ type: "user", username: "mltest_mod" });
    expect(ban.target).toMatchObject({ kind: "user", label: "mltest_member", href: `/admin/users/${member.id}` });
    expect(ban.kind).toBe("ban");
    expect(data.find((r) => r.action === "case.assigned")!.actor.type).toBe("system");
  });

  it("exports CSV with every cell quoted and formulas defused", async () => {
    const csv = await modLogService.csv(mine);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe('"time","kind","action","actor","target","target detail","reason"');
    expect(lines).toHaveLength(6);
    expect(csv).toContain(`"${TAG} =HYPERLINK(""x"")"`);
  });

  it("defuses a cell that would run as a spreadsheet formula", () => {
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(csvCell("+1")).toBe(`"'+1"`);
    expect(csvCell("@SUM(A1)")).toBe(`"'@SUM(A1)"`);
    expect(csvCell("plain, with comma")).toBe(`"plain, with comma"`);
    expect(csvCell(null)).toBe(`""`);
  });
});
