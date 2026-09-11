/**
 * The badge service's rules, against a stand-in store.
 *
 * The database is mocked because none of what is worth asserting here is about
 * Postgres: that a badge is HELD rather than accumulated, that a card's badges come
 * back in a deterministic order, and that the batch answers for every id it was
 * asked about — including the ones holding nothing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = {
  badge:     { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  userBadge: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  user:      { findUnique: vi.fn() },
};
vi.mock("../../infrastructure/db.js", () => ({ prisma: db }));
vi.mock("../../infrastructure/storage/LocalStorageProvider.js", () => ({
  storage: {
    save:      vi.fn(async (dir: string, name: string) => `${dir}/${name}`),
    publicUrl: (rel: string) => `/uploads/${rel}`,
  },
}));

const { badgesService } = await import("./badges.service.js");

const CAT: {
  id: string; key: string; name: string; description: string | null;
  icon: string | null; faIcon: string | null; color: string | null;
  displayOrder: number; isSystem: boolean;
} = {
  id: "b1", key: "early", name: "Early supporter", description: "Was here first",
  icon: null, faIcon: "faStar", color: "#f4b942", displayOrder: 100, isSystem: false,
};

function held(badge = CAT, userId = "u1") {
  return { userId, awardedAt: new Date("2026-01-02T03:04:05.000Z"), note: null, badge };
}

beforeEach(() => {
  for (const model of Object.values(db)) for (const fn of Object.values(model)) fn.mockReset();
  db.badge.findUnique.mockResolvedValue({ id: "b1", isSystem: false });
});

describe("the catalogue", () => {
  /**
   * ⚠ `displayOrder` THEN `name`. Without the second key, which of two badges at
   * order 100 comes first is Postgres row-order roulette, and a user card quietly
   * reshuffles between requests.
   */
  it("orders by display order, then name", async () => {
    db.badge.findMany.mockResolvedValue([]);
    await badgesService.list();
    expect(db.badge.findMany.mock.calls[0]![0].orderBy)
      .toEqual([{ displayOrder: "asc" }, { name: "asc" }]);
  });

  it("turns a stored icon path into a URL, and leaves a missing one null", async () => {
    db.badge.findMany.mockResolvedValue([
      { ...CAT, icon: "badges/b1.png", _count: { users: 3 } },
      { ...CAT, id: "b2", icon: null, _count: { users: 0 } },
    ]);
    const [withIcon, without] = await badgesService.list() as [any, any];
    expect(withIcon.icon).toBe("/uploads/badges/b1.png");
    expect(withIcon.holders).toBe(3);
    expect(without.icon).toBeNull();
  });

  it("refuses a duplicate key rather than creating a second badge", async () => {
    db.badge.findUnique.mockResolvedValue({ id: "other", key: "early" });
    await expect(badgesService.create({ key: "early", name: "Early" })).rejects.toThrow();
    expect(db.badge.create).not.toHaveBeenCalled();
  });

  /** A system badge is seeded and something else expects its key to be there. */
  it("refuses to delete a system badge", async () => {
    db.badge.findUnique.mockResolvedValue({ id: "b1", isSystem: true });
    await expect(badgesService.remove("b1")).rejects.toThrow();
    expect(db.badge.delete).not.toHaveBeenCalled();
  });

  it("deletes an ordinary badge", async () => {
    await badgesService.remove("b1");
    expect(db.badge.delete).toHaveBeenCalledWith({ where: { id: "b1" } });
  });

  /** Dropping the file falls back to the glyph; it does not blank the badge. */
  it("clears only the icon when the upload is removed", async () => {
    db.badge.update.mockResolvedValue({ ...CAT, icon: null });
    await badgesService.removeIcon("b1");
    expect(db.badge.update.mock.calls[0]![0].data).toEqual({ icon: null });
  });
});

describe("awarding", () => {
  beforeEach(() => {
    db.user.findUnique.mockResolvedValue({ id: "u1" });
    db.userBadge.findMany.mockResolvedValue([]);
  });

  /**
   * ⚠ An UPSERT, not a create. A badge is held, so granting it twice is the same
   * badge — and the second grant corrects the reason rather than failing, because
   * an admin fixing a typo should not have to revoke first.
   */
  it("grants once, and re-granting updates the reason", async () => {
    await badgesService.award("u1", "b1", "admin1", "For the bug hunt");
    const call = db.userBadge.upsert.mock.calls[0]![0];
    expect(call.where).toEqual({ userId_badgeId: { userId: "u1", badgeId: "b1" } });
    expect(call.update).toEqual({ note: "For the bug hunt" });
    expect(call.create).toEqual({ userId: "u1", badgeId: "b1", awardedById: "admin1", note: "For the bug hunt" });
  });

  it("refuses to award a badge to a user who does not exist", async () => {
    db.user.findUnique.mockResolvedValue(null);
    await expect(badgesService.award("ghost", "b1", "admin1")).rejects.toThrow();
    expect(db.userBadge.upsert).not.toHaveBeenCalled();
  });

  it("refuses to award a badge that does not exist", async () => {
    db.badge.findUnique.mockResolvedValue(null);
    await expect(badgesService.award("u1", "nope", "admin1")).rejects.toThrow();
  });

  /** Revoking something never granted is not an error — the end state is the same. */
  it("revokes without caring whether it was held", async () => {
    await badgesService.revoke("u1", "b1");
    expect(db.userBadge.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1", badgeId: "b1" } });
  });
});

describe("what a card reads", () => {
  it("shapes an award for the card, dates as ISO strings", async () => {
    db.userBadge.findMany.mockResolvedValue([held({ ...CAT, icon: "badges/b1.png" })]);
    const [b] = await badgesService.forUser("u1") as [any];
    expect(b).toEqual({
      id: "b1", key: "early", name: "Early supporter", description: "Was here first",
      icon: "/uploads/badges/b1.png", faIcon: "faStar", color: "#f4b942",
      awardedAt: "2026-01-02T03:04:05.000Z", note: null,
    });
  });

  it("reads a user's badges in card order", async () => {
    db.userBadge.findMany.mockResolvedValue([]);
    await badgesService.forUser("u1");
    expect(db.userBadge.findMany.mock.calls[0]![0].orderBy)
      .toEqual([{ badge: { displayOrder: "asc" } }, { badge: { name: "asc" } }]);
  });

  /**
   * ⚠ Every id asked about is present, holding an empty array when it holds nothing.
   * A caller must be able to tell "this user has no badges" from "I did not ask" —
   * otherwise a card cannot know whether to keep waiting.
   */
  it("answers for every id, including the ones holding nothing", async () => {
    db.userBadge.findMany.mockResolvedValue([held(CAT, "u1")]);
    const out = await badgesService.forUsers(["u1", "u2", "u3"]);
    expect(Object.keys(out).sort()).toEqual(["u1", "u2", "u3"]);
    expect(out.u1).toHaveLength(1);
    expect(out.u2).toEqual([]);
    expect(out.u3).toEqual([]);
  });

  /** An empty page asks the database nothing at all. */
  it("does not query for an empty id list", async () => {
    expect(await badgesService.forUsers([])).toEqual({});
    expect(db.userBadge.findMany).not.toHaveBeenCalled();
  });

  it("reads the whole page in one query", async () => {
    db.userBadge.findMany.mockResolvedValue([]);
    await badgesService.forUsers(["a", "b", "c"]);
    expect(db.userBadge.findMany).toHaveBeenCalledTimes(1);
    expect(db.userBadge.findMany.mock.calls[0]![0].where).toEqual({ userId: { in: ["a", "b", "c"] } });
  });
});
