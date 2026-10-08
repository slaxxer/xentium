/**
 * The Activity Log list: filters narrow the rows but the tab counts stay across both
 * kinds, user and group ids in paths come back named, and a failed action keeps why.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { activityService } from "./activity.service.js";

const PREFIX = "actprobe";
let admin = "", target = "", group = "";

async function cleanup() {
  await prisma.activityLog.deleteMany({ where: { username: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: `${PREFIX}_` } } });
  await prisma.group.deleteMany({ where: { key: `${PREFIX}_mods` } });
}

beforeEach(async () => {
  assertDisposableDatabase();
  await cleanup();
  const mk = (n: string) => prisma.user.create({ data: { username: `${PREFIX}_${n}`, email: `${PREFIX}_${n}@example.test`, passwordHash: "x" } });
  admin = (await mk("admin")).id;
  target = (await mk("spam")).id;
  group = (await prisma.group.create({ data: { name: "Probe Mods", key: `${PREFIX}_mods`, isSystem: false } })).id;
  const base = { userId: admin, username: `${PREFIX}_admin`, ip: "10.0.0.9" };
  await prisma.activityLog.createMany({ data: [
    { ...base, category: "page_visit", path: "/admin/users", createdAt: new Date(Date.now() - 3 * 86400e3) },
    { ...base, category: "acp_action", method: "POST", path: `/api/admin/users/${target}/ban`, status: 200 },
    { ...base, category: "acp_action", method: "PATCH", path: `/api/admin/groups/${group}/permissions`, status: 200 },
    { ...base, category: "acp_action", method: "POST", path: "/api/admin/email/test", status: 500,
      meta: { error: { code: "XEC-EMAIL-5001", message: "SMTP connection refused" } } },
  ] });
});

afterEach(cleanup);

const list = (f: Parameters<typeof activityService.list>[0] extends infer T ? Partial<T> : never) =>
  activityService.list({ page: 1, limit: 50, userId: admin, ...f });

describe("the activity list", () => {
  it("counts both tabs under the same filters, whichever tab is open", async () => {
    const r = await list({ category: "acp_action" });
    expect(r.data).toHaveLength(3);
    expect(r.counts).toEqual({ all: 4, page_visit: 1, acp_action: 3 });
  });

  it("filters by result, method, date, IP and text", async () => {
    expect((await list({ result: "err" })).data.map((d) => d.path)).toEqual(["/api/admin/email/test"]);
    expect((await list({ result: "ok" })).data).toHaveLength(2);
    expect((await list({ methods: ["PATCH"] })).data).toHaveLength(1);
    expect((await list({ since: new Date(Date.now() - 86400e3) })).data).toHaveLength(3);
    expect((await list({ ip: "10.0.0.1" })).data).toHaveLength(0);
    expect((await list({ q: "EMAIL" })).data).toHaveLength(1);
  });

  it("names the users and groups an action was about", async () => {
    const r = await list({});
    expect(r.targets[target]).toBe(`@${PREFIX}_spam`);
    expect(r.targets[group]).toBe("Probe Mods");
    expect(r.actors[admin]?.username).toBe(`${PREFIX}_admin`);
  });

  it("returns why a failed action failed", async () => {
    const [row] = (await list({ result: "err" })).data;
    expect(row?.error).toEqual({ code: "XEC-EMAIL-5001", message: "SMTP connection refused" });
  });
});
