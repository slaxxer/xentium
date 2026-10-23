/**
 * The sections model (ADR-0012). The two promises worth pinning down: changing a
 * section's columns never loses a block, and the change marks name the one block
 * that changed rather than everything after it.
 */
import { describe, it, expect } from "vitest";
import type { BlockNode } from "@xentium/contracts";
import { findNode, type Regions } from "./blockTree";
import {
  buildPreset, layoutChanges, sectionKind, sectionLanes, sectionLayoutOf, setSectionLayout,
  SECTION_PRESETS, type PresetText,
} from "./sections";

const leaf = (id: string): BlockNode => ({ id, type: "heading", props: { text: id } });
const col = (id: string, width: string, children: BlockNode[]): BlockNode =>
  ({ id, type: "column", props: { width, sticky: true }, ...(children.length ? { children } : {}) });
const isContainer = (t: string) => ["section", "columns", "column", "guestSurface"].includes(t);

const words: PresetText = {
  eyebrow: "E", title: "T", body: "B", featureTitle: "F", featureBody: "FB", ctaTitle: "C", ctaBody: "CB",
};

/** Every leaf id in a subtree, in order. */
const leaves = (n: BlockNode): string[] =>
  n.children?.length ? n.children.flatMap(leaves) : n.type === "heading" ? [n.id] : [];

describe("sectionKind / sectionLayoutOf", () => {
  it("names what sits at the top of a region", () => {
    expect(sectionKind({ id: "s", type: "section", props: {} }, isContainer)).toBe("section");
    expect(sectionKind({ id: "c", type: "columns", props: {} }, isContainer)).toBe("columns");
    expect(sectionKind(leaf("h"), isContainer)).toBe("block");
    expect(sectionKind({ id: "g", type: "guestSurface", props: {} }, isContainer)).toBe("group");
  });

  it("reads the five shapes and refuses to name anything else", () => {
    const s = (cols: BlockNode[]): BlockNode =>
      ({ id: "s", type: "section", props: {}, children: [{ id: "r", type: "columns", props: {}, children: cols }] });
    expect(sectionLayoutOf({ id: "s", type: "section", props: {}, children: [leaf("a")] })).toBe("one");
    expect(sectionLayoutOf(s([col("a", "1", []), col("b", "1", [])]))).toBe("half");
    expect(sectionLayoutOf(s([col("a", "2", []), col("b", "1", [])]))).toBe("twoOne");
    expect(sectionLayoutOf(s([col("a", "1", []), col("b", "1", []), col("c", "1", [])]))).toBe("three");
    expect(sectionLayoutOf(s([col("a", "sidebar", []), col("b", "1", [])]))).toBeNull();
  });
});

