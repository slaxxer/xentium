/**
 * The grouped error log: one group per code + normalized message, a resolve
 * mark that a newer occurrence overrides, and rows written before group keys
 * existed filled in on read.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { errorGroupKey, normalizeErrorMessage } from "../../shared/errors/errorGroupKey.js";
import { errorLogService } from "./errorLog.service.js";

const CODE = "XEC-GRPTEST-4004";
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

async function row(message: string, minutes: number, extra: Record<string, unknown> = {}) {
  return prisma.errorLog.create({
    data: {
      code: CODE, message, severity: "warn", createdAt: minutesAgo(minutes),
      groupKey: errorGroupKey(CODE, message), method: "GET", url: "/api/probe", ...extra,
    },
  });
}

const mine = async (status: "open" | "resolved" | "all" = "all") =>
  (await errorLogService.listGroups({ domain: "GRPTEST", status, page: 1, pageSize: 25 })).items;

beforeEach(async () => {
  assertDisposableDatabase();
  await prisma.errorLog.deleteMany({ where: { code: CODE } });
});

afterEach(async () => {
  await prisma.errorLog.deleteMany({ where: { code: CODE } });
  await errorLogService.pruneOrphanGroups();
});

describe("error group keys", () => {
  it("masks ids and numbers but keeps quoted text", () => {
    expect(normalizeErrorMessage("User cm1x9k2p0000abcd1234efgh not found (42)"))
      .toBe("User <id> not found (<n>)");
    expect(errorGroupKey(CODE, "Cannot read properties of undefined (reading 'a')"))
      .not.toBe(errorGroupKey(CODE, "Cannot read properties of undefined (reading 'b')"));
    expect(errorGroupKey(CODE, "Article 12 missing")).toBe(errorGroupKey(CODE, "Article 977 missing"));
  });
});

describe("grouped error log", () => {
  it("folds rows that differ only by an id into one group", async () => {
    await row("Article 12 missing", 30, { userId: "u1" });
    await row("Article 977 missing", 10, { userId: "u2", url: "/api/other" });
    await row("Something else", 5);
    const groups = await mine();
    expect(groups).toHaveLength(2);
    const article = groups.find((g) => g.message.startsWith("Article"))!;
    expect(article).toMatchObject({ count: 2, userCount: 2, routeCount: 2, domain: "GRPTEST", message: "Article 977 missing" });
    expect(article.spark7d.reduce((a, b) => a + b, 0)).toBe(2);
    expect(groups[0]!.message).toBe("Something else"); // newest first
  });

  it("a resolved group re-opens on a newer occurrence", async () => {
    await row("Flaky thing", 20);
    const [g] = await mine();
    await errorLogService.setResolved(g!.key, true, undefined);
    expect(await mine("open")).toHaveLength(0);
    expect(await mine("resolved")).toHaveLength(1);

    await row("Flaky thing", 0);
    expect(await mine("open")).toHaveLength(1);
  });

  it("fills in keys and route for rows written before them", async () => {
    await prisma.errorLog.create({
      data: { code: CODE, message: "Old row 5", severity: "error", context: { url: "/api/legacy", method: "POST" } },
    });
    const [g] = await mine();
    expect(g).toMatchObject({ message: "Old row 5", topRoute: { method: "POST", url: "/api/legacy" } });
  });

  it("lists occurrences newest first, a page at a time", async () => {
    for (let i = 0; i < 3; i++) await row("Paged 1", 10 - i, { requestId: String(i) });
    const [g] = await mine();
    const first = await errorLogService.occurrences(g!.key, undefined, 2);
    expect(first.items.map((o) => o.requestId)).toEqual(["2", "1"]);
    expect(first.total).toBe(3);
    const rest = await errorLogService.occurrences(g!.key, first.nextCursor!, 2);
    expect(rest.items.map((o) => o.requestId)).toEqual(["0"]);
    expect(rest.nextCursor).toBeNull();
  });

  it("counts recent events into the current bucket", async () => {
    await row("Stats probe", 1);
    const s = await errorLogService.stats("24h", 0);
    expect(s.buckets).toHaveLength(24);
    expect(s.buckets[23]!.warn).toBeGreaterThanOrEqual(1);
    expect(s.domains).toContain("GRPTEST");
    const week = await errorLogService.stats("7d", -120);
    expect(week.buckets).toHaveLength(7);
    expect(week.buckets[6]!.warn).toBeGreaterThanOrEqual(1);
  });

  it("deletes a group and its resolve mark", async () => {
    await row("Gone 1", 3);
    const [g] = await mine();
    await errorLogService.setResolved(g!.key, true, undefined);
    expect(await errorLogService.deleteGroup(g!.key)).toEqual({ deleted: 1 });
    expect(await prisma.errorLogGroup.count({ where: { key: g!.key } })).toBe(0);
  });
});
