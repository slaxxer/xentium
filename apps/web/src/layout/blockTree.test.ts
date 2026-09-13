/**
 * Block tree operations.
 *
 * Two clusters of risk, both of which pass every other check while being wrong:
 * the index arithmetic of a drop (`toIndex` is stated against the list before the
 * block is lifted out, so a same-list downward move needs compensating), and the
 * recursion once containers exist — a cycle renders until the stack runs out, and
 * a subtree moved into a container carries its own height with it.
 */
import { describe, it, expect } from "vitest";
import type { BlockNode } from "@xentium/contracts";
import {
  canNestInto,
  cloneBlock,
  collectIds,
  containsId,
  countDescendants,
  findNode,
  insertBlock,
  moveBlock,
  removeBlock,
  subtreeHeight,
  updateBlockProps,
  updateBlockVisibility,
  type Regions,
  updateBlockIconOverride,
} from "./blockTree";

const n = (id: string, children?: BlockNode[]): BlockNode => ({
  id,
  type: children ? "section" : "heading",
  props: {},
  ...(children ? { children } : {}),
});

const ids = (list: BlockNode[] | undefined) => (list ?? []).map((b) => b.id).join(",");

const base = (): Regions => ({
  main:   [n("a"), n("b"), n("c")],
  aside:  [n("x")],
  footer: [],
});

/** main: [ sec( p, q ), r ] */
const nested = (): Regions => ({
  main:  [n("sec", [n("p"), n("q")]), n("r")],
  aside: [n("x")],
});

describe("moveBlock — within a list", () => {
  it("moves the first block to the end", () => {
    // Dropping below "c" means index 3 in the pre-move list.
    const r = moveBlock(base(), "a", { region: "main", index: 3 });
    expect(ids(r.main)).toBe("b,c,a");
  });

  it("moves the last block to the front", () => {
    expect(ids(moveBlock(base(), "c", { region: "main", index: 0 }).main)).toBe("c,a,b");
  });

  it("moves down by one", () => {
    expect(ids(moveBlock(base(), "a", { region: "main", index: 2 }).main)).toBe("b,a,c");
  });

  it("moves up by one", () => {
    expect(ids(moveBlock(base(), "c", { region: "main", index: 1 }).main)).toBe("a,c,b");
  });

  it("dropping a block back on itself changes nothing", () => {
    expect(ids(moveBlock(base(), "b", { region: "main", index: 1 }).main)).toBe("a,b,c");
    expect(ids(moveBlock(base(), "b", { region: "main", index: 2 }).main)).toBe("a,b,c");
  });
});

describe("moveBlock — across regions", () => {
  it("moves into another region at an index", () => {
    const r = moveBlock(base(), "b", { region: "aside", index: 0 });
    expect(ids(r.main)).toBe("a,c");
    expect(ids(r.aside)).toBe("b,x");
  });

  it("appends to another region", () => {
    expect(ids(moveBlock(base(), "b", { region: "aside", index: 1 }).aside)).toBe("x,b");
  });

  it("moves into an empty region", () => {
    const r = moveBlock(base(), "a", { region: "footer", index: 0 });
    expect(ids(r.main)).toBe("b,c");
    expect(ids(r.footer)).toBe("a");
  });

  it("moves into a region that does not exist yet", () => {
    const r = moveBlock(base(), "a", { region: "header", index: 0 });
    expect(ids(r.header)).toBe("a");
    expect(ids(r.main)).toBe("b,c");
  });

  it("does NOT apply the same-list shift when the lists differ", () => {
    // The compensation is only correct within one list; applying it across lists
    // would drop the block one slot early.
    expect(ids(moveBlock(base(), "a", { region: "aside", index: 1 }).aside)).toBe("x,a");
  });
});

