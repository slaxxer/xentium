/**
 * The badge sweep.
 *
 * ⚠ What matters is what it declines to do. A sweep that over-grants puts a badge on
 * every card those members appear on, and no admin will hunt them down one by one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = {
  badge:     { findMany: vi.fn() },
  user:      { findMany: vi.fn() },
  userBadge: { findMany: vi.fn(), upsert: vi.fn() },
};
const meets = vi.fn();
const dispatch = vi.fn();

vi.mock("../../infrastructure/db.js", () => ({ prisma: db }));
vi.mock("../../core/badge-registry/badge-criteria-registry.js", () => ({
  badgeCriteriaRegistry: { meets: (...a: unknown[]) => meets(...a) },
}));
vi.mock("../../modules/notifications/notification.service.js", () => ({
  notificationService: { dispatch: (...a: unknown[]) => dispatch(...a) },
}));

const { runAwardBadges } = await import("./awardBadges.js");

const ctx = { dryRun: false } as never;
const dry = { dryRun: true } as never;

beforeEach(() => {
  for (const m of Object.values(db)) for (const fn of Object.values(m)) fn.mockReset();
  meets.mockReset().mockResolvedValue(true);
  dispatch.mockReset().mockResolvedValue(undefined);
  db.user.findMany.mockResolvedValue([
    { id: "u1", username: "ann" }, { id: "u2", username: "bob" },
  ]);
  db.userBadge.findMany.mockResolvedValue([]);
  db.userBadge.upsert.mockResolvedValue({});
});

describe("the badge sweep", () => {
  it("grants an earned badge, marked as the sweep's doing", async () => {
    db.badge.findMany.mockResolvedValue([{ id: "b1", name: "Prolific", criteria: { articles: 10 } }]);
    const out = await runAwardBadges({ batch: 500 }, ctx);
    expect(out.changed).toBe(2);
    expect(db.userBadge.upsert).toHaveBeenCalledTimes(2);
    expect(db.userBadge.upsert.mock.calls[0]![0].create).toEqual({
      userId: "u1", badgeId: "b1", auto: true,
    });
  });

  /** ⚠ A give-away badge must never be handed out by a job. */
  it("only considers badges with the reward system switched on", async () => {
    db.badge.findMany.mockResolvedValue([]);
    const out = await runAwardBadges({ batch: 500 }, ctx);
    expect(db.badge.findMany.mock.calls[0]![0].where).toEqual({ autoAward: true });
    expect(out.changed).toBe(0);
  });

  it("skips members who already hold it", async () => {
    db.badge.findMany.mockResolvedValue([{ id: "b1", name: "Prolific", criteria: { articles: 10 } }]);
    db.userBadge.findMany.mockResolvedValue([{ userId: "u1" }]);
    const out = await runAwardBadges({ batch: 500 }, ctx);
    expect(out.changed).toBe(1);
    expect(db.userBadge.upsert.mock.calls[0]![0].create.userId).toBe("u2");
  });

  it("grants nothing to a member who falls short", async () => {
    db.badge.findMany.mockResolvedValue([{ id: "b1", name: "Prolific", criteria: { articles: 10 } }]);
    meets.mockResolvedValue(false);
    const out = await runAwardBadges({ batch: 500 }, ctx);
    expect(out.changed).toBe(0);
    expect(db.userBadge.upsert).not.toHaveBeenCalled();
  });

  /** ⚠ Belt and braces with the registry's own guard: no thresholds, no award. */
  it("ignores a badge that has no thresholds at all", async () => {
    db.badge.findMany.mockResolvedValue([{ id: "b1", name: "Empty", criteria: {} }]);
    const out = await runAwardBadges({ batch: 500 }, ctx);
    expect(db.userBadge.upsert).not.toHaveBeenCalled();
    expect(out.changed).toBe(0);
  });

  /** A dry run reports and writes nothing — the contract every action here keeps. */
  it("writes nothing on a dry run", async () => {
    db.badge.findMany.mockResolvedValue([{ id: "b1", name: "Prolific", criteria: { articles: 10 } }]);
    const out = await runAwardBadges({ batch: 500 }, dry);
    expect(db.userBadge.upsert).not.toHaveBeenCalled();
    expect(out.changed).toBe(0);
    expect(out.summary).toContain("would grant");
  });

  /**
   * Deactivated accounts are not quietly collecting badges.
   *
   * ⚠ `isActive` ALONE. This test previously asserted `deletedAt: null` as well —
   * asserting my own wrong assumption, since `User` has no such field. Prisma only
   * complains at run time, so a mocked test agreed with the bug all the way to a
   * failed job.
   */
  it("looks only at active members", async () => {
    db.badge.findMany.mockResolvedValue([{ id: "b1", name: "Prolific", criteria: { articles: 10 } }]);
    await runAwardBadges({ batch: 500 }, ctx);
    expect(db.user.findMany.mock.calls[0]![0].where).toEqual({ isActive: true });
  });
});

/**
 * A badge nobody is told about is a badge nobody knows they earned.
 *
 * ⚠ The point of these three is the ORDER OF PRIORITY: granting is the job, telling
 * is the courtesy. Everything here checks that the courtesy cannot cost the job.
 */
describe("telling the member", () => {
  const BADGE = { id: "b1", name: "Prolific", criteria: { articles: 10 } };

  it("notifies each member it just granted to, linking their own profile", async () => {
    db.badge.findMany.mockResolvedValue([BADGE]);
    await runAwardBadges({ batch: 500 }, ctx);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls[0]![0]).toMatchObject({
      userId: "u1",
      type:   "badge.earned",   // ⚠ matched by the "badge.*" preference pattern
      link:   "/u/ann",
    });
    expect(dispatch.mock.calls[0]![0].title).toContain("Prolific");
  });

  /** The sweep is not a mailing list — a dry run tells nobody anything. */
  it("says nothing on a dry run", async () => {
    db.badge.findMany.mockResolvedValue([BADGE]);
    await runAwardBadges({ batch: 500 }, dry);
    expect(dispatch).not.toHaveBeenCalled();
  });

  /**
   * ⚠ The badge is granted either way. If a failed notification threw, the run would
   * abort part-way and the next one would re-examine members it had already granted
   * to — and the member would have the badge with no idea it arrived.
   */
  it("grants anyway when the notification fails", async () => {
    db.badge.findMany.mockResolvedValue([BADGE]);
    dispatch.mockRejectedValue(new Error("redis is down"));
    const out = await runAwardBadges({ batch: 500 }, ctx);
    expect(out.changed).toBe(2);
    expect(db.userBadge.upsert).toHaveBeenCalledTimes(2);
  });
});
