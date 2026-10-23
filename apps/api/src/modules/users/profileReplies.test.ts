/**
 * Replies on the profile wall.
 *
 * One level deep, like article comments: a reply to a reply is filed under the same
 * top-level comment, but the member actually answered is the one notified. The wall's
 * owner may not START a comment on their own wall — and may reply on it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = {
  profileComment: { findUnique: vi.fn() },
  user:           { findMany: vi.fn() },
};
const repo = { createProfileComment: vi.fn(), findById: vi.fn() };
const notify = { dispatch: vi.fn() };

vi.mock("../../infrastructure/db.js", () => ({ prisma: db }));
vi.mock("./users.repository.js", () => ({ userRepository: repo }));
vi.mock("../notifications/notification.service.js", () => ({ notificationService: notify }));
vi.mock("../../shared/utils/settings.js", () => ({ getSetting: vi.fn() }));
vi.mock("../../shared/utils/blocks.js", () => ({ getHiddenAuthorIds: vi.fn() }));
vi.mock("../../shared/utils/presence.js", () => ({ isUserOnline: vi.fn() }));
vi.mock("./profileDob.js", () => ({ getDobForUser: vi.fn() }));
// Privacy is its own test (profilePrivacy.test.ts): here every wall is open.
vi.mock("./profilePrivacy.js", () => ({
  assertCanComment: vi.fn(), assertCanFollow: vi.fn(), assertProfileVisible: vi.fn(),
  profileAccess: vi.fn(async () => ({ view: true, follow: true, comment: true, history: true })),
}));

const { userService } = await import("./users.service.js");

const OWNER = "owner", ANN = "ann", BOB = "bob";
const names: Record<string, string> = { owner: "olive", ann: "ann", bob: "bob" };

beforeEach(() => {
  for (const m of [db.profileComment, db.user, repo, notify]) for (const fn of Object.values(m)) fn.mockReset();
  repo.createProfileComment.mockImplementation(async (d) => ({ id: "new", ...d }));
  repo.findById.mockImplementation(async (id: string) => ({ id, username: names[id] }));
  db.user.findMany.mockResolvedValue([]);
});

const notifiedTypes = () => notify.dispatch.mock.calls.map((c) => [c[0].userId, c[0].type]);

describe("starting a comment", () => {
  it("still refuses the wall's owner", async () => {
    await expect(userService.createProfileComment(OWNER, OWNER, "<p>hi</p>"))
      .rejects.toMatchObject({ code: "XEC-USER-4002" });
    expect(repo.createProfileComment).not.toHaveBeenCalled();
  });

  it("notifies the owner of a new comment", async () => {
    await userService.createProfileComment(OWNER, ANN, "<p>hi</p>");
    expect(repo.createProfileComment.mock.calls[0]![0]).not.toHaveProperty("parentId");
    expect(notifiedTypes()).toEqual([[OWNER, "profile.comment_posted"]]);
  });
});

describe("replying", () => {
  it("lets the owner reply on their own wall, and tells the comment's author", async () => {
    db.profileComment.findUnique.mockResolvedValue({ id: "c1", authorId: ANN, profileUserId: OWNER, parentId: null, deletedAt: null });
    await userService.createProfileComment(OWNER, OWNER, "<p>thanks</p>", "c1");
    expect(repo.createProfileComment.mock.calls[0]![0]).toMatchObject({ parentId: "c1", authorId: OWNER });
    // The owner wrote it, so the owner is not told about it.
    expect(notifiedTypes()).toEqual([[ANN, "profile.comment_reply"]]);
  });

  it("files a reply to a reply under the top-level comment, but notifies the one answered", async () => {
    db.profileComment.findUnique
      .mockResolvedValueOnce({ id: "r1", authorId: BOB, profileUserId: OWNER, parentId: "c1", deletedAt: null })
      .mockResolvedValueOnce({ id: "c1", authorId: ANN });
    await userService.createProfileComment(OWNER, ANN, "<p>sure</p>", "r1");
    expect(repo.createProfileComment.mock.calls[0]![0]).toMatchObject({ parentId: "c1" });
    expect(notifiedTypes()).toEqual([[BOB, "profile.comment_reply"], [OWNER, "profile.comment_posted"]]);
  });

  it("does not notify anyone twice when the owner's own comment is answered", async () => {
    db.profileComment.findUnique.mockResolvedValue({ id: "c1", authorId: OWNER, profileUserId: OWNER, parentId: null, deletedAt: null });
    await userService.createProfileComment(OWNER, ANN, "<p>hey</p>", "c1");
    expect(notifiedTypes()).toEqual([[OWNER, "profile.comment_reply"]]);
  });

  it("refuses a reply to a comment on another wall, or a deleted one", async () => {
    db.profileComment.findUnique.mockResolvedValueOnce({ id: "x", authorId: BOB, profileUserId: "elsewhere", parentId: null, deletedAt: null });
    await expect(userService.createProfileComment(OWNER, ANN, "<p>a</p>", "x")).rejects.toMatchObject({ code: "XEC-USER-4015" });
    db.profileComment.findUnique.mockResolvedValueOnce({ id: "y", authorId: BOB, profileUserId: OWNER, parentId: null, deletedAt: new Date() });
    await expect(userService.createProfileComment(OWNER, ANN, "<p>a</p>", "y")).rejects.toMatchObject({ code: "XEC-USER-4015" });
    expect(repo.createProfileComment).not.toHaveBeenCalled();
  });
});
