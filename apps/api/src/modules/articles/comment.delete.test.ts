/**
 * Deleting article comments: your own needs `article.comment.delete.own`, anyone
 * else's needs `article.comment.delete.any` plus a reason, and a moderator's delete
 * is written to the moderation log like the ModCanvas one.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { commentService } from "./comment.service.js";

const P = "cdel_probe";
const OWN = { own: true, any: false };
const MOD = { own: true, any: true };
const NONE = { own: false, any: false };
let mod = "", author = "", articleId = "", commentId = "";

async function clean() {
  await prisma.moderationLog.deleteMany({ where: { reason: { startsWith: P } } });
  await prisma.article.deleteMany({ where: { slug: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: P } } });
}

beforeEach(async () => {
  assertDisposableDatabase();
  await clean();
  mod    = (await prisma.user.create({ data: { email: `${P}_m@example.test`, username: `${P}_m`, passwordHash: "x" } })).id;
  author = (await prisma.user.create({ data: { email: `${P}_a@example.test`, username: `${P}_a`, passwordHash: "x", commentCount: 1 } })).id;
  articleId = (await prisma.article.create({
    data: { authorId: mod, title: "t", slug: `${P}-a`, body: { type: "doc", content: [] }, status: "published", publishedAt: new Date(), commentCount: 1 },
  })).id;
  commentId = (await prisma.articleComment.create({ data: { articleId, authorId: author, body: "<p>hi</p>" } })).id;
});
afterEach(clean);

describe("deleting article comments", () => {
  it("the author deletes their own comment without a reason and the counters drop", async () => {
    await commentService.softDelete(commentId, author, OWN, undefined);
    const c = await prisma.articleComment.findUniqueOrThrow({ where: { id: commentId } });
    expect(c.deletedAt).not.toBeNull();
    expect(c.deletedReason).toBeNull();
    expect((await prisma.article.findUniqueOrThrow({ where: { id: articleId } })).commentCount).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: author } })).commentCount).toBe(0);
  });

  it("refuses the author's own delete without article.comment.delete.own", async () => {
    await expect(commentService.softDelete(commentId, author, NONE, undefined)).rejects.toMatchObject({ httpStatus: 403 });
  });

  it("refuses someone else's comment without article.comment.delete.any", async () => {
    await expect(commentService.softDelete(commentId, mod, OWN, `${P} spam`)).rejects.toMatchObject({ httpStatus: 403 });
  });

  it("a moderator needs a reason", async () => {
    await expect(commentService.softDelete(commentId, mod, MOD, undefined)).rejects.toMatchObject({ httpStatus: 400 });
  });

  it("a deleted comment leaves the list without a tombstone, and takes its replies along", async () => {
    const reply = (await prisma.articleComment.create({ data: { articleId, authorId: mod, parentId: commentId, body: "<p>re</p>" } })).id;
    await prisma.article.update({ where: { id: articleId }, data: { commentCount: 2 } });
    await prisma.user.update({ where: { id: mod }, data: { commentCount: 1 } });

    await commentService.softDelete(commentId, author, OWN, undefined);
    expect((await commentService.list(articleId, 1, 20, undefined)).data).toEqual([]);
    expect((await prisma.articleComment.findUniqueOrThrow({ where: { id: reply } })).deletedAt).not.toBeNull();
    expect((await prisma.article.findUniqueOrThrow({ where: { id: articleId } })).commentCount).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: mod } })).commentCount).toBe(0);
  });

  it("a moderator's delete keeps the reason and lands in the moderation log", async () => {
    await commentService.softDelete(commentId, mod, MOD, `${P} spam`);
    const c = await prisma.articleComment.findUniqueOrThrow({ where: { id: commentId } });
    expect(c).toMatchObject({ deletedById: mod, deletedReason: `${P} spam` });
    const log = await prisma.moderationLog.findFirst({ where: { targetId: commentId } });
    expect(log).toMatchObject({ actorId: mod, action: "comment.deleted", targetType: "article_comment" });
    expect((await prisma.article.findUniqueOrThrow({ where: { id: articleId } })).commentCount).toBe(0);
  });
});