describe("moveBlock — nesting", () => {
  it("moves a region-level block into a container", () => {
    const r = moveBlock(nested(), "r", { region: "main", parentId: "sec", index: 1 });
    expect(ids(r.main)).toBe("sec");
    expect(ids(r.main![0]!.children)).toBe("p,r,q");
  });

  it("moves a nested block out to the region", () => {
    const r = moveBlock(nested(), "p", { region: "main", index: 0 });
    expect(ids(r.main)).toBe("p,sec,r");
    expect(ids(r.main![1]!.children)).toBe("q");
  });

  it("moves a nested block into another region", () => {
    const r = moveBlock(nested(), "q", { region: "aside", index: 0 });
    expect(ids(r.aside)).toBe("q,x");
    expect(ids(r.main![0]!.children)).toBe("p");
  });

  it("reorders inside a container without touching the region", () => {
    const r = moveBlock(nested(), "q", { region: "main", parentId: "sec", index: 0 });
    expect(ids(r.main![0]!.children)).toBe("q,p");
    expect(ids(r.main)).toBe("sec,r");
  });

  it("emptying a container drops the children array rather than leaving []", () => {
    // Absent and empty render the same, so keeping both shapes would make two
    // equal documents compare unequal — and draft-vs-live status is a stringify.
    let r = moveBlock(nested(), "p", { region: "aside", index: 0 });
    r = moveBlock(r, "q", { region: "aside", index: 0 });
    expect(r.main![0]!.children).toBeUndefined();
  });

  it("moves a whole subtree, children included", () => {
    const r = moveBlock(nested(), "sec", { region: "aside", index: 0 });
    expect(ids(r.aside)).toBe("sec,x");
    expect(ids(r.aside![0]!.children)).toBe("p,q");
    expect(ids(r.main)).toBe("r");
  });
});

describe("moveBlock — refusals", () => {
  it("is a no-op for an unknown id", () => {
    const before = base();
    expect(moveBlock(before, "nope", { region: "aside", index: 0 })).toBe(before);
  });

  it("is a no-op for an unknown parent", () => {
    const before = nested();
    expect(moveBlock(before, "r", { region: "main", parentId: "ghost", index: 0 })).toBe(before);
  });

  it("refuses to nest a container inside itself", () => {
    const before = nested();
    expect(moveBlock(before, "sec", { region: "main", parentId: "sec", index: 0 })).toBe(before);
  });

  it("refuses to nest a container inside its own descendant", () => {
    // The cycle that renders forever: sec would contain p, which contains sec.
    const before = nested();
    expect(moveBlock(before, "sec", { region: "main", parentId: "p", index: 0 })).toBe(before);
  });

  it("refuses a move that would exceed the depth limit", () => {
    // A 3-tall subtree cannot go under a parent already at depth 3 when max is 5.
    const tree: Regions = {
      main: [
        n("l1", [n("l2", [n("l3")])]),          // depths 1,2,3
        n("tall", [n("t2", [n("t3")])]),        // height 3
      ],
    };
    expect(moveBlock(tree, "tall", { region: "main", parentId: "l3", index: 0 }, { maxDepth: 5 }))
      .toBe(tree);
    // One level shallower is fine: 2 + 3 = 5.
    const ok = moveBlock(tree, "tall", { region: "main", parentId: "l2", index: 1 }, { maxDepth: 5 });
    expect(ids(ok.main![0]!.children![0]!.children)).toBe("l3,tall");
  });

  it("clamps an out-of-range index instead of creating holes", () => {
    expect(ids(moveBlock(base(), "a", { region: "aside", index: 99 }).aside)).toBe("x,a");
  });

  it("does not mutate the input", () => {
    const before = nested();
    moveBlock(before, "r", { region: "main", parentId: "sec", index: 0 });
    expect(ids(before.main)).toBe("sec,r");
    expect(ids(before.main![0]!.children)).toBe("p,q");
  });

  it("leaves untouched regions alone", () => {
    expect(moveBlock(base(), "a", { region: "aside", index: 0 }).footer).toEqual([]);
  });
});

