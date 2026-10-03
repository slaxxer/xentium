/**
 * Plugin feed / search items name their author without a group colour; core fills
 * it in so those names get the same colour and glow as every other name.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = { user: { findMany: vi.fn() } };
vi.mock("../../infrastructure/db.js", () => ({ prisma: db }));

const { withAuthorBadgeColors } = await import("./userRef.js");

const colored = (username: string, badgeColor: string | null) =>
  ({ username, groups: [{ group: { progression: badgeColor === null ? null : { badgeColor } } }] });

beforeEach(() => db.user.findMany.mockReset());

describe("withAuthorBadgeColors", () => {
  it("adds each author's primary badge colour, in one query", async () => {
    db.user.findMany.mockResolvedValue([colored("ann", "#f01919"), colored("bob", null)]);
    const out = await withAuthorBadgeColors([
      { id: "1", author: { username: "ann", avatar: null } },
      { id: "2", author: { username: "bob", avatar: null } },
      { id: "3", author: { username: "ann", avatar: null } },
    ]);
    expect(db.user.findMany).toHaveBeenCalledOnce();
    expect(out.map((i) => i.author?.badgeColor)).toEqual(["#f01919", null, "#f01919"]);
  });

  it("leaves unknown authors, authorless items and existing colours alone", async () => {
    db.user.findMany.mockResolvedValue([colored("ann", "#f01919")]);
    const out = await withAuthorBadgeColors([
      { id: "1", author: { username: "ghost", avatar: null } },
      { id: "2", author: null },
      { id: "3", author: { username: "ann", avatar: null, badgeColor: "#00ff00" } },
    ]);
    expect(out[0]!.author).toEqual({ username: "ghost", avatar: null });
    expect(out[1]!.author).toBeNull();
    expect(out[2]!.author?.badgeColor).toBe("#00ff00");
  });

  it("asks nothing when no item has an author", async () => {
    expect(await withAuthorBadgeColors([{ id: "1" }])).toEqual([{ id: "1" }]);
    expect(db.user.findMany).not.toHaveBeenCalled();
  });
});
