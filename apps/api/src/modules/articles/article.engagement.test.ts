/**
 * Home's own lists: Following (followed categories and tags), Liked, Saved, Mine —
 * and the per-card viewer state. Real service, disposable test database.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { articleService } from "./article.service.js";
import { articleEngagementService } from "./article.engagement.js";
import { articleLikeService } from "./comment.service.js";

const P = "engage_probe";
let reader = "", author = "", catA = "", catB = "", tag = "";
const ids: Record<string, string> = {};

async function clean() {
  await prisma.article.deleteMany({ where: { slug: { startsWith: P } } });
  await prisma.tag.deleteMany({ where: { slug: { startsWith: P } } });
  await prisma.articleCategory.deleteMany({ where: { slug: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: P } } });
}

const article = async (key: string, data: { authorId: string; categoryId?: string; tagId?: string; visibility?: string }) => {
  const a = await prisma.article.create({
    data: {
      authorId: data.authorId, categoryId: data.categoryId, title: key, slug: `${P}-${key}`,
      body: { type: "doc", content: [] }, status: "published", publishedAt: new Date(),
      visibility: data.visibility ?? "public",
      ...(data.tagId ? { tags: { create: [{ tagId: data.tagId }] } } : {}),
    },
  });
  ids[key] = a.id;
};

const feed = async (f: "following" | "liked" | "saved" | "mine", viewer = reader) =>
  (await articleService.list({ page: 1, limit: 50, feed: f } as never, viewer)).data.map((a) => a.title).sort();

beforeEach(async () => {
  assertDisposableDatabase();
  await clean();
  reader = (await prisma.user.create({ data: { email: `${P}_r@example.test`, username: `${P}_r`, passwordHash: "x" } })).id;
  author = (await prisma.user.create({ data: { email: `${P}_a@example.test`, username: `${P}_a`, passwordHash: "x" } })).id;
  catA = (await prisma.articleCategory.create({ data: { name: "A", slug: `${P}-a` } })).id;
  catB = (await prisma.articleCategory.create({ data: { name: "B", slug: `${P}-b` } })).id;
  tag = (await prisma.tag.create({ data: { name: `${P}-t`, slug: `${P}-t` } })).id;
  await article("inA", { authorId: author, categoryId: catA });
  await article("inB", { authorId: author, categoryId: catB });
  await article("tagged", { authorId: author, categoryId: catB, tagId: tag });
  await article("own", { authorId: reader, categoryId: catB });
});
afterEach(clean);

describe("home lists", () => {
  it("Following = articles in followed categories OR carrying followed tags", async () => {
    expect(await feed("following")).toEqual([]);
    await articleEngagementService.followCategory(catA, reader);
    // Signed in, so the visibility rule is an OR too — it must not swallow this one.
    expect(await feed("following")).toEqual(["inA"]);
    await articleEngagementService.followTag(tag, reader);
    expect(await feed("following")).toEqual(["inA", "tagged"]);
    await articleEngagementService.unfollowCategory(catA, reader);
    expect(await feed("following")).toEqual(["tagged"]);
    expect((await articleEngagementService.followedTopics(reader)).tags.map((t) => t.id)).toEqual([tag]);
  });

  it("Liked, Saved and Mine are the viewer's own", async () => {
    await articleLikeService.like(ids.inB!, reader);
    await articleEngagementService.save(ids.tagged!, reader);
    expect(await feed("liked")).toEqual(["inB"]);
    expect(await feed("saved")).toEqual(["tagged"]);
    expect(await feed("mine")).toEqual(["own"]);
    await articleEngagementService.unsave(ids.tagged!, reader);
    expect(await feed("saved")).toEqual([]);
  });

  it("a list tells the viewer what they liked and saved; guests get none of it", async () => {
    await articleLikeService.like(ids.inA!, reader);
    await articleEngagementService.save(ids.inA!, reader);
    const list = (await articleService.list({ page: 1, limit: 50 } as never, reader)).data;
    expect(list.find((a) => a.id === ids.inA)?.viewer).toEqual({ liked: true, saved: true });
    expect(list.find((a) => a.id === ids.inB)?.viewer).toEqual({ liked: false, saved: false });
    const guest = (await articleService.list({ page: 1, limit: 50 } as never, undefined)).data;
    expect(guest.every((a) => a.viewer === undefined)).toBe(true);
  });

  it("personal lists are empty for a guest", async () => {
    for (const f of ["following", "liked", "saved", "mine"] as const) {
      // Straight to the service: `feed()`'s default parameter would put the reader back.
      const list = await articleService.list({ page: 1, limit: 50, feed: f } as never, undefined);
      expect(list.data).toEqual([]);
    }
  });
});
