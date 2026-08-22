/**
 * The rendered DOM contract, and the drop-target resolution that reads it.
 *
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "http://localhost/?__layout=draft" }
 *
 * These two things are one contract: the renderer stamps parentage onto each
 * block's wrapper and the preview bridge navigates by it. Nesting broke exactly
 * this pair — the bridge used to find its drop parent with
 * `closest("[data-nv-region]")` and its siblings with `:scope > [data-nv-block]`,
 * both of which keep working perfectly on a flat document and quietly resolve to
 * the wrong parent and an empty list once anything is nested.
 *
 * So the assertions below run the real bridge functions against DOM the real
 * renderer produced, rather than against a hand-built fixture that could agree
 * with the test while disagreeing with the app.
 *
 * The URL carries `__layout=draft` because the addressing wrappers exist ONLY in
 * the editor preview — the live site gets no extra nodes, which is asserted too.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { cleanup, render } from "@testing-library/react";
import type { BlockNode, LayoutDocument } from "@nodevo/contracts";
import { authStore } from "../lib/authStore";
import { LayoutRegion, LayoutRenderer } from "./LayoutRenderer";
import { setPreviewAudience } from "./useLayout";
import { deregisterBlock, registerBlock } from "./blockRegistry";
import { childrenOf, resolveDropParent } from "./previewBridge";

const TEST_TYPES = ["t.box", "t.row", "t.cell", "t.leaf", "t.boom"];

/** A container renders its children inside a real element, which is the case that
 *  matters: that element sits between the wrapper and the children's wrappers. */
const container = (type: string, className: string, extra: object = {}) =>
  registerBlock({
    type, schema: z.object({}), component: ({ children }) => <div className={className}>{children}</div>,
    container: true,
    editorMeta: { label: type, category: "structure" },
    ...extra,
  });

beforeEach(() => {
  for (const t of TEST_TYPES) deregisterBlock(t);
  container("t.box", "box");
  container("t.row", "row", { childTypes: ["t.cell"] });
  container("t.cell", "cell", { editorMeta: { label: "cell", category: "structure", onlyInside: ["t.row"] } });
  registerBlock({
    type: "t.leaf", schema: z.object({}), component: () => <p className="leaf">leaf</p>,
    editorMeta: { label: "leaf", category: "content" },
  });
  registerBlock({
    type: "t.boom", schema: z.object({}),
    component: () => { throw new Error("block exploded"); },
    editorMeta: { label: "boom", category: "content" },
  });
});

afterEach(cleanup);

const n = (id: string, type: string, children?: BlockNode[]): BlockNode =>
  ({ id, type, props: {}, ...(children ? { children } : {}) });

const doc = (regions: Record<string, BlockNode[]>): LayoutDocument =>
  ({ templateKey: "home", schemaVersion: 1, regions });

/** main: [ box( leafIn, row( cell( deep ) ) ), leafOut ] */
const tree = () =>
  doc({
    main: [
      n("box", "t.box", [
        n("leafIn", "t.leaf"),
        n("row", "t.row", [n("cell", "t.cell", [n("deep", "t.leaf")])]),
      ]),
      n("leafOut", "t.leaf"),
    ],
  });

const wrapper = (id: string) => document.querySelector(`[data-nv-block="${id}"]`) as HTMLElement;
const ids = (els: HTMLElement[]) => els.map((el) => el.dataset.nvBlock).join(",");

