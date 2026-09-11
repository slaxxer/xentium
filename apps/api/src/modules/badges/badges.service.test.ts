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
  userBadge: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  user:      { findUnique: vi.fn() },
};
const dispatch = vi.fn();
vi.mock("../../infrastructure/db.js", () => ({ prisma: db }));
vi.mock("../notifications/notification.service.js", () => ({
  notificationService: { dispatch: (...a: unknown[]) => dispatch(...a) },
}));

const { badgesService } = await import("./badges.service.js");

const CAT: {
  id: string; key: string; name: string; description: string | null;
  faIcon: string | null; color: string | null;
  displayOrder: number; isSystem: boolean;
} = {
  id: "b1", key: "early", name: "Early supporter", description: "Was here first",
  faIcon: "faStar", color: "#f4b942", displayOrder: 100, isSystem: false,
};

function held(badge = CAT, userId = "u1", auto = false) {
  return { userId, awardedAt: new Date("2026-01-02T03:04:05.000Z"), note: null, auto, badge };
}

beforeEach(() => {
  for (const model of Object.values(db)) for (const fn of Object.values(model)) fn.mockReset();
  dispatch.mockReset().mockResolvedValue(undefined);
  db.badge.findUnique.mockResolvedValue({ id: "b1", name: "Early supporter", isSystem: false });
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

  it("carries the holder count through to the row", async () => {
    db.badge.findMany.mockResolvedValue([{ ...CAT, _count: { users: 3 } }]);
    const [row] = await badgesService.list() as [any];
    expect(row.holders).toBe(3);
    expect(row.faIcon).toBe("faStar");
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
});

describe("awarding", () => {
  beforeEach(() => {
    db.user.findUnique.mockResolvedValue({ id: "u1", username: "ann" });
    db.userBadge.findMany.mockResolvedValue([]);
    db.userBadge.findUnique.mockResolvedValue(null);   // not held yet
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

  /**
   * A badge handed over in silence is one the member may never notice.
   *
   * ⚠ `badge.granted`, not `badge.earned` — both match the one "badge.*" preference,
   * but the stored type still says how it was come by.
   */
  it("tells the member, linking their own profile", async () => {
    await badgesService.award("u1", "b1", "admin1");
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]![0]).toMatchObject({
      userId: "u1", type: "badge.granted", link: "/u/ann",
    });
    expect(dispatch.mock.calls[0]![0].title).toContain("Early supporter");
  });

  /** The reason is already public on the card, and it is the part they care about. */
  it("passes the admin's reason along as the body", async () => {
    await badgesService.award("u1", "b1", "admin1", "  For the bug hunt  ");
    expect(dispatch.mock.calls[0]![0].body).toBe("For the bug hunt");
  });

  /**
   * ⚠ THE POINT of reading before the upsert. Re-granting is how an admin corrects a
   * note; pinging the member for every typo fix is how a bell stops being worth
   * opening.
   */
  it("says nothing when the badge was already held", async () => {
    db.userBadge.findUnique.mockResolvedValue({ userId: "u1" });
    await badgesService.award("u1", "b1", "admin1", "Corrected reason");
    expect(db.userBadge.upsert).toHaveBeenCalledTimes(1);   // still updates the note
    expect(dispatch).not.toHaveBeenCalled();
  });

  /** An admin who just granted themselves a badge in the ACP already knows. */
  it("does not notify an admin who granted it to themselves", async () => {
    await badgesService.award("u1", "b1", "u1");
    expect(dispatch).not.toHaveBeenCalled();
  });

  /** ⚠ Telling is the courtesy; granting is the job, and it must not fail with it. */
  it("grants anyway when the notification fails", async () => {
    dispatch.mockRejectedValue(new Error("redis is down"));
    await expect(badgesService.award("u1", "b1", "admin1")).resolves.toBeDefined();
    expect(db.userBadge.upsert).toHaveBeenCalledTimes(1);
  });

  /** Revoking something never granted is not an error — the end state is the same. */
  it("revokes without caring whether it was held", async () => {
    await badgesService.revoke("u1", "b1");
    expect(db.userBadge.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1", badgeId: "b1" } });
  });
});

describe("what a card reads", () => {
  /** ⚠ Both are real awards; the difference is only who decided. */
  it("says whether an award was earned or handed over", async () => {
    db.userBadge.findMany.mockResolvedValue([held(CAT, "u1", true)]);
    const [b] = await badgesService.forUser("u1") as [any];
    expect(b.source).toBe("earned");
  });

  it("shapes an award for the card, dates as ISO strings", async () => {
    db.userBadge.findMany.mockResolvedValue([held(CAT)]);
    const [b] = await badgesService.forUser("u1") as [any];
    expect(b).toEqual({
      id: "b1", key: "early", name: "Early supporter", description: "Was here first",
      faIcon: "faStar", color: "#f4b942",
      awardedAt: "2026-01-02T03:04:05.000Z", note: null,
      source: "manual",
    });
  });

  it("reads a user's badges in card order", async () => {
    db.userBadge.findMany.mockResolvedValue([]);
    await badgesService.forUser("u1");
    expect(db.userBadge.findMany.mock.calls[0]![0].orderBy)
      .toEqual([{ badge: { displayOrder: "asc" } }, { badge: { name: "asc" } }]);
  });


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
