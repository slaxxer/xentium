/**
 * Navbar dropdowns: a link may sit under another (one level). The public list
 * carries them as `children` of their parent; deleting a parent moves its links
 * up to the bar; a plugin declares its dropdown with `registerNavItem({ children })`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

const { prisma } = await import("../../infrastructure/db.js");
const { assertDisposableDatabase } = await import("../../test/testDatabase.js");
const { __resetInstalledCache } = await import("../../shared/middleware/installGuard.js");
const { createApp } = await import("../../app/app.js");
const { adminService } = await import("./admin.service.js");
const { PluginContextImpl } = await import("../../core/plugin-engine/plugin-context.js");

const P = "navtree-";
let app: Express;
let installRowCreated = false;
const clean = () => prisma.navItem.deleteMany({ where: { OR: [{ label: { startsWith: P } }, { pluginId: "navtree-plugin" }] } });

beforeAll(async () => {
  assertDisposableDatabase();
  const install = await prisma.install.findUnique({ where: { singleton: true } });
  if (!install?.completedAt) {
    installRowCreated = !install;
    await prisma.install.upsert({ where: { singleton: true }, update: { completedAt: new Date() }, create: { singleton: true, completedAt: new Date() } as never });
  }
  __resetInstalledCache();
  app = createApp();
});
beforeEach(clean);
afterAll(async () => {
  await clean();
  if (installRowCreated) await prisma.install.deleteMany({ where: { singleton: true } });
  __resetInstalledCache();
});

const base = { url: "/x", openInNewTab: false, visibility: "public" };

describe("nav dropdowns", () => {
  it("nests a child under its parent in the public list", async () => {
    const store = await adminService.createNavItem({ ...base, label: `${P}Store`, url: "/store" });
    await adminService.createNavItem({ ...base, label: `${P}Plugins`, url: "/store/plugins", parentId: store.id });
    await adminService.createNavItem({ ...base, label: `${P}Themes`, url: "/store/themes", parentId: store.id });
    const res = await request(app).get("/api/nav-items").expect(200);
    const mine = res.body.filter((i: { label: string }) => i.label.startsWith(P));
    expect(mine.map((i: { label: string }) => i.label)).toEqual([`${P}Store`]);
    expect(mine[0].children.map((c: { label: string }) => c.label)).toEqual([`${P}Plugins`, `${P}Themes`]);
  });

  it("is one level deep, and never under itself", async () => {
    const a = await adminService.createNavItem({ ...base, label: `${P}A` });
    const b = await adminService.createNavItem({ ...base, label: `${P}B`, parentId: a.id });
    await expect(adminService.createNavItem({ ...base, label: `${P}C`, parentId: b.id })).rejects.toThrow(/one level/);
    await expect(adminService.updateNavItem(a.id, { parentId: a.id })).rejects.toThrow(/itself/);
    const c = await adminService.createNavItem({ ...base, label: `${P}D` });
    await expect(adminService.updateNavItem(a.id, { parentId: c.id })).rejects.toThrow(/stays in the bar/);
  });

  it("moves a deleted parent's links up to the bar", async () => {
    const a = await adminService.createNavItem({ ...base, label: `${P}Parent` });
    const b = await adminService.createNavItem({ ...base, label: `${P}Child`, parentId: a.id });
    await adminService.deleteNavItem(a.id);
    expect((await prisma.navItem.findUniqueOrThrow({ where: { id: b.id } })).parentId).toBeNull();
  });

  it("creates a plugin's dropdown once, and keeps it on the next enable", async () => {
    const ctx = new PluginContextImpl("navtree-plugin");
    const decl = { label: "Store", url: "/store", children: [{ label: "Plugins", url: "/store/plugins" }, { label: "Themes", url: "/store/themes" }] };
    await ctx.registerNavItem(decl);
    await ctx.registerNavItem(decl);
    const rows = await prisma.navItem.findMany({ where: { pluginId: "navtree-plugin" }, orderBy: { position: "asc" } });
    const parent = rows.find((r) => !r.parentId)!;
    expect(rows.filter((r) => r.parentId === parent.id).map((r) => r.label)).toEqual(["Plugins", "Themes"]);
    expect(rows).toHaveLength(3);
  });
});
