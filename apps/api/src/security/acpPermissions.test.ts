/**
 * What a permission names is what it guards in the admin panel.
 *
 * Until rc.1 `admin.access` alone opened these pages and eight permissions were
 * toggles that changed nothing. Each row below: a staff account WITHOUT the page's
 * own permission is refused (403), and WITH it gets past the permission check (any
 * answer but 401/403 — the handler may still 404 on the probe id). The plugin routes
 * also need `admin.access`, which is where the ACP's two-factor requirement lives.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

const { prisma } = await import("../infrastructure/db.js");
const { assertDisposableDatabase } = await import("../test/testDatabase.js");
const { createSession } = await import("../modules/auth/auth.tokens.js");
const { __resetInstalledCache } = await import("../shared/middleware/installGuard.js");
const { permissionCache } = await import("../modules/permissions/permission.cache.js");
const { createApp } = await import("../app/app.js");
const { CorePermissions: C } = await import("@xentium/contracts");

const P = "acpperm";
const meta = { ip: "127.0.0.1", userAgent: "test" };
const NOBODY = "00000000-0000-0000-0000-000000000000";
let app: Express;
let installRowCreated = false;

async function clean() {
  await prisma.user.deleteMany({ where: { email: { startsWith: P } } });
  await prisma.group.deleteMany({ where: { key: { startsWith: P } } });
}

/** A signed-in account holding exactly `keys`. */
async function staff(keys: string[]): Promise<string> {
  const n = Math.random().toString(36).slice(2, 8);
  const user = await prisma.user.create({ data: { email: `${P}_${n}@example.test`, username: `${P}_${n}`, passwordHash: "x" } });
  const group = await prisma.group.create({ data: { key: `${P}_${n}`, name: "Probe staff" } });
  for (const key of keys) {
    const perm = await prisma.permission.upsert({ where: { key }, update: {}, create: { key, label: key } });
    await prisma.groupPermission.create({ data: { groupId: group.id, permissionId: perm.id } });
  }
  await prisma.userGroup.create({ data: { userId: user.id, groupId: group.id } });
  await permissionCache.invalidate(user.id);
  return (await createSession(user.id, meta)).accessToken;
}

function call(method: "get" | "post" | "patch" | "put" | "delete", path: string, token: string) {
  return request(app)[method](path).set("Authorization", `Bearer ${token}`).send({});
}

beforeAll(async () => {
  assertDisposableDatabase();
  const install = await prisma.install.findUnique({ where: { singleton: true } });
  if (!install?.completedAt) {
    installRowCreated = !install;
    await prisma.install.upsert({
      where: { singleton: true }, update: { completedAt: new Date() },
      create: { singleton: true, completedAt: new Date() } as never,
    });
  }
  __resetInstalledCache();
  app = createApp();
});
afterAll(async () => {
  await clean();
  if (installRowCreated) await prisma.install.deleteMany({ where: { singleton: true } });
  __resetInstalledCache();
});
beforeEach(async () => {
  assertDisposableDatabase();
  await clean();
});

describe("ACP pages need their own permission, not only admin.access", () => {
  const ROWS: [string, "get" | "post" | "patch" | "put" | "delete", string, string[]][] = [
    ["user.manage",         "get",    `/api/admin/users/${NOBODY}`,               [C.ADMIN_ACCESS, C.USER_MANAGE]],
    ["user.manage",         "patch",  `/api/admin/users/${NOBODY}/active`,        [C.ADMIN_ACCESS, C.USER_MANAGE]],
    ["user.ban",            "post",   `/api/admin/users/${NOBODY}/ban`,           [C.ADMIN_ACCESS, C.USER_BAN]],
    ["moderation.settings", "get",    "/api/admin/mod-settings",                  [C.ADMIN_ACCESS, C.MODERATION_SETTINGS]],
    ["progression.manage",  "get",    "/api/admin/progression",                   [C.ADMIN_ACCESS, C.PROGRESSION_MANAGE]],
    ["plugin.enable",       "post",   "/api/plugins/no-such-plugin/disable",      [C.ADMIN_ACCESS, C.ADMIN_PLUGINS, C.PLUGIN_ENABLE]],
    ["plugin.install",      "delete", "/api/plugins/no-such-plugin",              [C.ADMIN_ACCESS, C.ADMIN_PLUGINS, C.PLUGIN_INSTALL]],
    ["article.revisions.restore", "post", "/api/articles/abcdefghijklmnopqrstuvwx/revisions/cjld2cjxh0000qzrmn831i7rn/restore", [C.ARTICLE_REVISIONS_RESTORE]],
  ];

  it.each(ROWS)("%s: %s %s", async (_name, method, path, keys) => {
    const without = await staff(keys.slice(0, -1));
    expect((await call(method, path, without)).status).toBe(403);
    const withIt = await staff(keys);
    expect([401, 403]).not.toContain((await call(method, path, withIt)).status);
  });

  it("plugin routes also need admin.access (where the ACP's 2FA requirement is checked)", async () => {
    const pluginsOnly = await staff([C.ADMIN_PLUGINS, C.PLUGIN_ENABLE, C.PLUGIN_INSTALL]);
    expect((await call("get", "/api/plugins", pluginsOnly)).status).toBe(403);
  });

  it("the group page's member list works with group.manage alone", async () => {
    const groups = await staff([C.ADMIN_ACCESS, C.GROUP_MANAGE]);
    expect((await call("get", "/api/admin/users?limit=1", groups)).status).toBe(200);
    expect((await call("get", `/api/admin/users/${NOBODY}`, groups)).status).toBe(403);
  });
});