describe("insertBlock", () => {
  it("appends at region level", () => {
    expect(ids(insertBlock(base(), n("new"), { region: "main", index: 3 }).main)).toBe("a,b,c,new");
  });

  it("inserts into a container", () => {
    const r = insertBlock(nested(), n("new"), { region: "main", parentId: "sec", index: 1 });
    expect(ids(r.main![0]!.children)).toBe("p,new,q");
  });

  it("materialises a container's first child", () => {
    const r = insertBlock({ main: [n("box")] }, n("new"), { region: "main", parentId: "box", index: 0 });
    expect(ids(r.main![0]!.children)).toBe("new");
  });

  it("refuses a seeded container that would breach the depth limit", () => {
    // A `columns` arrives already two levels tall, so it cannot go at depth 2
    // when the limit is 2.
    const before: Regions = { main: [n("sec", [n("p")])] };
    const seeded = n("cols", [n("c1"), n("c2")]);
    expect(insertBlock(before, seeded, { region: "main", parentId: "sec", index: 0 }, { maxDepth: 2 }))
      .toBe(before);
  });

  it("refuses an unknown parent", () => {
    const before = base();
    expect(insertBlock(before, n("new"), { region: "main", parentId: "ghost", index: 0 })).toBe(before);
  });
});

describe("removeBlock", () => {
  it("removes at region level", () => {
    expect(ids(removeBlock(base(), "b").main)).toBe("a,c");
  });

  it("removes a nested block", () => {
    const r = removeBlock(nested(), "p");
    expect(ids(r.main![0]!.children)).toBe("q");
  });

  it("removes a container together with its children", () => {
    const r = removeBlock(nested(), "sec");
    expect(ids(r.main)).toBe("r");
    expect(findNode(r, "p")).toBeNull();
  });

  it("is a no-op for an unknown id", () => {
    const before = base();
    expect(removeBlock(before, "nope")).toBe(before);
  });
});

describe("updateBlockProps", () => {
  it("updates a nested block", () => {
    const r = updateBlockProps(nested(), "q", { align: "center" });
    expect(findNode(r, "q")!.node.props).toEqual({ align: "center" });
  });

  it("does not mutate the input", () => {
    const before = nested();
    updateBlockProps(before, "q", { align: "center" });
    expect(findNode(before, "q")!.node.props).toEqual({});
  });

  it("is a no-op for an unknown id", () => {
    const before = base();
    expect(updateBlockProps(before, "nope", {})).toBe(before);
  });
});

describe("updateBlockVisibility", () => {
  it("stores a restriction on a nested block", () => {
    const r = updateBlockVisibility(nested(), "q", { audience: "members", groups: [] });
    expect(findNode(r, "q")!.node.visibility).toEqual({ audience: "members", groups: [] });
  });

  it("DELETES the field when set back to everyone", () => {
    // Absent and `{ audience: 'everyone' }` mean the same thing to the renderer, so
    // storing the default would make two identical layouts compare unequal — and
    // draft-vs-live "pending" is a stringify, so a restriction added and removed
    // would leave the draft looking changed forever.
    let r = updateBlockVisibility(nested(), "q", { audience: "members", groups: [] });
    r = updateBlockVisibility(r, "q", { audience: "everyone", groups: [] });
    expect("visibility" in findNode(r, "q")!.node).toBe(false);
  });

  it("treats undefined as clearing the restriction", () => {
    let r = updateBlockVisibility(nested(), "q", { audience: "guests", groups: [] });
    r = updateBlockVisibility(r, "q", undefined);
    expect(findNode(r, "q")!.node.visibility).toBeUndefined();
  });

  it("round-trips to a document identical to the original", () => {
    const before = nested();
    let r = updateBlockVisibility(before, "q", { audience: "members", groups: ["g"] });
    r = updateBlockVisibility(r, "q", undefined);
    expect(JSON.stringify(r)).toBe(JSON.stringify(before));
  });

  it("does not mutate the input", () => {
    const before = nested();
    updateBlockVisibility(before, "q", { audience: "members", groups: [] });
    expect(findNode(before, "q")!.node.visibility).toBeUndefined();
  });

  it("is a no-op for an unknown id", () => {
    const before = base();
    expect(updateBlockVisibility(before, "nope", { audience: "members", groups: [] })).toBe(before);
  });

  it("survives a move — a restriction belongs to the block, not the position", () => {
    let r = updateBlockVisibility(nested(), "r", { audience: "guests", groups: [] });
    r = moveBlock(r, "r", { region: "main", parentId: "sec", index: 0 });
    expect(findNode(r, "r")!.node.visibility).toEqual({ audience: "guests", groups: [] });
    expect(findNode(r, "r")!.parentId).toBe("sec");
  });
});

