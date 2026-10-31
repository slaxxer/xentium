/**
 * Article versions: every save of a published article keeps one, and an earlier
 * one can be put back. A restore keeps what was there as a version first, so it
 * can be undone from the same list. Real service, disposable test database.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { articleService } from "./article.service.js";

const P = "revprobe";
let author = "";

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const textOf = (body: unknown) => JSON.stringify(body).match(/"text":"([^"]*)"/)?.[1];

async function clean() {
  await prisma.article.deleteMany({ where: { slug: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: P } } });
}

beforeEach(async () => {
  assertDisposableDatabase();
  await clean();
  author = (await prisma.user.create({ data: { email: `${P}_a@example.test`, username: `${P}_a`, passwordHash: "x" } })).id;
});
afterEach(clean);

describe("restoring an article version", () => {
  it("puts an earlier title and body back, and keeps the replaced text as a version", async () => {
    const a = await articleService.create(author, { title: `${P} first`, body: doc("one"), visibility: "public", tags: [] } as never);
    await articleService.publish(a.id, author, false);
    await articleService.update(a.id, author, false, { title: `${P} second`, body: doc("two") } as never);

    const versions = await prisma.articleRevision.findMany({ where: { articleId: a.id }, orderBy: { createdAt: "asc" } });
    expect(versions.map((v) => textOf(v.body))).toEqual(["one", "two"]);

    const restored = await articleService.restoreRevision(a.id, versions[0]!.id, author);
    expect(restored.title).toBe(`${P} first`);
    const now = await prisma.article.findUniqueOrThrow({ where: { id: a.id } });
    expect(textOf(now.body)).toBe("one");
    expect(now.bodyPlain).toContain("one");

    // "two" was already the newest version, so only the restore itself was added.
    const after = await prisma.articleRevision.findMany({ where: { articleId: a.id }, orderBy: { createdAt: "asc" } });
    expect(after.map((v) => textOf(v.body))).toEqual(["one", "two", "one"]);
  });

  it("keeps a draft's unsaved text as a version before replacing it", async () => {
    const a = await articleService.create(author, { title: `${P} draft`, body: doc("published"), visibility: "public", tags: [] } as never);
    await articleService.publish(a.id, author, false);
    const [first] = await prisma.articleRevision.findMany({ where: { articleId: a.id } });
    // Back to draft and edited: no version for that edit.
    await prisma.article.update({ where: { id: a.id }, data: { status: "draft" } });
    await articleService.update(a.id, author, false, { body: doc("draft text") } as never);

    await articleService.restoreRevision(a.id, first!.id, author);
    const texts = (await prisma.articleRevision.findMany({ where: { articleId: a.id }, orderBy: { createdAt: "asc" } }))
      .map((v) => textOf(v.body));
    expect(texts).toContain("draft text");
  });

  it("refuses a version of another article", async () => {
    const a = await articleService.create(author, { title: `${P} a`, body: doc("a"), visibility: "public", tags: [] } as never);
    const b = await articleService.create(author, { title: `${P} b`, body: doc("b"), visibility: "public", tags: [] } as never);
    await articleService.publish(b.id, author, false);
    const [ofB] = await prisma.articleRevision.findMany({ where: { articleId: b.id } });
    await expect(articleService.restoreRevision(a.id, ofB!.id, author)).rejects.toMatchObject({ httpStatus: 404 });
  });
});
