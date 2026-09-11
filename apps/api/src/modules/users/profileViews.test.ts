/**
 * Profile view recording.
 *
 * Everything worth asserting here is a GUARD. Recording is a write on a read path,
 * so what matters is not that it writes — it is that it declines to: for the owner,
 * for a guest's name, and for the same visitor twice inside the throttle window.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = {
  user:        { update: vi.fn(), findUnique: vi.fn() },
  profileView: { upsert: vi.fn(), findMany: vi.fn(), count: vi.fn() },
};
const store = { sadd: vi.fn(), set: vi.fn() };

vi.mock("../../infrastructure/db.js", () => ({ prisma: db }));
vi.mock("../../infrastructure/redis.js", () => ({
  redis: store,
  rkey:  (...p: string[]) => p.join(":"),
}));
vi.mock("../../infrastructure/storage/LocalStorageProvider.js", () => ({
  storage: { publicUrl: (r: string) => `/uploads/${r}` },
}));

const { recordProfileView, getProfileVisitors } = await import("./profileViews.js");

beforeEach(() => {
  for (const m of Object.values(db)) for (const fn of Object.values(m)) fn.mockReset();
  store.sadd.mockReset(); store.set.mockReset();
  store.sadd.mockResolvedValue(1);
  store.set.mockResolvedValue("OK");
  db.user.findUnique.mockResolvedValue({ profileViewCount: 7 });
});

describe("recording a visit", () => {
  it("records a named visitor and bumps the total", async () => {
    await recordProfileView("profile1", "viewer1", "1.2.3.4");
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "profile1" }, data: { profileViewCount: { increment: 1 } },
    });
    expect(db.profileView.upsert).toHaveBeenCalledOnce();
    const call = db.profileView.upsert.mock.calls[0]![0] as any;
    expect(call.where).toEqual({ profileId_viewerId: { profileId: "profile1", viewerId: "viewer1" } });
    expect(call.update.visits).toEqual({ increment: 1 });
  });

  /** ⚠ Your own profile is not a place you visit. */
  it("records nothing at all for the owner", async () => {
    await recordProfileView("me", "me", "1.2.3.4");
    expect(db.user.update).not.toHaveBeenCalled();
    expect(db.profileView.upsert).not.toHaveBeenCalled();
  });

  /** A guest moves the TOTAL and leaves no name — there is none to leave. */
  it("counts a guest but never lists one", async () => {
    await recordProfileView("profile1", undefined, "1.2.3.4");
    expect(db.user.update).toHaveBeenCalledOnce();
    expect(db.profileView.upsert).not.toHaveBeenCalled();
  });

  /** ⚠ The throttle is why a reload is not a database write. */
  it("skips the row when the visitor was seen inside the window", async () => {
    store.set.mockResolvedValue(null);   // SET NX found the key already there
    await recordProfileView("profile1", "viewer1", "1.2.3.4");
    expect(db.profileView.upsert).not.toHaveBeenCalled();
  });

  /** The all-time total dedupes per IP, exactly as article views do. */
  it("does not re-count an IP that has already been seen", async () => {
    store.sadd.mockResolvedValue(0);
    await recordProfileView("profile1", "viewer1", "1.2.3.4");
    expect(db.user.update).not.toHaveBeenCalled();
    // …but the named visit still refreshes.
    expect(db.profileView.upsert).toHaveBeenCalledOnce();
  });

  it("still records a name when there is no IP to count", async () => {
    await recordProfileView("profile1", "viewer1", undefined);
    expect(db.user.update).not.toHaveBeenCalled();
    expect(db.profileView.upsert).toHaveBeenCalledOnce();
  });

  /**
   * ⚠ A GET must not become a 500 because recording failed. This is the whole
   * reason the function swallows its own errors.
   */
  it("never throws when the store is unavailable", async () => {
    store.sadd.mockRejectedValue(new Error("redis is down"));
    await expect(recordProfileView("profile1", "viewer1", "1.2.3.4")).resolves.toBeUndefined();
  });
});

describe("reading the card", () => {
  const row = (id: string, at: string) => ({
    viewedAt: new Date(at),
    viewer:   { id, username: id, avatar: null },
  });

  it("orders by most recent and reports the newest as `lastAt`", async () => {
    db.profileView.findMany.mockResolvedValue([
      row("a", "2026-09-10T10:00:00.000Z"),
      row("b", "2026-09-09T10:00:00.000Z"),
    ]);
    db.profileView.count.mockResolvedValue(2);

    const out = await getProfileVisitors("profile1", 5);
    expect(db.profileView.findMany.mock.calls[0]![0].orderBy).toEqual({ viewedAt: "desc" });
    expect(out.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(out.lastAt).toBe("2026-09-10T10:00:00.000Z");
  });

  /** ⚠ The total comes from the COUNTER, not from the pruned table. */
  it("reads the all-time total from the user's counter", async () => {
    db.profileView.findMany.mockResolvedValue([row("a", "2026-09-10T10:00:00.000Z")]);
    db.profileView.count.mockResolvedValue(1);
    const out = await getProfileVisitors("profile1", 5);
    expect(out.totalViews).toBe(7);
  });

  it("resolves a stored avatar path to a URL", async () => {
    db.profileView.findMany.mockResolvedValue([
      { viewedAt: new Date(), viewer: { id: "a", username: "a", avatar: "avatars/a.png" } },
    ]);
    db.profileView.count.mockResolvedValue(1);
    const out = await getProfileVisitors("profile1", 5);
    expect(out.items[0]!.avatar).toBe("/uploads/avatars/a.png");
  });

  it("answers with an empty card for a profile nobody has visited", async () => {
    db.profileView.findMany.mockResolvedValue([]);
    db.profileView.count.mockResolvedValue(0);
    const out = await getProfileVisitors("profile1", 5);
    expect(out.items).toEqual([]);
    expect(out.lastAt).toBeNull();
  });
});
