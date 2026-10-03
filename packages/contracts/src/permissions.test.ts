import { describe, it, expect } from "vitest";
import { CorePermissions, PERMISSION_IMPLIES, expandImplied, impliersOf } from "./permissions.js";

describe("implied permissions", () => {
  it("adds what a key implies and keeps what was held", () => {
    expect(expandImplied(["article.edit.any", "message.send"]).sort())
      .toEqual(["article.edit.any", "article.edit.own", "message.send"]);
  });

  it("does not duplicate a key held both ways", () => {
    expect(expandImplied(["article.edit.any", "article.edit.own"])).toHaveLength(2);
  });

  it("finds the keys that imply a key", () => {
    expect(impliersOf("article.revisions.view")).toEqual(["article.revisions.restore"]);
    expect(impliersOf("admin.access")).toEqual([]);
  });

  it("names only real core keys, one level deep", () => {
    const core = new Set<string>(Object.values(CorePermissions));
    for (const [from, to] of Object.entries(PERMISSION_IMPLIES)) {
      expect(core.has(from)).toBe(true);
      for (const k of to) {
        expect(core.has(k)).toBe(true);
        // A chain would need expandImplied to iterate to a fixed point.
        expect(PERMISSION_IMPLIES[k]).toBeUndefined();
      }
    }
  });
});