describe("lookup helpers", () => {
  it("reports depth from the region down", () => {
    expect(findNode(nested(), "sec")!.depth).toBe(1);
    expect(findNode(nested(), "p")!.depth).toBe(2);
  });

  it("reports the parent id", () => {
    expect(findNode(nested(), "p")!.parentId).toBe("sec");
    expect(findNode(nested(), "r")!.parentId).toBeNull();
  });

  it("measures subtree height", () => {
    expect(subtreeHeight(n("leaf"))).toBe(1);
    expect(subtreeHeight(n("s", [n("a"), n("b", [n("c")])]))).toBe(3);
  });

  it("detects containment, including the node itself", () => {
    const sec = nested().main![0]!;
    expect(containsId(sec, "sec")).toBe(true);
    expect(containsId(sec, "q")).toBe(true);
    expect(containsId(sec, "r")).toBe(false);
  });

  it("collects every id across regions and depths", () => {
    expect([...collectIds(nested())].sort()).toEqual(["p", "q", "r", "sec", "x"]);
  });

  it("canNestInto agrees with what moveBlock will accept", () => {
    const tree = nested();
    expect(canNestInto(tree, "r", "sec")).toBe(true);
    expect(canNestInto(tree, "sec", "p")).toBe(false);  // cycle
    expect(canNestInto(tree, "sec", "sec")).toBe(false); // itself
    expect(canNestInto(tree, "r", "ghost")).toBe(false); // absent parent
    expect(canNestInto(tree, "sec", null)).toBe(true);
  });
});

/**
 * Cloning, which duplicate-block is built on.
 *
 * The whole risk is id reuse: a duplicate id silently makes selection and every
 * subsequent move act on whichever node the walk reaches first — the bug class this
 * module exists to prevent — and it is invisible until someone drags the copy.
 */
describe("cloneBlock", () => {
  const nested = (): BlockNode => ({
    id: "root", type: "t.box", props: { width: "wide" },
    visibility: { audience: "groups", groups: ["g1"] },
    children: [
      { id: "a", type: "t.leaf", props: {} },
      { id: "b", type: "t.row", props: {}, children: [{ id: "c", type: "t.cell", props: {} }] },
    ],
  });

  const idsOf = (n: BlockNode): string[] =>
    [n.id, ...(n.children ?? []).flatMap(idsOf)];

  it("gives every node in the subtree a fresh id", () => {
    const original = nested();
    const taken = new Set(idsOf(original));
    const copy = cloneBlock(original, taken);

    const copied = idsOf(copy);
    expect(copied).toHaveLength(4);
    expect(new Set(copied).size).toBe(4);                     // unique within the copy
    for (const id of copied) expect(idsOf(original)).not.toContain(id);
  });

  it("keeps type, props and visibility", () => {
    const copy = cloneBlock(nested(), new Set());
    expect(copy.type).toBe("t.box");
    expect(copy.props).toEqual({ width: "wide" });
    expect(copy.visibility).toEqual({ audience: "groups", groups: ["g1"] });
    expect(copy.children?.[1]?.children?.[0]?.type).toBe("t.cell");
  });

  it("shares no mutable state with the original", () => {
    const original = nested();
    const copy = cloneBlock(original, new Set());
    (copy.props as Record<string, unknown>).width = "narrow";
    copy.visibility!.groups.push("g2");
    expect(original.props).toEqual({ width: "wide" });
    expect(original.visibility!.groups).toEqual(["g1"]);
  });

  it("leaves the original untouched", () => {
    const original = nested();
    const before = JSON.stringify(original);
    cloneBlock(original, new Set(idsOf(original)));
    expect(JSON.stringify(original)).toBe(before);
  });
});

