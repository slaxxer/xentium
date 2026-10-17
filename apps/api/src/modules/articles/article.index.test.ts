/**
 * The redesigned article index: search, tag, period, length and sort filters, the
 * pinned (featured) article left out of the grid, trending, and category counts.
 * Real service, disposable test database.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { articleService } from "./article.service.js";
import { articleCategoryService } from "../article-categories/article-category.service.js";

const P = "aidx_probe";
let author = "", cat = "", tag = "";
const ids: Record<string, string> = {};
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

async function clean() {
  await prisma.article.deleteMany({ where: { slug: { startsWith: P } } });
  await prisma.tag.deleteMany({ where: { slug: { startsWith: P } } });
  await prisma.articleCategory.deleteMany({ where: { slug: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: P } } });
}

async function article(key: string, d: { readTime?: number; likes?: number; comments?: number; age?: number; tagged?: boolean; visibility?: string }) {
  const a = await prisma.article.create({
    data: {
      authorId: author, categoryId: cat, title: `${P} ${key}`, slug: `${P}-${key}`, excerpt: `about ${key}`,
      body: { type: "doc", content: [] }, status: "published", publishedAt: daysAgo(d.age ?? 1),
      visibility: d.visibility ?? "public", readTime: d.readTime ?? 3,
      likeCount: d.likes ?? 0, commentCount: d.comments ?? 0,
      ...(d.tagged ? { tags: { create: [{ tagId: tag }] } } : {}),
    },
  });
  ids[key] = a.id;
}

const titles = async (q: Record<string, unknown>, viewer?: string) =>
  (await articleService.list({ page: 1, limit: 50, q: P, ...q } as never, viewer)).data.map((a) => a.title.replace(`${P} `, ""));

beforeEach(async () => {
  assertDisposableDatabase();
  await clean();
  author = (await prisma.user.create({ data: { email: `${P}@example.test`, username: `${P}_author`, passwordHash: "x" } })).id;
  cat = (await prisma.articleCategory.create({ data: { name: "Probe", slug: `${P}-cat` } })).id;
  tag = (await prisma.tag.create({ data: { name: `${P}tag`, slug: `${P}-tag` } })).id;
  await article("short-new", { readTime: 2, likes: 1, age: 1, tagged: true });
  await article("medium-old", { readTime: 7, likes: 9, comments: 0, age: 20 });
  await article("long-older", { readTime: 15, likes: 2, comments: 6, age: 200 });
  await article("members", { readTime: 3, visibility: "members", age: 2 });
});
afterEach(clean);

describe("article index filters", () => {
  it("searches title and excerpt, and narrows by tag", async () => {
    expect(await titles({ q: "medium-old" })).toEqual(["medium-old"]);
    expect(await titles({ tag: `${P}-tag` })).toEqual(["short-new"]);
  });

  it("filters by period and reading length", async () => {
    expect((await titles({ period: "week" })).sort()).toEqual(["short-new"]);
    expect((await titles({ period: "month" })).sort()).toEqual(["medium-old", "short-new"]);
    expect(await titles({ length: "short" })).toEqual(["short-new"]);
    expect(await titles({ length: "medium" })).toEqual(["medium-old"]);
    expect(await titles({ length: "long" })).toEqual(["long-older"]);
  });

  it("sorts by likes or comments, and can leave one article out", async () => {
    expect((await titles({ sort: "popular" }))[0]).toBe("medium-old");
    expect((await titles({ sort: "discussed" }))[0]).toBe("long-older");
    expect(await titles({ exclude: ids["short-new"] })).not.toContain("short-new");
  });

  it("keeps a members-only article from guests", async () => {
    expect(await titles({})).not.toContain("members");
    expect(await titles({}, author)).toContain("members");
  });
});

describe("featured, trending and counts", () => {
  it("features the most recently pinned article the viewer may see", async () => {
    expect(await articleService.featured(undefined)).toBeNull();
    await articleService.setPinned(ids["medium-old"]!, true);
    await articleService.setPinned(ids["members"]!, true);
    expect((await articleService.featured(undefined))?.slug).toBe(`${P}-medium-old`);
    expect((await articleService.featured(author))?.slug).toBe(`${P}-members`);
    await articleService.setPinned(ids["members"]!, false);
    expect((await articleService.featured(author))?.pinned).toBe(true);
  });

  it("ranks trending by likes + comments × 2 within the window", async () => {
    const top = await articleService.trending(undefined, 30, 5);
    expect(top.map((t) => t.slug)).toEqual([`${P}-medium-old`, `${P}-short-new`]);
    expect((await articleService.trending(undefined, 365, 5))[0]?.slug).toBe(`${P}-long-older`);
  });

  it("counts a category's published articles by the viewer's visibility", async () => {
    const find = (nodes: Awaited<ReturnType<typeof articleCategoryService.tree>>) => nodes.find((n) => n.id === cat);
    expect(find(await articleCategoryService.tree(null))?.count).toBe(3);
    expect(find(await articleCategoryService.tree({ userId: author, groupIds: [] }))?.count).toBe(4);
  });
});
