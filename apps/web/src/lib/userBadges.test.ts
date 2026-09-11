import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const get = vi.fn();
vi.mock("./api", () => ({ api: { get: (...a: unknown[]) => get(...a) } }));

import { loadUserBadges } from "./userBadges";

function badge(id: string) {
  return { id, key: id, name: id, description: null, icon: null, faIcon: null,
           color: null, awardedAt: "2026-01-01T00:00:00.000Z", note: null };
}

describe("user badge batching", () => {
  beforeEach(() => get.mockReset());
  afterEach(() => vi.restoreAllMocks());

  /**
   * ⚠ The whole point of the loader. A forum thread draws twenty user cards, and a
   * card that fetched its own badges would be twenty requests for one page.
   */
  it("coalesces every request in a tick into ONE call", async () => {
    get.mockResolvedValue({ a: [badge("x")], b: [], c: [badge("y")] });

    const [a, b, c] = await Promise.all([
      loadUserBadges("a"), loadUserBadges("b"), loadUserBadges("c"),
    ]);

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("/user-badges/batch?ids=a,b,c");
    expect(a.map((x) => x.id)).toEqual(["x"]);
    expect(b).toEqual([]);
    expect(c.map((x) => x.id)).toEqual(["y"]);
  });

  /** The same card twice on one page is one id, not two. */
  it("asks for a repeated id once", async () => {
    get.mockResolvedValue({ a: [] });
    await Promise.all([loadUserBadges("a"), loadUserBadges("a"), loadUserBadges("a")]);
    expect(get).toHaveBeenCalledWith("/user-badges/batch?ids=a");
  });

  /** A user the batch answered nothing for holds nothing — not undefined. */
  it("answers an empty array for an id missing from the response", async () => {
    get.mockResolvedValue({});
    await expect(loadUserBadges("ghost")).resolves.toEqual([]);
  });

  /**
   * ⚠ The endpoint refuses more than 100 ids, so a bigger page is SPLIT rather
   * than rejected wholesale — a members directory must not fail to draw badges
   * because it showed 120 people.
   */
  it("splits a batch larger than the endpoint's limit", async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `u${i}`);
    get.mockResolvedValue({});

    await Promise.all(ids.map(loadUserBadges));

    expect(get).toHaveBeenCalledTimes(2);
    expect(String(get.mock.calls[0]![0]).split(",")).toHaveLength(100);
    expect(String(get.mock.calls[1]![0]).split(",")).toHaveLength(50);
  });

  /** A second render pass is a second batch, not a replay of the first. */
  it("starts a fresh batch after the previous one flushes", async () => {
    get.mockResolvedValue({ a: [], z: [] });
    await loadUserBadges("a");
    await loadUserBadges("z");
    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenLastCalledWith("/user-badges/batch?ids=z");
  });
});
