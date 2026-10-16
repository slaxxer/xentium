/**
 * Articles as an embed host: saving tells each embed type what the body now holds,
 * and `article` visibility (the rule `getBySlug` applies) answers for anything
 * embedded in it. Real service, disposable test database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { articleService } from "./article.service.js";
import { embedRegistry } from "../../core/embed-registry/embed-registry.js";
import { contentRegistry } from "../../core/content-registry/content-registry.js";

const P = "embedprobe";
let author = "", other = "";
const sync = vi.fn(async (_host: unknown, _ids: string[]) => [] as string[]);

const doc = (...ids: string[]) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "a poll below" }] },
    ...ids.map((id) => ({ type: "xtEmbed", attrs: { type: "poll", id } }))],
});

async function clean() {
  await prisma.article.deleteMany({ where: { slug: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: P } } });
}

beforeEach(async () => {
  assertDisposableDatabase();
  await clean();
  author = (await prisma.user.create({ data: { email: `${P}_a@example.test`, username: `${P}_a`, passwordHash: "x" } })).id;
  other  = (await prisma.user.create({ data: { email: `${P}_o@example.test`, username: `${P}_o`, passwordHash: "x" } })).id;
  sync.mockClear();
  embedRegistry.register("test-polls", { type: "poll", sync, remove: async () => {} });
});
afterEach(async () => { embedRegistry.deregister("test-polls"); await clean(); });

describe("articles hold embeds", () => {
  it("tell the embed owner on create and on a body edit, with the article's author", async () => {
    const a = await articleService.create(author, {
      title: `${P} one`, body: doc("p1"), visibility: "public", tags: [],
    } as never);
    expect(sync).toHaveBeenLastCalledWith({ kind: "article", id: a.id, authorId: author }, expect.anything());
    expect(sync.mock.lastCall?.[1]).toEqual(["p1"]);

    await articleService.update(a.id, author, false, { body: doc() } as never);
    expect(sync.mock.lastCall?.[1]).toEqual([]);

    sync.mockClear();
    await articleService.update(a.id, author, false, { excerpt: "no body change" } as never);
    expect(sync).not.toHaveBeenCalled();
  });

  it("answer article visibility exactly like the reader: drafts and members-only stay hidden", async () => {
    const a = await articleService.create(author, {
      title: `${P} two`, body: doc(), visibility: "members", tags: [],
    } as never);
    // A draft: its author only.
    expect(await contentRegistry.canView("article", a.id, author)).toBe(true);
    expect(await contentRegistry.canView("article", a.id, other)).toBe(false);

    await prisma.article.update({ where: { id: a.id }, data: { status: "published", publishedAt: new Date() } });
    expect(await contentRegistry.canView("article", a.id, other)).toBe(true);
    expect(await contentRegistry.canView("article", a.id, null)).toBe(false);

    await prisma.article.update({ where: { id: a.id }, data: { deletedAt: new Date() } });
    expect(await contentRegistry.canView("article", a.id, author)).toBe(false);
    expect(await contentRegistry.canView("article", "no-such-id", author)).toBe(false);
  });
});