describe("setSectionLayout", () => {
  const three = (): Regions => ({
    main: [{ id: "s", type: "section", props: {}, children: [{ id: "r", type: "columns", props: { gap: "lg" }, children: [
      col("c1", "1", [leaf("a")]), col("c2", "1", [leaf("b")]), col("c3", "1", [leaf("c"), leaf("d")]),
    ] }] }],
  });

  it("keeps every block when columns are taken away, stacked into the last one", () => {
    const next = setSectionLayout(three(), "s", "half");
    const s = findNode(next, "s")!.node;
    expect(sectionLayoutOf(s)).toBe("half");
    expect(leaves(s)).toEqual(["a", "b", "c", "d"]);
    expect(sectionLanes(s).map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(findNode(next, "c2")!.node.props.sticky).toBe(true); // other props survive
  });

  it("unwraps to a plain section for one column, and wraps again for two", () => {
    const one = setSectionLayout(three(), "s", "one");
    const s = findNode(one, "s")!.node;
    expect(s.children!.map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
    const two = setSectionLayout(one, "s", "oneTwo");
    const t = findNode(two, "s")!.node;
    expect(sectionLayoutOf(t)).toBe("oneTwo");
    expect(sectionLanes(t)[0]!.children!.map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
    expect(sectionLanes(t)[1]!.children).toBeUndefined();
  });

  it("keeps the row's own id and gap when re-weighting", () => {
    const w = setSectionLayout(setSectionLayout(three(), "s", "half"), "s", "twoOne");
    expect(findNode(w, "r")!.node.props.gap).toBe("lg");
  });

  it("refuses for anything but a section or a row, and for the shape it already has", () => {
    const r = three();
    expect(setSectionLayout(r, "a", "half")).toBe(r);
    expect(setSectionLayout(r, "s", "three")).toBe(r);
  });

  it("re-shapes a bare top-level row without wrapping it", () => {
    const r: Regions = { main: [{ id: "r", type: "columns", props: {}, children: [col("x", "1", [leaf("a")]), col("y", "1", [leaf("b")])] }] };
    const next = setSectionLayout(r, "r", "three");
    const row = findNode(next, "r")!.node;
    expect(row.type).toBe("columns");
    expect(row.children!.length).toBe(3);
    expect(leaves(row)).toEqual(["a", "b"]);
  });
});

describe("buildPreset", () => {
  it("builds every preset with fresh, unique ids that avoid the taken ones", () => {
    const taken = new Set(["bfixed"]);
    const ids: string[] = [];
    const walk = (n: BlockNode) => { ids.push(n.id); n.children?.forEach(walk); };
    for (const p of SECTION_PRESETS) {
      const node = buildPreset(p, words, taken);
      expect(node.type).toBe("section");
      walk(node);
    }
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain("bfixed");
  });

  it("matches the shape the library tile draws", () => {
    expect(sectionLayoutOf(buildPreset("features", words, new Set()))).toBe("three");
    expect(sectionLayoutOf(buildPreset("hero", words, new Set()))).toBe("half");
    expect(buildPreset("callToAction", words, new Set()).variant).toBe("accent");
  });
});

describe("layoutChanges", () => {
  const live = (): Regions => ({ main: [leaf("a"), leaf("b"), leaf("c"), leaf("d")] });

  it("marks only the new block, not everything below it", () => {
    const draft: Regions = { main: [leaf("new"), ...live().main!] };
    const { changed, removed } = layoutChanges(draft, live());
    expect([...changed]).toEqual(["new"]);
    expect(removed).toEqual([]);
  });

  it("marks the block that moved, not the ones it passed", () => {
    const [a, b, c, d] = live().main!;
    const { changed } = layoutChanges({ main: [b!, c!, d!, a!] }, live());
    expect([...changed]).toEqual(["a"]);
  });

  it("marks an edited block, and lists a removed subtree once by its outermost node", () => {
    const before: Regions = { main: [{ id: "s", type: "section", props: {}, children: [leaf("x"), leaf("y")] }, leaf("z")] };
    const after: Regions = { main: [{ ...leaf("z"), props: { text: "Z!" } }] };
    const { changed, removed } = layoutChanges(after, before);
    expect([...changed]).toEqual(["z"]);
    expect(removed.map((r) => [r.node.id, r.region, r.parentId, r.index])).toEqual([["s", "main", null, 0]]);
  });

  it("counts a new section once, not once per block inside it", () => {
    const fresh: BlockNode = { id: "n", type: "section", props: {}, children: [leaf("n1"), leaf("n2")] };
    expect([...layoutChanges({ main: [...live().main!, fresh] }, live()).changed]).toEqual(["n"]);
  });

  it("does not mark a section whose child was edited", () => {
    const before: Regions = { main: [{ id: "s", type: "section", props: {}, children: [leaf("x")] }] };
    const after: Regions = { main: [{ id: "s", type: "section", props: {}, children: [{ ...leaf("x"), props: { text: "!" } }] }] };
    expect([...layoutChanges(after, before).changed]).toEqual(["x"]);
  });
});
