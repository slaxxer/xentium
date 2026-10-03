import { describe, it, expect } from "vitest";
import {
  applyEdits, changeOf, deltaOf, draftKeys, editsToMatch, effectiveKeys, impliedBy, pruneEdits, summarize,
} from "./permissionsModel";

const saved = new Set(["a", "b"]);

describe("the permissions draft", () => {
  it("records a grant and a revoke as edits, not as a copy", () => {
    const e = applyEdits(applyEdits({}, "g", saved, ["c"], true), "g", saved, ["a"], false);
    expect(e).toEqual({ g: { c: true, a: false } });
    expect([...draftKeys(saved, e.g)].sort()).toEqual(["b", "c"]);
    expect(deltaOf(saved, e.g)).toEqual({ grant: ["c"], revoke: ["a"] });
  });

  it("toggling back leaves the group clean", () => {
    const e = applyEdits(applyEdits({}, "g", saved, ["c"], true), "g", saved, ["c"], false);
    expect(e).toEqual({});
  });

  it("never sends a key it did not touch — a grant made elsewhere survives the save", () => {
    const e = applyEdits({}, "g", saved, ["c"], true);
    const moved = new Set(["a", "b", "x"]); // another admin granted x meanwhile
    expect(deltaOf(moved, e.g)).toEqual({ grant: ["c"], revoke: [] });
    expect(draftKeys(moved, e.g).has("x")).toBe(true);
  });

  it("names the change per key", () => {
    const e = applyEdits({}, "g", saved, ["a"], false);
    expect(changeOf(saved, e.g, "a")).toBe("revoke");
    expect(changeOf(saved, e.g, "b")).toBeNull();
  });

  it("copies another group's set as edits", () => {
    const e = editsToMatch({ g: { z: true } }, "g", saved, new Set(["b", "c"]));
    expect([...draftKeys(saved, e.g)].sort()).toEqual(["b", "c"]);
    expect(deltaOf(saved, e.g)).toEqual({ grant: ["c"], revoke: ["a"] });
  });

  it("prunes edits the server caught up with, and edits for deleted groups", () => {
    const e = { g: { c: true, a: false }, gone: { a: true } };
    const pruned = pruneEdits(e, (id) => (id === "g" ? new Set(["b", "c"]) : undefined));
    expect(pruned).toEqual({});
  });

  it("summarizes across groups", () => {
    const e = { g: { c: true, a: false }, h: { a: true } };
    const s = summarize(e, (id) => (id === "g" ? saved : new Set<string>()));
    expect(s).toEqual({ grants: 2, revokes: 1, groupIds: ["g", "h"] });
  });
});

describe("implied permissions in the ACP", () => {
  it("shows the carried key as implied, not held", () => {
    const held = new Set(["article.edit.any"]);
    expect(impliedBy(held, "article.edit.own")).toBe("article.edit.any");
    expect(impliedBy(held, "article.edit.any")).toBeNull();
    expect(effectiveKeys(held).has("article.edit.own")).toBe(true);
  });

  it("an explicitly held key is not implied", () => {
    expect(impliedBy(new Set(["article.edit.any", "article.edit.own"]), "article.edit.own")).toBeNull();
  });
});
