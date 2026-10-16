/**
 * Guests online and the visitor record.
 *
 * A guest is a keyed hash of IP + browser (never the IP); members and crawlers are not
 * guests. The record only moves up, and survives Redis losing it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const store = { zadd: vi.fn(), zremrangebyscore: vi.fn(), zcount: vi.fn(), get: vi.fn(), set: vi.fn() };
const db = { setting: { findUnique: vi.fn(), upsert: vi.fn() } };

vi.mock("../../infrastructure/redis.js", () => ({ redis: store, rkey: (...p: string[]) => p.join(":") }));
vi.mock("../../infrastructure/db.js", () => ({ prisma: db }));
vi.mock("../../config/env.js", () => ({ env: { COOKIE_SECRET: "test-secret-test-secret" } }));
vi.mock("../middleware/requireAuth.js", () => ({ ONLINE_TTL_MS: 300_000 }));

const { touchGuest, noteRecord, getRecord } = await import("./onlineStats.js");

const req = (over: { userId?: string; ua?: string; ip?: string } = {}) => ({
  userId: over.userId,
  ip: over.ip ?? "203.0.113.7",
  get: (h: string) => (h === "user-agent" ? over.ua ?? "Mozilla/5.0 (X11; Linux) Firefox/131" : undefined),
}) as never;

beforeEach(() => {
  for (const fn of [...Object.values(store), ...Object.values(db.setting)]) fn.mockReset();
  store.zadd.mockResolvedValue(1);
  store.set.mockResolvedValue("OK");
});

describe("a guest", () => {
  it("is stored as a hash, never the IP", async () => {
    await touchGuest(req());
    const [, , id] = store.zadd.mock.calls[0]!;
    expect(id).not.toContain("203.0.113.7");
    expect(String(id)).toHaveLength(22);
  });

  it("is the same visitor on the next poll, a different one on another browser", async () => {
    await touchGuest(req()); await touchGuest(req()); await touchGuest(req({ ua: "Mozilla/5.0 Chrome/130" }));
    const ids = store.zadd.mock.calls.map((c) => c[2]);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  it("is never a signed-in member, or a crawler", async () => {
    await touchGuest(req({ userId: "u1" }));
    await touchGuest(req({ ua: "Mozilla/5.0 (compatible; Googlebot/2.1)" }));
    await touchGuest(req({ ua: "" }));
    expect(store.zadd).not.toHaveBeenCalled();
  });
});

describe("the record", () => {
  it("moves up and is stored both places", async () => {
    store.get.mockResolvedValue(JSON.stringify({ count: 4, at: "2026-10-01T20:00:00.000Z" }));
    const r = await noteRecord(9);
    expect(r?.count).toBe(9);
    expect(store.set).toHaveBeenCalledOnce();
    expect(db.setting.upsert).toHaveBeenCalledOnce();
  });

  it("does not move for a tie or fewer", async () => {
    store.get.mockResolvedValue(JSON.stringify({ count: 4, at: "2026-10-01T20:00:00.000Z" }));
    expect((await noteRecord(4))?.count).toBe(4);
    expect(db.setting.upsert).not.toHaveBeenCalled();
  });

  it("comes back from the database when Redis has lost it", async () => {
    store.get.mockResolvedValue(null);
    db.setting.findUnique.mockResolvedValue({ value: { count: 12, at: "2026-09-01T10:00:00.000Z" } });
    expect(await getRecord()).toEqual({ count: 12, at: "2026-09-01T10:00:00.000Z" });
    expect(store.set).toHaveBeenCalledOnce();
  });
});