describe("countDescendants", () => {
  // What a delete confirm has to say out loud. `home`'s right rail was a column with
  // five blocks in it, and removing the column removed all six — twice, silently.
  const leaf = (id: string): BlockNode => ({ id, type: "t.leaf", props: {} });

  it("is zero for a block that holds nothing", () => {
    expect(countDescendants(leaf("a"))).toBe(0);
    expect(countDescendants({ ...leaf("a"), children: [] })).toBe(0);
  });

  it("counts a container's direct children", () => {
    const col: BlockNode = { id: "col", type: "t.col", props: {}, children: [leaf("a"), leaf("b")] };
    expect(countDescendants(col)).toBe(2);
  });

  it("counts every level, not just the first", () => {
    // A row holding a column holding three blocks is five gone, not one.
    const row: BlockNode = {
      id: "row", type: "t.row", props: {},
      children: [{
        id: "col", type: "t.col", props: {},
        children: [leaf("a"), leaf("b"), leaf("c")],
      }],
    };
    expect(countDescendants(row)).toBe(4);
  });

  it("does not count the block itself", () => {
    // The confirm says "and N inside it" — including the node would overstate it by
    // one on every container in the tree.
    const col: BlockNode = { id: "col", type: "t.col", props: {}, children: [leaf("a")] };
    expect(countDescendants(col)).toBe(1);
  });
});

describe("icon overrides", () => {
  const tree = (): Regions => ({ body: [{ id: "a", type: "heading", props: {} }] });

  it("stores one override on the block", () => {
    const r = updateBlockIconOverride(tree(), "a", "gear#0", "rocket");
    expect(r.body![0]!.iconOverrides).toEqual({ "gear#0": "rocket" });
  });

  it("keeps other slots when one changes", () => {
    let r = updateBlockIconOverride(tree(), "a", "gear#0", "rocket");
    r = updateBlockIconOverride(r, "a", "star#1", "jelly-regular:heart");
    expect(r.body![0]!.iconOverrides).toEqual({
      "gear#0": "rocket", "star#1": "jelly-regular:heart",
    });
  });

  /**
   * ⚠ THE ABSENCE RULE, twice. Setting an override and clearing it must leave the
   * document byte-identical: "pending" is a `JSON.stringify` comparison, so an empty
   * `{}` left behind lights the publish button up over a round trip that changed
   * nothing.
   */
  it("leaves no trace when the last override is cleared", () => {
    const before = tree();
    let r = updateBlockIconOverride(before, "a", "gear#0", "rocket");
    r = updateBlockIconOverride(r, "a", "gear#0", undefined);
    expect(r.body![0]!.iconOverrides).toBeUndefined();
    expect(JSON.stringify(r)).toBe(JSON.stringify(before));
  });

  it("treats whitespace as clearing", () => {
    let r = updateBlockIconOverride(tree(), "a", "gear#0", "rocket");
    r = updateBlockIconOverride(r, "a", "gear#0", "   ");
    expect(r.body![0]!.iconOverrides).toBeUndefined();
  });

  it("returns the tree untouched for an unknown block", () => {
    const before = tree();
    expect(updateBlockIconOverride(before, "nope", "gear#0", "rocket")).toBe(before);
  });
});
