/**
 * Staff moderation on an article: closed comments refuse new comments except for
 * `article.comment.closed`; a hidden article leaves every public list and is a 404
 * for everyone but its author and `article.hide`. Both are logged.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CorePermissions } from "@xentium/contracts";
import { prisma } from "../../infrastructure/db.js";
import { assertDisposableDatabase } from "../../test/testDatabase.js";
import { articleService } from "./article.service.js";
import { commentService } from "./comment.service.js";

const P = "amod_probe";
const NOBODY = { editAny: false, seeHidden: false };
let staff = "", author = "", reader = "", articleId = "", slug = "";

async function clean() {
  await prisma.moderationLog.deleteMany({ where: { targetId: articleId || "none" } });
  await prisma.article.deleteMany({ where: { slug: { startsWith: P } } });
  await prisma.group.deleteMany({ where: { key: `${P}_staff` } });
  await prisma.user.deleteMany({ where: { email: { startsWith: P } } });
}

beforeEach(async () => {
  assertDisposableDatabase();
  await clean();
  const user = async (s: string) =>
    (await prisma.user.create({ data: { email: `${P}_${s}@example.test`, username: `${P}_${s}`, passwordHash: "x" } })).id;
  staff = await user("s"); author = await user("a"); reader = await user("r");
  // Staff: may comment on closed articles and see hidden ones.
  const perms = await Promise.all([CorePermissions.ARTICLE_COMMENT_CLOSED, CorePermissions.ARTICLE_HIDE].map((key) =>
    prisma.permission.upsert({ where: { key }, update: {}, create: { key, label: key } })));
  const group = await prisma.group.create({ data: { key: `${P}_staff`, name: "Staff probe" } });
  await prisma.groupPermission.createMany({ data: perms.map((p) => ({ groupId: group.id, permissionId: p.id })) });
  await prisma.userGroup.create({ data: { userId: staff, groupId: group.id } });
  const a = await prisma.article.create({
    data: { authorId: author, title: "t", slug: `${P}-a`, body: { type: "doc", content: [] }, status: "published", publishedAt: new Date() },
  });
  articleId = a.id; slug = a.slug;
});
afterEach(clean);

describe("closed comments", () => {
  it("refuses a member, lets staff through, and logs both changes", async () => {
    await articleService.setCommentsClosed(articleId, true, staff);
    await expect(commentService.create(articleId, reader, "<p>hi</p>", null)).rejects.toMatchObject({ httpStatus: 403, code: "XEC-ARTICLE-3004" });
    await expect(commentService.create(articleId, staff, "<p>staff</p>", null)).resolves.toBeTruthy();
    expect((await articleService.getBySlug(slug, reader, NOBODY)).commentsClosed).toBe(true);

    await articleService.setCommentsClosed(articleId, false, staff);
    await expect(commentService.create(articleId, reader, "<p>open again</p>", null)).resolves.toBeTruthy();
    const actions = (await prisma.moderationLog.findMany({ where: { targetId: articleId }, orderBy: { createdAt: "asc" } })).map((l) => l.action);
    expect(actions).toEqual(["article.comments_closed", "article.comments_reopened"]);
  });
});

describe("hidden articles", () => {
  it("are a 404 for readers and editors, but open for the author and article.hide", async () => {
    await articleService.setHidden(articleId, true, staff);
    await expect(articleService.getBySlug(slug, reader, NOBODY)).rejects.toMatchObject({ httpStatus: 404 });
    await expect(articleService.getBySlug(slug, reader, { editAny: true, seeHidden: false })).rejects.toMatchObject({ httpStatus: 404 });
    expect((await articleService.getBySlug(slug, author, NOBODY)).hidden).toBe(true);
    expect((await articleService.getBySlug(slug, staff, { editAny: false, seeHidden: true })).hidden).toBe(true);
  });

  it("leave the public list, and come back when shown again", async () => {
    const listed = async () => (await articleService.list({ page: 1, limit: 100 } as never, reader)).data.some((x) => x.id === articleId);
    expect(await listed()).toBe(true);
    await articleService.setHidden(articleId, true, staff);
    expect(await listed()).toBe(false);
    await articleService.setHidden(articleId, false, staff);
    expect(await listed()).toBe(true);
  });

  it("refuse comments from readers", async () => {
    await articleService.setHidden(articleId, true, staff);
    await expect(commentService.create(articleId, reader, "<p>hi</p>", null)).rejects.toMatchObject({ httpStatus: 404 });
  });
});
