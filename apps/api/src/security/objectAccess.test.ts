/**
 * Object access, end to end over HTTP: a signed-in member (A) must not read, change
 * or delete another member's (B's) things by naming their ids, and must not reach
 * staff endpoints without the permission. Every refusal is checked twice: the status
 * (403 or 404, never a 2xx) and the row itself, untouched afterwards.
 *
 * A holds the ordinary member permissions (write, publish and comment on articles)
 * so a refusal here is about OWNERSHIP, not a missing permission.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { CorePermissions } from "@xentium/contracts";

const { prisma } = await import("../infrastructure/db.js");
const { assertDisposableDatabase } = await import("../test/testDatabase.js");
const { createSession } = await import("../modules/auth/auth.tokens.js");
const { permissionCache } = await import("../modules/permissions/permission.cache.js");
const { __resetInstalledCache } = await import("../shared/middleware/installGuard.js");
const { createApp } = await import("../app/app.js");

const P = "objacc";
const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Body" }] }] };

let app: Express;
let installRowCreated = false;
let tokA = "", tokB = "";
type Key = "a" | "b" | "c" | "bDraft" | "bPub" | "bComment" | "bWall" | "bNotif" | "bPasskey" | "bSession";
const id = {} as Record<Key, string>;

async function clean() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  await prisma.article.deleteMany({ where: { slug: { startsWith: P } } });
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.group.deleteMany({ where: { key: `${P}_members` } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

beforeAll(async () => {
  assertDisposableDatabase();
  await clean();
  // An installed site: the guard lets feature routes through only then.
  const install = await prisma.install.findUnique({ where: { singleton: true } });
  if (!install?.completedAt) {
    installRowCreated = !install;
    await prisma.install.upsert({
      where: { singleton: true },
      update: { completedAt: new Date() },
      create: { singleton: true, completedAt: new Date() } as never,
    });
  }
  __resetInstalledCache();

  const user = async (s: string) =>
    (await prisma.user.create({ data: { email: `${P}_${s}@example.test`, username: `${P}_${s}`, passwordHash: "x" } })).id;
  id.a = await user("a"); id.b = await user("b"); id.c = await user("c");

  // Ordinary member rights for both.
  const keys = [CorePermissions.ARTICLE_CREATE, CorePermissions.ARTICLE_PUBLISH, CorePermissions.ARTICLE_COMMENT_CREATE];
  const perms = await Promise.all(keys.map((key) => prisma.permission.upsert({ where: { key }, update: {}, create: { key, label: key } })));
  const group = await prisma.group.create({ data: { key: `${P}_members`, name: "Object access probe" } });
  await prisma.groupPermission.createMany({ data: perms.map((p) => ({ groupId: group.id, permissionId: p.id })) });
  for (const u of [id.a, id.b, id.c]) {
    await prisma.userGroup.create({ data: { userId: u, groupId: group.id } });
    await permissionCache.invalidate(u);
  }

  // B's things.
  const art = (slug: string, data: Record<string, unknown>) => prisma.article.create({
    data: { authorId: id.b, title: slug, slug: `${P}-${slug}`, body: doc, ...data },
  });
  id.bDraft = (await art("draft", { status: "draft" })).id;
  id.bPub = (await art("pub", { status: "published", publishedAt: new Date() })).id;
  await prisma.articleRevision.create({ data: { articleId: id.bDraft, authorId: id.b, title: "draft", body: doc } as never });
  id.bComment = (await prisma.articleComment.create({ data: { articleId: id.bPub, authorId: id.b, body: "B's comment" } })).id;
  // B wrote on C's wall: A is neither the author nor the wall's owner.
  id.bWall = (await prisma.profileComment.create({ data: { profileUserId: id.c, authorId: id.b, body: "B on C's wall" } })).id;
  id.bNotif = (await prisma.notification.create({ data: { userId: id.b, type: "test", title: "For B", body: "x" } })).id;
  id.bPasskey = (await prisma.passkey.create({
    data: { userId: id.b, credentialId: `${P}-cred`, publicKey: Buffer.from("k"), deviceType: "singleDevice", name: "B's key" },
  })).id;

  const sa = await createSession(id.a, { ip: "127.0.0.1", userAgent: "test" });
  const sb = await createSession(id.b, { ip: "127.0.0.1", userAgent: "test" });
  tokA = sa.accessToken; tokB = sb.accessToken;
  id.bSession = (await prisma.session.findFirstOrThrow({ where: { userId: id.b }, orderBy: { createdAt: "desc" } })).id;

  app = createApp();
});

afterAll(async () => {
  await clean();
  if (installRowCreated) await prisma.install.deleteMany({ where: { singleton: true } });
  __resetInstalledCache();
});

const asA = (method: "get" | "post" | "put" | "patch" | "delete", path: string) =>
  request(app)[method](path).set("Authorization", `Bearer ${tokA}`);

/** Refused: a 403 or a 404, never a success. */
const refused = (status: number) => expect([403, 404]).toContain(status);

