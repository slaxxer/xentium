/**
 * Thumbs up / down on article comments: one or the other, never both; no dislike on
 * one's own comment; the list says how the viewer reacted.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { commentDislikeService, commentLikeService, commentService } from "./comment.service.js";

const P = "react_probe";
let reader = "", author = "", articleId = "", commentId = "";

async function clean() {
  await prisma.article.deleteMany({ where: { slug: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: P } } });
}

beforeEach(async () => {
  assertDisposableDatabase();
  await clean();
  reader = (await prisma.user.create({ data: { email: `${P}_r@example.test`, username: `${P}_r`, passwordHash: "x" } })).id;
  author = (await prisma.user.create({ data: { email: `${P}_a@example.test`, username: `${P}_a`, passwordHash: "x" } })).id;
  articleId = (await prisma.article.create({
    data: { authorId: author, title: "t", slug: `${P}-a`, body: { type: "doc", content: [] }, status: "published", publishedAt: new Date() },
  })).id;
  commentId = (await prisma.articleComment.create({ data: { articleId, authorId: author, body: "<p>hi</p>" } })).id;
});
afterEach(clean);

describe("comment thumbs", () => {
  it("a dislike replaces a like and takes back the author's received like", async () => {
    expect(await commentLikeService.like(commentId, reader)).toEqual({ likeCount: 1, dislikeCount: 0 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: author } })).likeCountReceived).toBe(1);
    expect(await commentDislikeService.dislike(commentId, reader)).toEqual({ likeCount: 0, dislikeCount: 1 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: author } })).likeCountReceived).toBe(0);
    expect(await commentLikeService.like(commentId, reader)).toEqual({ likeCount: 1, dislikeCount: 0 });
    expect(await commentLikeService.unlike(commentId, reader)).toEqual({ likeCount: 0, dislikeCount: 0 });
  });

  it("refuses a dislike on one's own comment", async () => {
    await expect(commentDislikeService.dislike(commentId, author)).rejects.toMatchObject({ httpStatus: 400 });
  });

  it("the list carries both counts and the viewer's reaction", async () => {
    await commentDislikeService.dislike(commentId, reader);
    const mine = (await commentService.list(articleId, 1, 20, reader)).data[0]!;
    expect(mine).toMatchObject({ likeCount: 0, dislikeCount: 1, viewerReaction: "dislike" });
    const guest = (await commentService.list(articleId, 1, 20, undefined)).data[0]!;
    expect(guest.viewerReaction).toBeUndefined();
    expect(guest.dislikeCount).toBe(1);
  });
});