describe("LayoutRenderer — preview addressing", () => {
  beforeEach(() => { render(<LayoutRegion document={tree()} region="main" />); });

  it("wraps every block at every depth", () => {
    for (const id of ["box", "leafIn", "row", "cell", "deep", "leafOut"]) {
      expect(wrapper(id), id).toBeTruthy();
    }
  });

  it("stamps the containing block, not the containing region", () => {
    expect(wrapper("box").dataset.nvParent).toBe("");       // region level
    expect(wrapper("leafOut").dataset.nvParent).toBe("");
    expect(wrapper("leafIn").dataset.nvParent).toBe("box");
    expect(wrapper("row").dataset.nvParent).toBe("box");
    expect(wrapper("cell").dataset.nvParent).toBe("row");
    expect(wrapper("deep").dataset.nvParent).toBe("cell");
  });

  it("carries the owning region down to every depth", () => {
    for (const id of ["box", "row", "cell", "deep"]) {
      expect(wrapper(id).dataset.nvRegion, id).toBe("main");
    }
  });

  it("marks containers and only containers", () => {
    expect(wrapper("box").hasAttribute("data-nv-container")).toBe(true);
    expect(wrapper("row").hasAttribute("data-nv-container")).toBe(true);
    expect(wrapper("cell").hasAttribute("data-nv-container")).toBe(true);
    expect(wrapper("leafIn").hasAttribute("data-nv-container")).toBe(false);
    expect(wrapper("leafOut").hasAttribute("data-nv-container")).toBe(false);
  });

  it("keeps the wrapper out of layout entirely", () => {
    // `display: contents` is why the preview matches the live page: the block's
    // own box is still the one its grid or flex parent measures.
    expect(wrapper("box").style.display).toBe("contents");
    expect(wrapper("deep").style.display).toBe("contents");
  });

  it("nests children inside the container's real element", () => {
    const box = document.querySelector(".box") as HTMLElement;
    expect(box.contains(wrapper("leafIn"))).toBe(true);
    expect(box.contains(wrapper("leafOut"))).toBe(false);
    expect((document.querySelector(".cell") as HTMLElement).contains(wrapper("deep"))).toBe(true);
  });

  it("puts the container's element between it and its children", () => {
    // The reason `:scope > [data-nv-block]` finds nothing and parentage has to be
    // stamped rather than derived from the DOM shape.
    expect(wrapper("leafIn").parentElement).not.toBe(wrapper("box"));
    expect(wrapper("leafIn").parentElement!.className).toBe("box");
  });
});

describe("LayoutRenderer — failure rules survive nesting", () => {
  it("skips an unknown nested block and still renders its siblings", () => {
    render(<LayoutRegion document={doc({
      main: [n("box", "t.box", [n("gone", "plugin.retired"), n("leafIn", "t.leaf")])],
    })} region="main" />);
    expect(document.body.textContent).toContain("plugin.retired");  // preview diagnostic
    expect(document.querySelectorAll(".leaf")).toHaveLength(1);
  });

  it("degrades a throwing nested block without taking its siblings down", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<LayoutRegion document={doc({
      main: [n("box", "t.box", [n("bad", "t.boom"), n("leafIn", "t.leaf")])],
    })} region="main" />);
    expect(document.body.textContent).toContain("failed to render");
    expect(document.querySelectorAll(".leaf")).toHaveLength(1);
    spy.mockRestore();
  });

  it("renders an empty container rather than nothing", () => {
    render(<LayoutRegion document={doc({ main: [n("box", "t.box", [])] })} region="main" />);
    expect(document.querySelector(".box")).toBeTruthy();
  });
});

describe("previewBridge — sibling lookup", () => {
  beforeEach(() => { render(<LayoutRegion document={tree()} region="main" />); });

  it("lists a region's own blocks, in order, excluding nested ones", () => {
    expect(ids(childrenOf(null, "main"))).toBe("box,leafOut");
  });

  it("lists a container's direct children only", () => {
    expect(ids(childrenOf("box", "main"))).toBe("leafIn,row");
    expect(ids(childrenOf("cell", "main"))).toBe("deep");
  });

  it("returns nothing for an empty or unknown parent", () => {
    expect(childrenOf("leafOut", "main")).toEqual([]);
    expect(childrenOf("nope", "main")).toEqual([]);
  });

  it("does not leak blocks from another region", () => {
    cleanup();
    render(<LayoutRegion document={doc({
      main:  [n("m", "t.leaf")],
      aside: [n("a", "t.leaf")],
    })} region="main" />);
    expect(ids(childrenOf(null, "main"))).toBe("m");
  });
});