describe("B's articles", () => {
  it("A cannot edit B's draft", async () => {
    const r = await asA("patch", `/api/articles/${id.bDraft}`).send({ title: "hacked" });
    refused(r.status);
    expect((await prisma.article.findUniqueOrThrow({ where: { id: id.bDraft } })).title).toBe("draft");
  });

  it("A cannot publish B's draft", async () => {
    const r = await asA("post", `/api/articles/${id.bDraft}/publish`).send({});
    refused(r.status);
    expect((await prisma.article.findUniqueOrThrow({ where: { id: id.bDraft } })).status).toBe("draft");
  });

  it("A cannot unpublish B's article", async () => {
    const r = await asA("post", `/api/articles/${id.bPub}/unpublish`).send({});
    refused(r.status);
    expect((await prisma.article.findUniqueOrThrow({ where: { id: id.bPub } })).status).toBe("published");
  });

  it("A cannot delete B's article", async () => {
    const r = await asA("delete", `/api/articles/${id.bPub}`);
    refused(r.status);
    expect((await prisma.article.findUniqueOrThrow({ where: { id: id.bPub } })).deletedAt).toBeNull();
  });

  it("A cannot read B's draft, nor its revisions", async () => {
    refused((await asA("get", `/api/articles/${P}-draft`)).status);
    refused((await request(app).get(`/api/articles/${P}-draft`)).status);
    refused((await asA("get", `/api/articles/${id.bDraft}/revisions`)).status);
  });

  it("A cannot replace the picture on B's article", async () => {
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6300010000050001a5f645400000000049454e44ae426082", "hex");
    const r = await asA("post", `/api/articles/${id.bPub}/featured-image`).attach("file", png, "x.png");
    refused(r.status);
    expect((await prisma.article.findUniqueOrThrow({ where: { id: id.bPub } })).featuredImage).toBeNull();
  });
});

describe("B's comments and wall posts", () => {
  it("A cannot edit or delete B's article comment", async () => {
    refused((await asA("patch", `/api/article-comments/${id.bComment}`).send({ body: "hacked" })).status);
    refused((await asA("delete", `/api/article-comments/${id.bComment}`)).status);
    const c = await prisma.articleComment.findUniqueOrThrow({ where: { id: id.bComment } });
    expect(c.body).toBe("B's comment");
    expect(c.deletedAt).toBeNull();
  });

  it("A cannot edit or delete what B wrote on C's wall", async () => {
    refused((await asA("put", `/api/users/profile-comments/${id.bWall}`).send({ body: "hacked" })).status);
    refused((await asA("delete", `/api/users/profile-comments/${id.bWall}`)).status);
    const c = await prisma.profileComment.findUniqueOrThrow({ where: { id: id.bWall } });
    expect(c.body).toBe("B on C's wall");
    expect(c.deletedAt).toBeNull();
  });
});

describe("B's account", () => {
  it("A cannot mark B's notification read", async () => {
    await asA("patch", `/api/notifications/${id.bNotif}/read`);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: id.bNotif } })).readAt).toBeNull();
  });

  it("A never sees B's notifications in their own list", async () => {
    const r = await asA("get", "/api/notifications");
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain(id.bNotif);
  });

  it("A cannot sign B out of a session", async () => {
    await asA("delete", `/api/account/sessions/${id.bSession}`);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: id.bSession } })).revokedAt).toBeNull();
    // B's token still works.
    expect((await request(app).get("/api/auth/me").set("Authorization", `Bearer ${tokB}`)).status).toBe(200);
  });

  it("A cannot rename or remove B's passkey", async () => {
    await asA("patch", `/api/auth/passkeys/${id.bPasskey}`).send({ name: "hacked" });
    await asA("delete", `/api/auth/passkeys/${id.bPasskey}`);
    expect((await prisma.passkey.findUniqueOrThrow({ where: { id: id.bPasskey } })).name).toBe("B's key");
  });

  it("A's account endpoints only ever show A", async () => {
    const r = await asA("get", "/api/account/sessions");
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain(id.bSession);
  });
});

describe("staff endpoints without the permission", () => {
  it.each([
    ["get", "/api/admin/users"],
    ["get", "/api/admin/invites"],
    ["get", "/api/moderation/reports"],
    ["post", `/api/moderation/users/${"B"}/sessions/revoke-all`],
    ["delete", `/api/moderation/comments/article/${"C"}`],
    ["delete", `/api/moderation/comments/profile/${"W"}`],
  ] as const)("%s %s is refused", async (method, raw) => {
    const path = raw.replace("/B/", `/${id.b}/`).replace(/\/C$/, `/${id.bComment}`).replace(/\/W$/, `/${id.bWall}`);
    refused((await asA(method, path)).status);
  });

  it("and nothing changed", async () => {
    expect((await prisma.session.findUniqueOrThrow({ where: { id: id.bSession } })).revokedAt).toBeNull();
    expect((await prisma.articleComment.findUniqueOrThrow({ where: { id: id.bComment } })).deletedAt).toBeNull();
    expect((await prisma.profileComment.findUniqueOrThrow({ where: { id: id.bWall } })).deletedAt).toBeNull();
  });
});
