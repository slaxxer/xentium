/**
 * THE PLUGIN CONTRACT, run: the fixture plugin (`src/test/fixtures/plugin-contract`)
 * uses every registration and host service. It is installed and enabled through the
 * real engine, used as a plugin's clients would use it, then disabled — after which
 * nothing it registered may still act.
 *
 * If this fails after a change to core, a published plugin would have broken too.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import type { Express } from "express";

const { prisma } = await import("../../infrastructure/db.js");
const { assertDisposableDatabase } = await import("../../test/testDatabase.js");
const { createSession } = await import("../../modules/auth/auth.tokens.js");
const { __resetInstalledCache } = await import("../../shared/middleware/installGuard.js");
const { createApp } = await import("../../app/app.js");
const { disablePlugin, ensurePluginLoaded } = await import("../plugin-engine/plugin-engine.js");
const { pluginRegistry } = await import("../plugin-engine/plugin-registry.js");
const { acpPageRegistry } = await import("../plugin-engine/acp-page-registry.js");
const { searchRegistry } = await import("../search-registry/search-registry.js");
const { contentRegistry } = await import("../content-registry/content-registry.js");
const { _emitAndWait, contribute, validate } = await import("../events/events.js");
const { jobsFor, _resetPluginJobs } = await import("./jobs.js");
const { readSettings, publicSettings } = await import("./settings.js");

const ID = "plugin-contract";
const ENTRY = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../test/fixtures/plugin-contract/server.ts");
const probe = () => (globalThis as { __pluginContract?: { events: unknown[]; jobs: unknown[]; disabled: boolean } }).__pluginContract!;

let app: Express;
let installRowCreated = false;
let token = "";
let userId = "";

beforeAll(async () => {
  assertDisposableDatabase();
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS pc_notes`);
  await prisma.$executeRawUnsafe(`CREATE TABLE pc_notes (id text PRIMARY KEY, title text NOT NULL, author_id text NOT NULL, created_at timestamptz NOT NULL, updated_at timestamptz)`);
  const install = await prisma.install.findUnique({ where: { singleton: true } });
  if (!install?.completedAt) {
    installRowCreated = !install;
    await prisma.install.upsert({ where: { singleton: true }, update: { completedAt: new Date() }, create: { singleton: true, completedAt: new Date() } as never });
  }
  __resetInstalledCache();
  userId = (await prisma.user.create({ data: { email: "contract@example.test", username: "contract_member", passwordHash: "x" } })).id;
  token = (await createSession(userId, { ip: "127.0.0.1", userAgent: "test" })).accessToken;

  const manifest = {
    id: ID, name: "Contract fixture", version: "1.0.0", vendor: "Xentium", minXentiumVersion: "1.0.0",
    tablePrefix: "pc_", entrypoints: { server: ENTRY },
  };
  await prisma.installedPlugin.create({ data: {
    id: ID, name: manifest.name, vendor: manifest.vendor, installedVersion: "1.0.0",
    status: "enabled", packagePath: "/nonexistent.xtplugin", manifest,
  } });
  app = createApp();
});

afterAll(async () => {
  _resetPluginJobs();
  pluginRegistry.deregister(ID);
  await prisma.installedPlugin.deleteMany({ where: { id: ID } });
  await prisma.navItem.deleteMany({ where: { pluginId: ID } });
  await prisma.groupPermission.deleteMany({ where: { permission: { key: `${ID}.manage` } } });
  await prisma.permission.deleteMany({ where: { key: `${ID}.manage` } });
  await prisma.setting.deleteMany({ where: { key: `plugin.${ID}` } });
  await prisma.user.deleteMany({ where: { email: "contract@example.test" } });
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS pc_notes`);
  if (installRowCreated) await prisma.install.deleteMany({ where: { singleton: true } });
  __resetInstalledCache();
});

const p = (method: "get" | "post", route: string, auth = true) => {
  const r = request(app)[method](`/api/p/${ID}${route}`);
  return auth ? r.set("Authorization", `Bearer ${token}`) : r;
};

describe("the plugin contract", () => {
  it("enables through the real engine, with no load error", async () => {
    expect(await ensurePluginLoaded(ID)).toBe("enabled");
    expect(pluginRegistry.getLoadError(ID)).toBeUndefined();
  });

  it("serves its own routes, with the host's people, time and permission services", async () => {
    expect((await p("get", "/ping", false)).body).toEqual({ ok: true });
    const me = await p("get", "/whoami");
    expect(me.status).toBe(200);
    expect(me.body.refs[userId]).toMatchObject({ username: "contract_member", profileUrl: "/u/contract_member" });
    expect(me.body).toMatchObject({ canSeeSelf: true, mayManage: false });
    expect(me.body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await p("get", "/files")).body).toEqual({ count: 0 });
  });

  it("serves its resource, and its own events fire", async () => {
    const created = await p("post", "/notes").send({ title: "First" });
    expect(created.status).toBe(201);
    await new Promise((r) => setTimeout(r, 30));
    expect(probe().events).toContainEqual({ id: created.body.id });
    expect((await p("get", "/notes", false)).body.meta.total).toBe(1);
  });

  it("hears core's events and is asked by core's filters", async () => {
    await _emitAndWait("user.registered", { userId, method: "password" });
    expect(probe().events).toContainEqual({ userId, method: "password" });
    expect(await validate("registration.validate", { email: "x@y.z", username: "contract_forbidden", method: "password" }))
      .toMatchObject({ refuse: `${ID}:errors.forbidden`, pluginId: ID });
    expect(await contribute("profile.extra", { userId, viewerId: null })).toMatchObject({ [ID]: { seen: userId } });
  });

  it("has its settings, jobs, pages and registry entries in place", async () => {
    expect(await readSettings(ID)).toEqual({ greeting: "hello", limit: 3 });
    expect(await publicSettings(ID)).toEqual({ greeting: "hello" });
    await expect(jobsFor(ID).run("ping", { n: 1 })).resolves.toEqual(expect.any(String));
    const pages = acpPageRegistry.getAll().filter((x) => x.pluginId === ID).map((x) => x.path);
    expect(pages).toEqual(expect.arrayContaining(["/admin/contract", `/admin/addons/${ID}/settings`]));
    expect(searchRegistry.get(ID)?.label).toBe("Contract");
    expect(await contentRegistry.canView(`${ID}.note`, "visible", null)).toBe(true);
  });

  it("leaves nothing acting once disabled", async () => {
    await disablePlugin(ID);
    expect(probe().disabled).toBe(true);
    expect((await p("get", "/ping", false)).status).toBe(404);
    expect((await p("get", "/notes", false)).status).toBe(404);
    expect(await validate("registration.validate", { email: "x@y.z", username: "contract_forbidden", method: "password" })).toBeNull();
    expect(await contribute("profile.extra", { userId, viewerId: null })).toEqual({});
    const before = probe().events.length;
    await _emitAndWait("user.registered", { userId, method: "password" });
    expect(probe().events).toHaveLength(before);
    expect(acpPageRegistry.getAll().filter((x) => x.pluginId === ID)).toEqual([]);
    expect(searchRegistry.get(ID)).toBeUndefined();
    await expect(readSettings(ID)).rejects.toMatchObject({ httpStatus: 404 });
    expect(await contentRegistry.canView(`${ID}.note`, "visible", null)).toBe(false);
  });
});
