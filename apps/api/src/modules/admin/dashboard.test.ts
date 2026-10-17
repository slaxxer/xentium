/**
 * The dashboard overview: series line up with the day labels, "active members"
 * counts a person once per period however many days they came back, and
 * pending reports surface as attention.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { dashboardService } from "./dashboard.service.js";

const EMAIL = "dash-probe@example.test";
let userId: string;
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

beforeEach(async () => {
  assertDisposableDatabase();
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  userId = (await prisma.user.create({ data: { email: EMAIL, username: "dash_probe", passwordHash: "x" } })).id;
});

afterEach(async () => {
  await prisma.activityLog.deleteMany({ where: { userId } });
  await prisma.loginEvent.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });
});

describe("dashboard overview", () => {
  it("returns one value per day for each metric, in both periods", async () => {
    const o = await dashboardService.overview(7);
    expect(o.days).toHaveLength(7);
    for (const m of Object.values(o.metrics)) {
      expect(m.values).toHaveLength(7);
      expect(m.compare).toHaveLength(7);
    }
    expect(o.newest.users.some((u) => u.id === userId)).toBe(true);
    expect(o.setup.steps.map((s) => s.key)).toEqual(["admin", "siteName", "email", "categories", "article", "theme"]);
  });

  it("gives the home page the same checklist the dashboard shows", async () => {
    const [o, s] = await Promise.all([dashboardService.overview(7), dashboardService.setup()]);
    expect(s.steps).toEqual(o.setup.steps);
    expect(s.stage).toBe(o.stage);
  });

  it("counts an active member once per period, and once per day", async () => {
    const before = (await dashboardService.overview(7)).metrics.active;
    for (const d of [0, 1, 2]) {
      await prisma.activityLog.create({ data: { category: "page_visit", userId, path: "/", createdAt: daysAgo(d) } });
    }
    await prisma.loginEvent.create({ data: { userId, emailAttempted: EMAIL, success: true, createdAt: daysAgo(1) } });
    const after = (await dashboardService.overview(7)).metrics.active;
    expect(after.total - before.total).toBe(1);
    expect(sum(after.values) - sum(before.values)).toBe(3);
  });
});

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
