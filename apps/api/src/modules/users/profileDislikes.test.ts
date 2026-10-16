/**
 * Dislikes on wall comments.
 *
 * A member holds a like OR a dislike on a comment, never both: either one replaces the
 * other, and the counters (the comment's two, the author's likes received) move with it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const tx = {
  profileCommentDislike: { create: vi.fn(), deleteMany: vi.fn() },
  profileCommentLike:    { create: vi.fn(), deleteMany: vi.fn() },
  profileComment:        { update: vi.fn() },
  user:                  { update: vi.fn() },
};
const db = {
  profileComment: { findUnique: vi.fn() },
  user:           { findUnique: vi.fn() },
  $transaction:   vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
};

vi.mock("../../infrastructure/db.js", () => ({ prisma: db }));
vi.mock("./users.repository.js", () => ({ userRepository: {} }));
vi.mock("../notifications/notification.service.js", () => ({ notificationService: { dispatch: vi.fn() } }));
vi.mock("../../shared/utils/settings.js", () => ({ getSetting: vi.fn() }));
vi.mock("../../shared/utils/blocks.js", () => ({ getHiddenAuthorIds: vi.fn() }));
vi.mock("../../shared/utils/presence.js", () => ({ isUserOnline: vi.fn() }));
vi.mock("./profileDob.js", () => ({ getDobForUser: vi.fn() }));

const { userService } = await import("./users.service.js");

beforeEach(() => {
  for (const m of Object.values(tx)) for (const fn of Object.values(m)) fn.mockReset();
  db.profileComment.findUnique.mockReset();
  db.profileComment.findUnique.mockResolvedValue({ id: "c1", authorId: "author", profileUserId: "owner", deletedAt: null });
  db.user.findUnique.mockResolvedValue(null);
  tx.profileCommentDislike.deleteMany.mockResolvedValue({ count: 0 });
  tx.profileCommentLike.deleteMany.mockResolvedValue({ count: 0 });
});

describe("disliking", () => {
  it("counts a dislike", async () => {
    await userService.dislikeProfileComment("c1", "me");
    expect(tx.profileComment.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { dislikeCount: { increment: 1 } } });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("replaces the member's like, and takes it off the author's total", async () => {
    tx.profileCommentLike.deleteMany.mockResolvedValue({ count: 1 });
    await userService.dislikeProfileComment("c1", "me");
    expect(tx.profileComment.update).toHaveBeenCalledWith({
      where: { id: "c1" }, data: { dislikeCount: { increment: 1 }, likeCount: { decrement: 1 } },
    });
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: "author" }, data: { likeCountReceived: { decrement: 1 } } });
  });

  it("is idempotent", async () => {
    tx.profileCommentDislike.create.mockRejectedValue({ code: "P2002" });
    await userService.dislikeProfileComment("c1", "me");
    expect(tx.profileComment.update).not.toHaveBeenCalled();
  });

  it("refuses the author and a deleted comment", async () => {
    await expect(userService.dislikeProfileComment("c1", "author")).rejects.toMatchObject({ code: "XEC-USER-4016" });
    db.profileComment.findUnique.mockResolvedValue({ id: "c1", authorId: "author", deletedAt: new Date() });
    await expect(userService.dislikeProfileComment("c1", "me")).rejects.toMatchObject({ code: "XEC-USER-4007" });
  });
});

describe("liking", () => {
  it("replaces the member's dislike", async () => {
    tx.profileCommentDislike.deleteMany.mockResolvedValue({ count: 1 });
    await userService.likeProfileComment("c1", "me");
    expect(tx.profileComment.update).toHaveBeenCalledWith({
      where: { id: "c1" }, data: { likeCount: { increment: 1 }, dislikeCount: { decrement: 1 } },
    });
  });
});

describe("taking a dislike back", () => {
  it("decrements only when there was one", async () => {
    await userService.undislikeProfileComment("c1", "me");
    expect(tx.profileComment.update).not.toHaveBeenCalled();
    tx.profileCommentDislike.deleteMany.mockResolvedValue({ count: 1 });
    await userService.undislikeProfileComment("c1", "me");
    expect(tx.profileComment.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { dislikeCount: { decrement: 1 } } });
  });
});
