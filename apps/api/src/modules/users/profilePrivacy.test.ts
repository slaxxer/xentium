/**
 * Account → Privacy, enforced on the server: every setting the tab offers changes
 * what ANOTHER person can do, and a block counts both ways.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { prisma } = await import("../../infrastructure/db.js");
const { assertDisposableDatabase } = await import("../../test/testDatabase.js");
const { userService } = await import("./users.service.js");
const { profileAccess } = await import("./profilePrivacy.js");
const { articleService } = await import("../articles/article.service.js");

const P = "prvcy";
let owner = "", fan = "", other = "";

async function clean() {
  await prisma.article.deleteMany({ where: { slug: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: P } } });
}

beforeEach(async () => {
  assertDisposableDatabase();
  await clean();
  const user = async (s: string) =>
    (await prisma.user.create({ data: { email: `${P}_${s}@example.test`, username: `${P}_${s}`, passwordHash: "x" } })).id;
  owner = await user("owner"); fan = await user("fan"); other = await user("other");
});
afterEach(clean);

const setPrivacy = (settings: Record<string, string | boolean>) =>
  prisma.userPrivacySettings.upsert({ where: { userId: owner }, update: { settings }, create: { userId: owner, settings } });

/** The error code a call fails with, or null when it succeeds. */
const code = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string }) => e.code ?? "error");

describe("with nothing set", () => {
  it("everything is open to members, and guests may look", async () => {
    expect(await profileAccess(owner, fan)).toEqual({ view: true, follow: true, comment: true, history: true });
    expect(await profileAccess(owner, undefined)).toEqual({ view: true, follow: false, comment: false, history: true });
  });
});

describe("my profile: members only", () => {
  it("keeps guests out of the profile and every part of it, and lets members in", async () => {
    await setPrivacy({ profileVisibility: "members" });
    expect(await code(userService.getPublicProfile(`${P}_owner`))).toBe("XEC-USER-4021");
    expect(await code(userService.getProfileComments(owner, 1, 10))).toBe("XEC-USER-4021");
    expect(await code(userService.getFollowers(owner, 1, 10))).toBe("XEC-USER-4021");
    expect(await code(userService.getFollowing(owner, 1, 10))).toBe("XEC-USER-4021");
    expect(await code(userService.getPublicProfile(`${P}_owner`, fan))).toBeNull();
  });
});

describe("who can follow me: nobody", () => {
  it("refuses a new follower and says so on the profile", async () => {
    await setPrivacy({ whoCanFollow: "nobody" });
    expect(await code(userService.followUser(fan, owner))).toBe("XEC-USER-4022");
    expect(await prisma.userFollow.count({ where: { followingId: owner } })).toBe(0);
    const profile = await userService.getPublicProfile(`${P}_owner`, fan);
    expect(profile.viewerCan.follow).toBe(false);
  });
});

describe("my wall", () => {
  it("closed: nobody else may post or reply, the owner still may reply", async () => {
    await setPrivacy({ allowProfileComments: false });
    expect(await code(userService.createProfileComment(owner, fan, "hi"))).toBe("XEC-USER-4023");
    // A comment from before the wall closed, and the owner answering it.
    const old = await prisma.profileComment.create({ data: { profileUserId: owner, authorId: fan, body: "before" } });
    expect(await code(userService.createProfileComment(owner, fan, "reply", old.id))).toBe("XEC-USER-4023");
    expect(await code(userService.createProfileComment(owner, owner, "thanks", old.id))).toBeNull();
  });

  it("who can comment: nobody", async () => {
    await setPrivacy({ whoCanComment: "nobody" });
    expect(await code(userService.createProfileComment(owner, fan, "hi"))).toBe("XEC-USER-4023");
  });

  it("who can comment: people I follow", async () => {
    await setPrivacy({ whoCanComment: "following" });
    expect(await code(userService.createProfileComment(owner, fan, "hi"))).toBe("XEC-USER-4023");
    await prisma.userFollow.create({ data: { followerId: owner, followingId: fan } });
    expect(await code(userService.createProfileComment(owner, fan, "hi"))).toBeNull();
    // Following the owner is not the same thing.
    await prisma.userFollow.create({ data: { followerId: other, followingId: owner } });
    expect(await code(userService.createProfileComment(owner, other, "hi"))).toBe("XEC-USER-4023");
  });
});

describe("a block, either way", () => {
  it("stops following and wall posts in both directions", async () => {
    await prisma.userBlock.create({ data: { blockerId: owner, blockedId: fan } });
    expect(await code(userService.followUser(fan, owner))).toBe("XEC-USER-4022");
    expect(await code(userService.createProfileComment(owner, fan, "hi"))).toBe("XEC-USER-4023");
    // The blocker can't reach the member they blocked either.
    expect(await code(userService.followUser(owner, fan))).toBe("XEC-USER-4022");
    expect(await code(userService.createProfileComment(fan, owner, "hi"))).toBe("XEC-USER-4023");
  });
});

describe("my post history", () => {
  const list = (viewer: string | undefined) =>
    articleService.list({ authorId: owner, page: 1, limit: 10 } as never, viewer).then((r) => r.data.length);

  beforeEach(async () => {
    await prisma.article.create({
      data: { authorId: owner, title: "t", slug: `${P}-a`, body: { type: "doc", content: [] }, status: "published", publishedAt: new Date() },
    });
  });

  it("members only: hidden from guests on the profile", async () => {
    await setPrivacy({ postHistoryVisibility: "members" });
    expect(await list(undefined)).toBe(0);
    expect(await list(fan)).toBe(1);
  });

  it("nobody: only the member sees their own history", async () => {
    await setPrivacy({ postHistoryVisibility: "nobody" });
    expect(await list(fan)).toBe(0);
    expect(await list(owner)).toBe(1);
  });
});
