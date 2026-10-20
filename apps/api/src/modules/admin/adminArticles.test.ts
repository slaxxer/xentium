/**
 * The ACP Articles page against the real test database: the list narrows by
 * status (Hidden is any status with hiddenAt), category ("none" = uncategorised)
 * and search over title and author; the summary counts what the tiles show; and
 * each bulk action asks for the permission its single-article route asks for.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CorePermissions } from "@xentium/contracts";

const { prisma } = await import("../../infrastructure/db.js");
const { assertDisposableDatabase } = await import("../../test/testDatabase.js");
const { adminService } = await import("./admin.service.js");
const { permissionCache } = await import("../permissions/permission.cache.js");

const P = "aatest";
let staff = "", nobody = "", cat = "", ids: Record<string, string> = {};

async function clean() {
  await prisma.moderationLog.deleteMany({ where: { targetId: { in: Object.values(ids) } } });
  await prisma.article.deleteMany({ where: { slug: { startsWith: P } } });
  await prisma.articleCategory.deleteMany({ where: { slug: { startsWith: P } } });
  await prisma.group.deleteMany({ where: { key: `${P}_staff` } });
  await prisma.user.deleteMany({ where: { email: { startsWith: P } } });
}

beforeEach(async () => {
  assertDisposableDatabase();
  await clean();
  const user = async (s: string) =>
    (await prisma.user.create({ data: { email: `${P}_${s}@example.test`, username: `${P}_${s}`, passwordHash: "x" } })).id;
  staff = await user("staff"); nobody = await user("nobody");
  const keys = [CorePermissions.ARTICLE_EDIT_ANY, CorePermissions.ARTICLE_HIDE, CorePermissions.ARTICLE_DELETE_ANY];
  const perms = await Promise.all(keys.map((key) => prisma.permission.upsert({ where: { key }, update: {}, create: { key, label: key } })));
  const group = await prisma.group.create({ data: { key: `${P}_staff`, name: "Articles probe" } });
  await prisma.groupPermission.createMany({ data: perms.map((p) => ({ groupId: group.id, permissionId: p.id })) });
  await prisma.userGroup.create({ data: { userId: staff, groupId: group.id } });
  await permissionCache.invalidate(staff);
  cat = (await prisma.articleCategory.create({ data: { name: "Probe", slug: `${P}-cat` } })).id;
  const art = (slug: string, data: Record<string, unknown>) => prisma.article.create({
    data: { authorId: staff, title: slug, slug: `${P}-${slug}`, body: { type: "doc", content: [] }, ...data },
  });
  ids = {
    pub: (await art("pub", { status: "published", publishedAt: new Date(), categoryId: cat, viewCount: 7 })).id,
    hid: (await art("hid", { status: "published", publishedAt: new Date(), hiddenAt: new Date(), viewCount: 3 })).id,
    rev: (await art("rev", { status: "review", categoryId: cat })).id,
    dra: (await art("dra", { status: "draft" })).id,
  };
});
afterEach(clean);

const list = (q: Record<string, unknown>) =>
  adminService.listArticles({ page: 1, limit: 100, q: P, ...q }).then((r) => r.data.map((a) => a.title).sort());

describe("list", () => {
  it("narrows by status, with Hidden across statuses", async () => {
    expect(await list({})).toEqual(["dra", "hid", "pub", "rev"]);
    expect(await list({ status: "published" })).toEqual(["hid", "pub"]);
    expect(await list({ status: "hidden" })).toEqual(["hid"]);
    expect(await list({ status: "review" })).toEqual(["rev"]);
  });

  it("narrows by category, and none means uncategorised", async () => {
    expect(await list({ category: cat })).toEqual(["pub", "rev"]);
    expect(await list({ category: "none" })).toEqual(["dra", "hid"]);
  });

  it("finds by the author's name too, and carries the flags", async () => {
    const r = await adminService.listArticles({ page: 1, limit: 100, q: `${P}_staff`, sort: "read" });
    expect(r.data.map((a) => a.title).slice(0, 2)).toEqual(["pub", "hid"]);
    expect(r.data.find((a) => a.title === "hid")).toMatchObject({ hidden: true, pinned: false, commentsClosed: false });
  });
});

describe("summary", () => {
  it("counts statuses, hidden, reads and each category", async () => {
    const s = await adminService.articleSummary();
    expect(s.byCategory[cat]).toBe(2);
    expect(s.hidden).toBeGreaterThanOrEqual(1);
    expect(s.review).toBeGreaterThanOrEqual(1);
    expect(s.reads).toBeGreaterThanOrEqual(10);
  });
});

describe("bulk", () => {
  it("refuses a member without the permission", async () => {
    await expect(adminService.bulkArticles(nobody, { ids: [ids.pub!], action: "delete" })).rejects.toMatchObject({ httpStatus: 403 });
    expect(await list({})).toContain("pub");
  });

  it("moves, hides and deletes, logging the hides", async () => {
    await adminService.bulkArticles(staff, { ids: [ids.pub!, ids.dra!], action: "move", categoryId: null });
    expect(await list({ category: "none" })).toEqual(["dra", "hid", "pub"]);

    expect(await adminService.bulkArticles(staff, { ids: [ids.pub!, ids.rev!], action: "hide" })).toEqual({ done: 2 });
    expect(await list({ status: "hidden" })).toEqual(["hid", "pub", "rev"]);
    expect(await prisma.moderationLog.count({ where: { targetId: ids.pub!, action: "article.hidden" } })).toBe(1);

    await adminService.bulkArticles(staff, { ids: [ids.dra!, ids.dra!], action: "delete" });
    expect(await list({})).toEqual(["hid", "pub", "rev"]);
    expect((await prisma.article.findUnique({ where: { id: ids.dra! } }))?.deletedById).toBe(staff);
  });

  it("refuses a category that does not exist", async () => {
    await expect(adminService.bulkArticles(staff, { ids: [ids.pub!], action: "move", categoryId: "nope" })).rejects.toMatchObject({ httpStatus: 404 });
  });
});