describe("previewBridge — drop parent resolution", () => {
  beforeEach(() => { render(<LayoutRegion document={tree()} region="main" />); });

  const from = (id: string) => wrapper(id);

  it("resolves a leaf's own container, not the outer region", () => {
    // The original bug: `closest("[data-nv-region]")` returned the region here,
    // so dragging inside a section reordered the region instead.
    const hit = resolveDropParent(from("leafIn"), "t.leaf", null);
    expect(hit?.parentId).toBe("box");
    expect(hit?.region).toBe("main");
  });

  it("resolves the region for a block sitting in it", () => {
    expect(resolveDropParent(from("leafOut"), "t.leaf", null)?.parentId).toBeNull();
  });

  it("resolves the deepest container for a deeply nested block", () => {
    expect(resolveDropParent(from("deep"), "t.leaf", null)?.parentId).toBe("cell");
  });

  it("aims INSIDE a hovered container", () => {
    // Documented consequence: the preview cannot place a sibling next to a
    // container. The tree addresses every level explicitly and covers that.
    expect(resolveDropParent(from("box"), "t.leaf", null)?.parentId).toBe("box");
  });

  it("walks past a container that refuses the dragged type", () => {
    // A `t.row` accepts only `t.cell`, so a leaf dragged over it lands in the
    // row's own parent rather than nowhere.
    expect(resolveDropParent(from("row"), "t.leaf", null)?.parentId).toBe("box");
  });

  it("honours a child that may only live in one container", () => {
    // `t.cell` declares onlyInside: ["t.row"], so the box refuses it, the region
    // refuses it too, and the walk runs out — there is no legal home, and saying
    // so is better than dropping it somewhere it may not be.
    expect(resolveDropParent(from("leafIn"), "t.cell", null)).toBeNull();
    expect(resolveDropParent(from("row"), "t.cell", null)?.parentId).toBe("row");
  });

  it("never resolves to the dragged block itself", () => {
    const hit = resolveDropParent(from("box"), "t.box", wrapper("box"));
    expect(hit?.parentId).toBeNull(); // skipped itself, landed in the region
  });

  it("never resolves into the dragged block's own subtree", () => {
    // The cycle: box would end up inside cell, which is inside box.
    const hit = resolveDropParent(from("deep"), "t.box", wrapper("box"));
    expect(hit?.parentId).toBeNull();
  });

  it("returns null outside any region", () => {
    expect(resolveDropParent(document.body, "t.leaf", null)).toBeNull();
  });
});

/**
 * Audiences, and the asymmetry that makes them usable.
 *
 * On the live site a restricted block that excludes the viewer renders nothing. In
 * the EDITOR PREVIEW it always renders — an admin who limits a block to a group
 * they are not in would otherwise watch it vanish with no way to select it and undo.
 */
describe("LayoutRenderer — audiences", () => {
  /** Renders outside preview mode, since that is where hiding happens. */
  const renderLive = (nodes: BlockNode[]) => {
    const search = window.location.search;
    window.history.replaceState({}, "", "/");
    try {
      render(<LayoutRegion document={doc({ main: nodes })} region="main" />);
    } finally {
      window.history.replaceState({}, "", `/${search}`);
    }
  };

  const restricted = (id: string, visibility: BlockNode["visibility"]): BlockNode =>
    ({ id, type: "t.leaf", props: {}, visibility });

  afterEach(() => { authStore.clear(); });

  it("hides a members-only block from a guest", () => {
    renderLive([restricted("m", { audience: "members", groups: [] }), n("leafOut", "t.leaf")]);
    expect(document.querySelectorAll(".leaf")).toHaveLength(1);
  });

  it("shows a members-only block to a signed-in viewer", () => {
    authStore.set("tok", { groups: [{ id: "g-users" }] } as never);
    renderLive([restricted("m", { audience: "members", groups: [] })]);
    expect(document.querySelectorAll(".leaf")).toHaveLength(1);
  });

  it("hides a guests-only block from a signed-in viewer", () => {
    authStore.set("tok", { groups: [] } as never);
    renderLive([restricted("g", { audience: "guests", groups: [] })]);
    expect(document.querySelectorAll(".leaf")).toHaveLength(0);
  });

  it("matches on full group membership", () => {
    authStore.set("tok", { groups: [{ id: "g-users" }, { id: "g-admin" }] } as never);
    renderLive([restricted("s", { audience: "groups", groups: ["g-admin"] })]);
    expect(document.querySelectorAll(".leaf")).toHaveLength(1);
  });

  it("hides when the viewer is in none of the listed groups", () => {
    authStore.set("tok", { groups: [{ id: "g-users" }] } as never);
    renderLive([restricted("s", { audience: "groups", groups: ["g-admin"] })]);
    expect(document.querySelectorAll(".leaf")).toHaveLength(0);
  });

  it("hides a hidden container's whole subtree", () => {
    renderLive([{
      id: "box", type: "t.box", props: {},
      visibility: { audience: "members", groups: [] },
      children: [n("inner", "t.leaf")],
    }]);
    expect(document.querySelector(".box")).toBeNull();
    expect(document.querySelectorAll(".leaf")).toHaveLength(0);
  });

  it("leaves an unrestricted block alone", () => {
    renderLive([n("leafOut", "t.leaf")]);
    expect(document.querySelectorAll(".leaf")).toHaveLength(1);
  });

  it("flags a restricted block in the preview so the DOM says it is conditional", () => {
    // Rendered here because no arrangement is being enforced (no `previewAudience`),
    // which is the `/__theme-preview` case; the editor always sets one.
    render(<LayoutRegion document={doc({
      main: [restricted("g", { audience: "guests", groups: [] })],
    })} region="main" />);
    expect(wrapper("g").dataset.nvRestricted).toBe("guests");
  });

  it("enforces the arrangement the editor is showing, not the real viewer", () => {
    // The preview must hide exactly what the TREE hides, or the two disagree about
    // what the admin is composing.
    setPreviewAudience("guests");
    try {
      render(<LayoutRegion document={doc({
        main: [
          restricted("g", { audience: "guests", groups: [] }),
          restricted("m", { audience: "members", groups: [] }),
        ],
      })} region="main" />);
      expect(wrapper("g")).toBeTruthy();
      expect(wrapper("m")).toBeNull();
    } finally {
      setPreviewAudience(null);
    }
  });

  it("counts a group-restricted block as part of the member arrangement", () => {
    // A concrete viewer would hide it for want of the group, and the tree row would
    // then have no counterpart in the preview.
    setPreviewAudience("members");
    try {
      render(<LayoutRegion document={doc({
        main: [restricted("s", { audience: "groups", groups: ["g-staff"] })],
      })} region="main" />);
      expect(wrapper("s")).toBeTruthy();
    } finally {
      setPreviewAudience(null);
    }
  });

  it("sets no flag on an unrestricted block", () => {
    render(<LayoutRegion document={tree()} region="main" />);
    expect(wrapper("leafOut").hasAttribute("data-nv-restricted")).toBe(false);
  });
});

