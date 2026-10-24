/**
 * Resources through HTTP, as a plugin's client would use them: a real table, two
 * members, a manager and guests. Core must check the declaration against the
 * table, refuse what the rules refuse, and never let a value reach SQL as code.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { z } from "zod";

const { prisma } = await import("../../infrastructure/db.js");
const { assertDisposableDatabase } = await import("../../test/testDatabase.js");
const { createSession } = await import("../../modules/auth/auth.tokens.js");
const { permissionCache } = await import("../../modules/permissions/permission.cache.js");
const { __resetInstalledCache } = await import("../../shared/middleware/installGuard.js");
const { pluginRegistry } = await import("../plugin-engine/plugin-registry.js");
const { pluginRouter } = await import("../plugin-engine/plugin-router.js");
const { createApp } = await import("../../app/app.js");
const { registerResource, _resetResources } = await import("./resources.js");
const { _resetEvents, addListener } = await import("../events/events.js");

const P = "rtest";
const T = "rtest_notes";
let app: Express;
let installRowCreated = false;
const tok: Record<string, string> = {};
const uid: Record<string, string> = {};

const schema = z.object({
  title: z.string().min(1).max(100),
  body: z.string().max(2000).default(""),
  pinned: z.boolean().default(false),
  dueAt: z.coerce.date().nullable().default(null),
});
const decl = {
  name: "notes", table: T, schema, owner: "author_id", softDelete: true,
  access: { read: "public", create: "members", update: "own", delete: "own", manage: `${P}.manage` },
  sort: ["title"], filter: ["pinned"], search: ["title", "body"],
} as const;

beforeAll(async () => {
  assertDisposableDatabase();
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${T}`);
  await prisma.$executeRawUnsafe(`CREATE TABLE ${T} (id text PRIMARY KEY, title text NOT NULL, body text NOT NULL, pinned boolean NOT NULL,
    due_at timestamptz, author_id text NOT NULL, created_at timestamptz NOT NULL, updated_at timestamptz, deleted_at timestamptz)`);
  const install = await prisma.install.findUnique({ where: { singleton: true } });
  if (!install?.completedAt) {
    installRowCreated = !install;
    await prisma.install.upsert({ where: { singleton: true }, update: { completedAt: new Date() }, create: { singleton: true, completedAt: new Date() } as never });
  }
  __resetInstalledCache();

  for (const s of ["a", "b", "mod"]) {
    uid[s] = (await prisma.user.create({ data: { email: `${P}_${s}@example.test`, username: `${P}_${s}`, passwordHash: "x" } })).id;
    tok[s] = (await createSession(uid[s]!, { ip: "127.0.0.1", userAgent: "test" })).accessToken;
  }
  const perm = await prisma.permission.upsert({ where: { key: `${P}.manage` }, update: {}, create: { key: `${P}.manage`, label: "manage" } });
  const group = await prisma.group.create({ data: { key: `${P}_mods`, name: "rtest mods" } });
  await prisma.groupPermission.create({ data: { groupId: group.id, permissionId: perm.id } });
  await prisma.userGroup.create({ data: { userId: uid.mod!, groupId: group.id } });
  await permissionCache.invalidate(uid.mod!);

  pluginRegistry.register({ id: P, name: "Resource test", version: "1.0.0", tablePrefix: "rtest_" } as never, "enabled");
  app = createApp();
});

afterAll(async () => {
  _resetResources(); _resetEvents();
  pluginRouter.deregister(P); pluginRegistry.deregister(P);
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${T}`);
  await prisma.userGroup.deleteMany({ where: { group: { key: `${P}_mods` } } });
  await prisma.group.deleteMany({ where: { key: `${P}_mods` } });
  await prisma.permission.deleteMany({ where: { key: `${P}.manage` } });
  await prisma.user.deleteMany({ where: { email: { startsWith: `${P}_` } } });
  if (installRowCreated) await prisma.install.deleteMany({ where: { singleton: true } });
  __resetInstalledCache();
});

const as = (who: string | null, method: "get" | "post" | "patch" | "delete", path: string) => {
  const r = request(app)[method](`/api/p/${P}${path}`);
  return who ? r.set("Authorization", `Bearer ${tok[who]}`) : r;
};

describe("declaring a resource", () => {
  it("refuses a table without the plugin's prefix, a missing column, and public writes", async () => {
    await expect(registerResource(P, "rtest_", { ...decl, table: "xcf_users" } as never)).rejects.toThrow(/prefix/);
    await expect(registerResource(P, "rtest_", { ...decl, schema: z.object({ colour: z.string().default("") }) } as never)).rejects.toThrow(/colour/);
    await expect(registerResource(P, "rtest_", { ...decl, access: { ...decl.access, create: "public" } } as never)).rejects.toThrow(/public/);
    await expect(registerResource(P, undefined, decl as never)).rejects.toThrow(/tablePrefix/);
  });

  it("accepts a declaration that fits the table", async () => {
    await registerResource(P, "rtest_", decl as never);
  });
});

describe("the endpoints", () => {
  let noteId = "";

  it("lets a member create, as the owner, and refuses unknown or invalid fields", async () => {
    const events: unknown[] = [];
    addListener("probe", `${P}.notes.created`, (p) => { events.push(p); });
    const r = await as("a", "post", "/notes").send({ title: "Hello", body: "first note", dueAt: "2026-11-01T10:00:00Z" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ title: "Hello", body: "first note", pinned: false, ownerId: uid.a });
    expect(new Date(r.body.dueAt).toISOString()).toBe("2026-11-01T10:00:00.000Z");
    noteId = r.body.id;
    await new Promise((s) => setTimeout(s, 20));
    expect(events).toEqual([{ id: noteId, userId: uid.a }]);

    expect((await as("a", "post", "/notes").send({ title: "x", admin: true })).status).toBe(422);
    expect((await as("a", "post", "/notes").send({ title: "" })).status).toBe(422);
    expect((await as(null, "post", "/notes").send({ title: "guest" })).status).toBe(401);
  });

  it("lists for guests with paging, sorting, filtering and search", async () => {
    await as("b", "post", "/notes").send({ title: "Alpha", pinned: true, body: "needle here" });
    await as("b", "post", "/notes").send({ title: "Zulu" });
    const all = await as(null, "get", "/notes?sort=title&limit=2");
    expect(all.status).toBe(200);
    expect(all.body.data.map((n: { title: string }) => n.title)).toEqual(["Alpha", "Hello"]);
    expect(all.body.meta).toMatchObject({ total: 3, page: 1, limit: 2 });
    expect((await as(null, "get", "/notes?pinned=true")).body.data.map((n: { title: string }) => n.title)).toEqual(["Alpha"]);
    expect((await as(null, "get", "/notes?q=needle")).body.data.map((n: { title: string }) => n.title)).toEqual(["Alpha"]);
    expect((await as(null, "get", `/notes/${noteId}`)).body.title).toBe("Hello");
  });

  it("never lets a query reach SQL as code", async () => {
    expect((await as(null, "get", '/notes?sort=title;DROP TABLE rtest_notes')).status).toBe(400);
    expect((await as(null, "get", "/notes?pinned=' OR 1=1 --")).body.data).toEqual([]);
    expect((await as(null, "get", "/notes?q=%25' OR '1'='1")).body.data).toEqual([]);
    expect((await as(null, "get", "/notes")).body.meta.total).toBe(3);
  });

  it("lets only the owner (or a manager) change or delete a row", async () => {
    expect((await as("b", "patch", `/notes/${noteId}`).send({ title: "hacked" })).status).toBe(403);
    const ok = await as("a", "patch", `/notes/${noteId}`).send({ title: "Hello again" });
    expect(ok.status).toBe(200);
    expect(ok.body.title).toBe("Hello again");
    expect(ok.body.body).toBe("first note");
    expect((await as("mod", "patch", `/notes/${noteId}`).send({ pinned: true })).status).toBe(200);
    expect((await as("b", "delete", `/notes/${noteId}`)).status).toBe(403);
  });

  it("soft-deletes, hides the row, and lets a manager see and restore it", async () => {
    expect((await as("a", "delete", `/notes/${noteId}`)).status).toBe(204);
    expect((await as(null, "get", `/notes/${noteId}`)).status).toBe(404);
    expect((await as(null, "get", "/notes")).body.meta.total).toBe(2);
    const withDeleted = await as("mod", "get", "/notes?deleted=1");
    expect(withDeleted.body.meta.total).toBe(3);
    expect((await as("a", "post", `/notes/${noteId}/restore`)).status).toBe(403);
    const back = await as("mod", "post", `/notes/${noteId}/restore`);
    expect(back.status).toBe(200);
    expect(back.body.deletedAt).toBeNull();
    expect((await as(null, "get", "/notes")).body.meta.total).toBe(3);
  });

  it("answers 404 for a resource that is not declared, leaving the path to the plugin", async () => {
    expect((await as(null, "get", "/nothing")).status).toBe(404);
  });
});
