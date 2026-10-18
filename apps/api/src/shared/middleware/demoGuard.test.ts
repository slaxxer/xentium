/**
 * Demo mode refuses what the nightly reset cannot undo (code, mail, the shared
 * account, lock-outs) and lets everything else through.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "../../config/env.js";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { demoGuard } from "./demoGuard.js";

async function run(method: string, path: string, on = true) {
  const before = env.DEMO_MODE;
  (env as { DEMO_MODE: boolean }).DEMO_MODE = on;
  let status = 0, passed = false;
  const res = { status(s: number) { status = s; return this; }, json() { return this; } };
  await demoGuard({ method, path } as never, res as never, (() => { passed = true; }) as never);
  (env as { DEMO_MODE: boolean }).DEMO_MODE = before;
  return passed ? "next" : status;
}

let adminGroup = "", otherGroup = "";
beforeAll(async () => {
  assertDisposableDatabase();
  adminGroup = (await prisma.group.findUnique({ where: { key: "admin" } })
    ?? await prisma.group.create({ data: { key: "admin", name: "Administrator", isSystem: true } })).id;
  otherGroup = (await prisma.group.create({ data: { key: "demoprobe_g", name: "Probe" } })).id;
});
afterAll(async () => { await prisma.group.deleteMany({ where: { key: "demoprobe_g" } }); });

describe("demo mode", () => {
  it("does nothing when it is off", async () => {
    expect(await run("POST", "/api/plugins/upload", false)).toBe("next");
  });

  it.each([
    ["POST", "/api/account/password"], ["POST", "/api/account/email"], ["PATCH", "/api/account/username"],
    ["POST", "/api/account/pin"], ["DELETE", "/api/account/sessions/abc"],
    ["POST", "/api/auth/password-reset"], ["POST", "/api/auth/password-reset/confirm"],
    ["POST", "/api/auth/passkey/register/options"], ["DELETE", "/api/auth/passkeys/x"],
    ["POST", "/api/auth/oauth/github/link"], ["DELETE", "/api/auth/oauth/github"],
    ["POST", "/api/admin/users/u1/password-reset"],
    ["POST", "/api/plugins/upload"], ["POST", "/api/plugins/xentium-forum/disable"], ["DELETE", "/api/plugins/xentium-forum"],
    ["POST", "/api/admin/marketplace/install"], ["DELETE", "/api/admin/license"],
    ["POST", "/api/admin/email/test"], ["PUT", "/api/admin/email/templates/welcome"], ["POST", "/api/admin/invites"],
    ["PATCH", "/api/admin/auth-providers/github"], ["PUT", "/api/admin/jobs/purge"],
    ["PUT", "/api/admin/settings/smtp.host"], ["PUT", "/api/admin/settings/maintenance.enabled"],
    ["PUT", "/api/admin/settings/auth.allow_registration"], ["PUT", "/api/admin/settings/site.url"],
  ])("refuses %s %s", async (method, path) => {
    expect(await run(method, path)).toBe(403);
  });

  it("refuses changing the administrator group's permissions, but not another group's", async () => {
    expect(await run("PATCH", `/api/admin/groups/${adminGroup}/permissions`)).toBe(403);
    expect(await run("PATCH", `/api/admin/groups/${otherGroup}/permissions`)).toBe("next");
  });

  it.each([
    ["GET", "/api/plugins"], ["GET", "/api/account/sessions"], ["POST", "/api/articles"],
    ["PUT", "/api/admin/settings/site.name"], ["PATCH", "/api/admin/users/u1/groups"],
    ["POST", "/api/admin/users/u1/ban"], ["POST", "/api/auth/login"], ["POST", "/api/admin/jobs/purge/run"],
  ])("lets %s %s through", async (method, path) => {
    expect(await run(method, path)).toBe("next");
  });
});