/**
 * Region ORDER comes from the template, not from the document.
 *
 * The document round-trips through a Postgres `jsonb` column, which normalises
 * object key order — by key length, then bytewise. So a document saved with
 * `header` first comes back with it last, and deriving order from
 * `Object.keys(doc.regions)` put the header region at the bottom of every page that
 * had a stored layout. Nothing but looking at a real page catches that.
 */
describe("LayoutRenderer — region order", () => {
  /** Exactly what jsonb hands back for a four-region template. */
  const jsonbOrder = {
    templateKey: "members" as const,
    schemaVersion: 1,
    regions: {
      main:   [n("m", "t.leaf")],
      aside:  [n("a", "t.leaf")],
      footer: [n("f", "t.leaf")],
      header: [n("h", "t.leaf")],
    },
  };

  // `:not([data-nv-block])` because block wrappers carry `data-nv-region` too —
  // the same distinction the preview bridge's DROP_PARENT selector has to make.
  const domOrder = () =>
    [...document.querySelectorAll("[data-nv-region]:not([data-nv-block])")]
      .map((el) => (el as HTMLElement).dataset.nvRegion);

  it("renders the template's declared order, not the document's key order", () => {
    render(<LayoutRenderer templateKey="members" document={jsonbOrder} />);
    expect(domOrder()).toEqual(["header", "main", "aside", "footer"]);
  });

  it("puts a header block above a main block even when stored last", () => {
    render(<LayoutRenderer templateKey="members" document={jsonbOrder} />);
    const ids = [...document.querySelectorAll("[data-nv-block]")]
      .map((el) => (el as HTMLElement).dataset.nvBlock);
    expect(ids).toEqual(["h", "m", "a", "f"]);
  });

  it("uses the six declared regions of article.detail in order", () => {
    render(<LayoutRenderer templateKey="article.detail" document={{
      templateKey: "article.detail", schemaVersion: 1,
      regions: {
        main: [n("m", "t.leaf")], afterBody: [n("af", "t.leaf")],
        header: [n("h", "t.leaf")], beforeBody: [n("bf", "t.leaf")],
      },
    }} />);
    expect(domOrder()).toEqual(["header", "beforeBody", "main", "afterBody"]);
  });

  it("still honours an explicit regions prop", () => {
    render(<LayoutRenderer templateKey="members" document={jsonbOrder} regions={["aside", "header"]} />);
    expect(domOrder()).toEqual(["aside", "header"]);
  });
});

describe("LayoutRenderer — the live site gets no addressing nodes", () => {
  it("omits the wrappers when not previewing", () => {
    // Same document, no `__layout=draft`: the wrappers exist for the editor only,
    // so the live page carries none of them.
    const search = window.location.search;
    window.history.replaceState({}, "", "/");
    try {
      render(<LayoutRegion document={tree()} region="main" />);
      expect(document.querySelectorAll("[data-nv-block]")).toHaveLength(0);
      // leafIn, deep and leafOut still render — only the addressing is gone.
      expect(document.querySelectorAll(".leaf")).toHaveLength(3);
    } finally {
      window.history.replaceState({}, "", `/${search}`);
    }
  });
});
