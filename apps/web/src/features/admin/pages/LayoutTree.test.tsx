/**
 * The structure tree's recursive rendering and the intent it reports.
 *
 * @vitest-environment jsdom
 *
 * The tree is the complete interface — the preview is only the fast one — so a
 * block has to be reachable and every action has to address the right node at any
 * depth. The pure tree operations are covered in `layout/blockTree.test.ts`; what
 * is tested here is the WIRING, which is where this build's bugs have historically
 * been: an action bound to the wrong id, a control offered where it should not be,
 * or an indicator drawn at the wrong level.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { cleanup, render, fireEvent, screen } from "@testing-library/react";
import type { BlockNode } from "@nodevo/contracts";
import { deregisterBlock, registerBlock } from "../../../layout/blockRegistry";
import { BlockList, BlockPicker, type TreeCtx } from "./LayoutTree";

const TEST_TYPES = ["t.box", "t.row", "t.cell", "t.leaf"];
const noop = () => null;

beforeEach(() => {
  for (const type of TEST_TYPES) deregisterBlock(type);
  registerBlock({
    type: "t.box", schema: z.object({}), component: noop, container: true,
    editorMeta: { label: "Box", category: "structure" },
  });
  registerBlock({
    type: "t.row", schema: z.object({}), component: noop, container: true, childTypes: ["t.cell"],
    editorMeta: { label: "Row", category: "structure" },
  });
  registerBlock({
    type: "t.cell", schema: z.object({}), component: noop, container: true,
    editorMeta: { label: "Cell", category: "structure", onlyInside: ["t.row"] },
  });
  registerBlock({
    type: "t.leaf", schema: z.object({}), component: noop,
    editorMeta: { label: "Leaf", category: "content" },
  });
});

afterEach(cleanup);

const n = (id: string, type: string, children?: BlockNode[]): BlockNode =>
  ({ id, type, props: {}, ...(children ? { children } : {}) });

/** main: [ box( leafIn, row( cell ) ), leafOut ] */
const tree = (): BlockNode[] => [
  n("box", "t.box", [n("leafIn", "t.leaf"), n("row", "t.row", [n("cell", "t.cell")])]),
  n("leafOut", "t.leaf"),
];

function ctxWith(over: Partial<TreeCtx> = {}): TreeCtx {
  return {
    // The tree only ever renders keys, so echoing them keeps assertions readable
    // without standing up an i18n instance.
    t: ((key: string) => key) as unknown as TreeCtx["t"],
    templateKey: "home",
    selectedId: null,
    dragId: null,
    dropAt: null,
    adding: null,
    required: new Set<string>(),
    audience: "members",
    select: vi.fn(),
    startDrag: vi.fn(),
    endDrag: vi.fn(),
    hover: vi.fn(),
    drop: vi.fn(),
    closeAdd: vi.fn(),
    duplicate: vi.fn(),
    nudge: vi.fn(),
    remove: vi.fn(),
    toggleAdd: vi.fn(),
    add: vi.fn(),
    ...over,
  };
}

const renderTree = (over: Partial<TreeCtx> = {}, nodes = tree()) => {
  const ctx = ctxWith(over);
  const view = render(
    <BlockList nodes={nodes} region="main" parentId={null} depth={1} ctx={ctx} />,
  );
  return { ctx, view };
};

/** A row by block id — two blocks can share a label, ids cannot. */
const row = (id: string): HTMLElement =>
  document.querySelector(`.lay__node[data-block-id="${id}"]`) as HTMLElement;

const labelOf = (id: string) => row(id).querySelector(".lay__node-label")!.textContent;
const depthOf = (el: HTMLElement) => el.style.getPropertyValue("--lay-depth");

/** A row's action button by its accessible name. */
const action = (id: string, name: string): HTMLButtonElement =>
  row(id).querySelector(`.lay__node-actions [aria-label="${name}"]`) as HTMLButtonElement;

const UP = "layoutEditor.moveUp";
const DOWN = "layoutEditor.moveDown";
const DELETE = "layoutEditor.removeBlock";
const ADD_INSIDE = "layoutEditor.addInside";

describe("recursive rendering", () => {
  it("renders every block at every depth", () => {
    renderTree();
    for (const id of ["box", "leafIn", "row", "cell", "leafOut"]) {
      expect(row(id), id).toBeTruthy();
    }
    expect(labelOf("cell")).toBe("Cell");
  });

  it("indents each level, so a 300px rail stays readable", () => {
    renderTree();
    expect(depthOf(row("box"))).toBe("1");
    expect(depthOf(row("leafIn"))).toBe("2");
    expect(depthOf(row("row"))).toBe("2");
    expect(depthOf(row("cell"))).toBe("3");
  });

  it("marks containers so they read as headings for the rows beneath", () => {
    renderTree();
    expect(row("box").className).toContain("is-container");
    expect(row("row").className).toContain("is-container");
    expect(row("leafIn").className).not.toContain("is-container");
  });

  it("gives an empty container its own placeholder, not the region's", () => {
    renderTree({}, [n("box", "t.box", [])]);
    expect(screen.getByText("layoutEditor.emptyContainer")).toBeTruthy();
  });

  it("uses the region placeholder when the region itself is empty", () => {
    renderTree({}, []);
    expect(screen.getByText("layoutEditor.emptyRegion")).toBeTruthy();
  });

  it("labels a block whose plugin is gone without dropping it from the tree", () => {
    // Disabling a plugin must never delete layout an admin built.
    renderTree({}, [n("ghost", "plugin.retired")]);
    const el = screen.getByText(/plugin\.retired/).closest(".lay__node") as HTMLElement;
    expect(el.className).toContain("is-missing");
  });
});

describe("actions address the right node", () => {
  it("selects the clicked block, at any depth", () => {
    const { ctx } = renderTree();
    fireEvent.click(row("cell"));
    expect(ctx.select).toHaveBeenCalledWith("cell");
  });

  it("nudges by id, within the block's own list", () => {
    const { ctx } = renderTree();
    // row is second of box's two children: it can go up, but not down.
    expect(action("row", UP).disabled).toBe(false);
    expect(action("row", DOWN).disabled).toBe(true);
    fireEvent.click(action("row", UP));
    expect(ctx.nudge).toHaveBeenCalledWith("row", -1);
  });

  it("disables the nudge that would leave the list", () => {
    const { ctx } = renderTree();
    expect(action("cell", UP).disabled).toBe(true);    // only child of row
    expect(action("cell", DOWN).disabled).toBe(true);
    fireEvent.click(action("cell", UP));
    expect(ctx.nudge).not.toHaveBeenCalled();
  });

  it("bounds the nudge to siblings, not to the whole document", () => {
    const { ctx } = renderTree();
    // leafIn is FIRST inside box, so "up" is disabled even though another block
    // precedes it in document order. Bounding this by the region instead of the
    // parent list is the mistake that only shows up once blocks nest.
    expect(action("leafIn", UP).disabled).toBe(true);
    expect(action("leafIn", DOWN).disabled).toBe(false);
    // leafOut is LAST at region level.
    expect(action("leafOut", DOWN).disabled).toBe(true);
    fireEvent.click(action("leafIn", DOWN));
    expect(ctx.nudge).toHaveBeenCalledWith("leafIn", 1);
  });

  it("removes by id", () => {
    const { ctx } = renderTree();
    fireEvent.click(action("cell", DELETE));
    expect(ctx.remove).toHaveBeenCalledWith("cell");
  });

  it("offers no delete for a required block, at any depth", () => {
    // Required chrome blocks may be MOVED anywhere, including into a container,
    // but never removed — a header with no way in is a locked door.
    renderTree({ required: new Set(["t.cell"]) });
    expect(action("cell", DELETE)).toBeNull();
    expect(action("leafIn", DELETE)).toBeTruthy();
  });

  it("keeps a row's own click from also selecting its container", () => {
    const { ctx } = renderTree();
    fireEvent.click(row("cell"));
    expect(ctx.select).toHaveBeenCalledTimes(1);
    expect(ctx.select).toHaveBeenCalledWith("cell");
  });
});

describe("adding into a container", () => {
  it("offers an add control on containers only", () => {
    renderTree();
    expect(action("box", ADD_INSIDE)).toBeTruthy();
    expect(action("cell", ADD_INSIDE)).toBeTruthy();
    expect(action("leafIn", ADD_INSIDE)).toBeNull();
  });

  it("opens the picker keyed to that specific container", () => {
    const { ctx } = renderTree();
    fireEvent.click(action("row", ADD_INSIDE));
    expect(ctx.toggleAdd).toHaveBeenCalledWith("c:row");
  });

  it("adds into the container, not the region", () => {
    const { ctx } = renderTree({ adding: "c:box" });
    fireEvent.click(screen.getByText("Leaf", { selector: ".lay__picker-item b" }));
    expect(ctx.add).toHaveBeenCalledWith("t.leaf", "main", "box");
  });

  it("offers only what the container accepts", () => {
    // t.row declares childTypes: ["t.cell"].
    renderTree({ adding: "c:row" });
    const offered = [...document.querySelectorAll(".lay__picker-item b")].map((b) => b.textContent);
    expect(offered).toEqual(["Cell"]);
  });

  it("keeps a container-only block out of a region's picker", () => {
    // t.cell declares onlyInside: ["t.row"], so a region must not offer it.
    render(<BlockPicker templateKey="home" depth={1} t={ctxWith().t} onPick={vi.fn()} onClose={vi.fn()} />);
    const offered = [...document.querySelectorAll(".lay__picker-item b")].map((b) => b.textContent);
    expect(offered).toContain("Leaf");
    expect(offered).not.toContain("Cell");
  });

  it("indents the picker to the level it will add at", () => {
    renderTree({ adding: "c:row" });
    expect((document.querySelector(".lay__picker") as HTMLElement).style.getPropertyValue("--lay-depth"))
      .toBe("3");
  });
});

/**
 * The audience axis: "Home × Guests" is a place to compose the guest arrangement.
 *
 * The hazard is indices. Every move goes through `moveBlock` with a position in the
 * REAL list, so filtering the array to what is in view would land each drag one slot
 * from where it was aimed. Rows are therefore skipped, not filtered.
 */
describe("the audience axis", () => {
  const withAudience = (nodes: BlockNode[], id: string, audience: string): BlockNode[] =>
    nodes.map((n) => (n.id === id ? { ...n, visibility: { audience, groups: [] } as never } : n));

  /** main: [ guestOnly, plain, memberOnly ] */
  const mixed = (): BlockNode[] => {
    let nodes = [n("guestOnly", "t.leaf"), n("plain", "t.leaf"), n("memberOnly", "t.leaf")];
    nodes = withAudience(nodes, "guestOnly", "guests");
    nodes = withAudience(nodes, "memberOnly", "members");
    return nodes;
  };

  it("defaults to the member arrangement", () => {
    // Most templates have only one arrangement, and it is the signed-in one.
    renderTree({}, mixed());
    expect(row("memberOnly")).toBeTruthy();
    expect(row("plain")).toBeTruthy();
    expect(row("guestOnly")).toBeNull();
  });

  it("leaves no block unreachable — there is no third view", () => {
    // Each of the two views is rendered in turn; every block must appear in one.
    const ids = ["guestOnly", "plain", "memberOnly"];
    const seen = new Set<string>();
    for (const audience of ["guests", "members"] as const) {
      cleanup();
      renderTree({ audience }, mixed());
      for (const id of ids) if (row(id)) seen.add(id);
    }
    expect([...seen].sort()).toEqual([...ids].sort());
  });

  it("shows the guest arrangement, and unrestricted blocks with it", () => {
    renderTree({ audience: "guests" }, mixed());
    expect(row("guestOnly")).toBeTruthy();
    expect(row("plain")).toBeTruthy();       // everyone-blocks belong to every view
    expect(row("memberOnly")).toBeNull();
  });

  it("shows the member arrangement", () => {
    renderTree({ audience: "members" }, mixed());
    expect(row("memberOnly")).toBeTruthy();
    expect(row("plain")).toBeTruthy();
    expect(row("guestOnly")).toBeNull();
  });

  it("counts a group-restricted block as part of the member arrangement", () => {
    // A group is a SUBSET of members; hiding it from their view would be wrong, and is
    // exactly what reusing a concrete viewer would have done for want of the group.
    renderTree({ audience: "members" }, withAudience([n("staff", "t.leaf")], "staff", "groups"));
    expect(row("staff")).toBeTruthy();
  });

  it("PRESERVES real indices, so a filtered view still moves correctly", () => {
    // `memberOnly` is index 2 in the document even though it is the 2nd row shown.
    const { ctx } = renderTree({ audience: "members" }, mixed());
    fireEvent.dragOver(row("memberOnly"));
    expect(ctx.hover).toHaveBeenCalledWith(
      expect.anything(),
      // Top half of the row → insert before index 2, not before index 1.
      expect.objectContaining({ index: 2 }),
    );
  });

  it("bounds nudge by the real list, not the visible one", () => {
    // `plain` is index 1 of 3, so it can move both ways even though it is the first
    // row rendered in the member view.
    renderTree({ audience: "members" }, mixed());
    expect(action("plain", UP).disabled).toBe(false);
    expect(action("plain", DOWN).disabled).toBe(false);
  });

  it("says so when a region holds nothing for this audience", () => {
    renderTree({ audience: "guests" }, withAudience([n("m", "t.leaf")], "m", "members"));
    expect(screen.getByText("layoutEditor.emptyForAudience")).toBeTruthy();
    // And not the generic empty-region text, which would be a lie.
    expect(screen.queryByText("layoutEditor.emptyRegion")).toBeNull();
  });

  it("filters inside containers too", () => {
    const kids = withAudience([n("g", "t.leaf"), n("m", "t.leaf")], "m", "members");
    renderTree({ audience: "guests" }, [{ ...n("box", "t.box"), children: kids }]);
    expect(row("g")).toBeTruthy();
    expect(row("m")).toBeNull();
  });
});

describe("restricted blocks", () => {
  const restrict = (nodes: BlockNode[], id: string, audience: string): BlockNode[] =>
    nodes.map((node) => (node.id === id
      ? { ...node, visibility: { audience, groups: [] } as BlockNode["visibility"] }
      : { ...node, ...(node.children ? { children: restrict(node.children, id, audience) } : {}) }));

  it("marks a block whose audience is narrowed", () => {
    // The row is where "this is conditional" is shown — the preview enforces the
    // chosen arrangement, so it cannot also be the place that tells you.
    renderTree({}, restrict(tree(), "leafOut", "members"));
    expect(row("leafOut").querySelector(".lay__node-restricted")).toBeTruthy();
    expect(row("box").querySelector(".lay__node-restricted")).toBeNull();
  });

  it("names the audience on the marker", () => {
    renderTree({ audience: "guests" }, restrict(tree(), "leafOut", "guests"));
    expect(row("leafOut").querySelector(".lay__node-restricted")!.getAttribute("title"))
      .toBe("layoutEditor.audience.guests");
  });

  it("marks a nested block too", () => {
    renderTree({}, restrict(tree(), "cell", "members"));
    expect(row("cell").querySelector(".lay__node-restricted")).toBeTruthy();
  });

  it("does not mark the explicit default", () => {
    renderTree({}, restrict(tree(), "leafOut", "everyone"));
    expect(row("leafOut").querySelector(".lay__node-restricted")).toBeNull();
  });
});

describe("drop indicator", () => {
  it("draws at the level of the list being dropped into", () => {
    renderTree({ dropAt: { region: "main", parentId: "box", index: 0 } });
    const lines = [...document.querySelectorAll(".lay__dropline")] as HTMLElement[];
    expect(lines).toHaveLength(1);
    expect(lines[0]!.style.getPropertyValue("--lay-depth")).toBe("2");
  });

  it("does not draw in a different container at the same index", () => {
    // parentId is part of the identity of a drop position; without it the line
    // would appear in every list that happens to share the index.
    renderTree({ dropAt: { region: "main", parentId: "row", index: 0 } });
    const lines = [...document.querySelectorAll(".lay__dropline")] as HTMLElement[];
    expect(lines).toHaveLength(1);
    expect(lines[0]!.style.getPropertyValue("--lay-depth")).toBe("3");
  });

  it("draws at region level for a region drop", () => {
    renderTree({ dropAt: { region: "main", parentId: null, index: 2 } });
    const lines = [...document.querySelectorAll(".lay__dropline")] as HTMLElement[];
    expect(lines).toHaveLength(1);
    expect(lines[0]!.style.getPropertyValue("--lay-depth")).toBe("1");
  });

  it("draws nothing when no drop is pending", () => {
    renderTree();
    expect(document.querySelectorAll(".lay__dropline")).toHaveLength(0);
  });
});

describe("drag reporting", () => {
  it("reports the dragged node so a target can refuse its type", () => {
    const { ctx } = renderTree();
    fireEvent.dragStart(row("cell"), { dataTransfer: { setData: vi.fn(), effectAllowed: "" } });
    expect(ctx.startDrag).toHaveBeenCalledWith(expect.objectContaining({ id: "cell", type: "t.cell" }));
  });

  it("reports a hover over a row as a position in that row's own list", () => {
    const { ctx } = renderTree();
    fireEvent.dragOver(row("row"));
    expect(ctx.hover).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ region: "main", parentId: "box" }),
    );
  });

  it("reports a hover over a container's children area as appending inside it", () => {
    const { ctx } = renderTree();
    // box holds leafIn and row, so appending is index 2.
    const area = document.querySelectorAll(".lay__children")[0] as HTMLElement;
    fireEvent.dragOver(area);
    expect(ctx.hover).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ parentId: "box", index: 2 }),
    );
  });

  it("dims the row being dragged", () => {
    renderTree({ dragId: "cell" });
    expect(row("cell").className).toContain("is-dragging");
  });
});

/**
 * The block picker's search and grouping.
 *
 * It was a flat list from when there were a handful of blocks; a template now offers
 * around thirty. What is worth pinning down is that the two orderings AGREE — the
 * cursor indexes a flattened list while the eye reads a grouped one, so a mismatch
 * would make Enter commit a block other than the highlighted one.
 */
describe("the block picker", () => {
  const EXTRA = ["t.zeta", "t.alpha", "t.stat", "t.widget"];

  beforeEach(() => {
    // Registered out of alphabetical order on purpose: the picker sorts within a
    // group, and registration order is an accident of which file imported first.
    registerBlock({
      type: "t.zeta", schema: z.object({}), component: noop,
      editorMeta: { label: "Zeta text", category: "content" },
    });
    registerBlock({
      type: "t.alpha", schema: z.object({}), component: noop,
      editorMeta: { label: "Alpha text", category: "content" },
    });
    registerBlock({
      type: "t.stat", schema: z.object({}), component: noop,
      editorMeta: { label: "Stats", category: "data" },
    });
    registerBlock({
      type: "t.widget", schema: z.object({}), component: noop, pluginId: "test-plugin",
      editorMeta: { label: "Widget", category: "plugin" },
    });
  });

  afterEach(() => { for (const type of EXTRA) deregisterBlock(type); });

  const openPicker = (onPick = vi.fn(), onClose = vi.fn()) => {
    render(
      <BlockPicker templateKey="home" depth={1} t={ctxWith().t} onPick={onPick} onClose={onClose} />,
    );
    return { onPick, onClose, input: screen.getByRole("textbox") };
  };

  const labels = () =>
    [...document.querySelectorAll(".lay__picker-item b")].map((b) => b.textContent);
  const headings = () =>
    [...document.querySelectorAll(".lay__picker-group-title")].map((h) => h.textContent);
  const activeLabel = () =>
    document.querySelector(".lay__picker-item.is-active b")?.textContent ?? null;

  it("groups by category, in build order rather than alphabetically", () => {
    openPicker();
    expect(headings()).toEqual([
      "layoutEditor.category.structure",
      "layoutEditor.category.content",
      "layoutEditor.category.data",
      "layoutEditor.category.plugin",
    ]);
  });

  it("sorts alphabetically within a group", () => {
    openPicker();
    const all = labels();
    expect(all.indexOf("Alpha text")).toBeLessThan(all.indexOf("Zeta text"));
  });

  it("filters by label", () => {
    const { input } = openPicker();
    fireEvent.change(input, { target: { value: "zeta" } });
    expect(labels()).toEqual(["Zeta text"]);
  });

  it("filters by type, which is what the row shows", () => {
    const { input } = openPicker();
    // Nothing is LABELLED "t.stat"; an author who knows the type can still find it.
    fireEvent.change(input, { target: { value: "t.stat" } });
    expect(labels()).toEqual(["Stats"]);
  });

  it("says nothing matched, rather than that nothing is available", () => {
    const { input } = openPicker();
    fireEvent.change(input, { target: { value: "qqqq" } });
    expect(labels()).toEqual([]);
    expect(screen.getByText("layoutEditor.noMatches")).toBeTruthy();
    expect(screen.queryByText("layoutEditor.noBlocks")).toBeNull();
  });

  it("commits the first match on Enter", () => {
    const { input, onPick } = openPicker();
    fireEvent.change(input, { target: { value: "alpha" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith("t.alpha");
  });

  it("walks the results with the arrow keys, across group boundaries", () => {
    const { input, onPick } = openPicker();
    // Region level offers Box and Row from structure, then the content group — so
    // the third row is in a different group from the first, and the cursor has to
    // step into it rather than stopping at the heading.
    const ordered = labels();
    expect(ordered.slice(0, 3)).toEqual(["Box", "Row", "Alpha text"]);
    expect(activeLabel()).toBe("Box");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(activeLabel()).toBe("Alpha text");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith("t.alpha");
  });

  it("wraps at the ends", () => {
    const { input } = openPicker();
    const ordered = labels();
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(activeLabel()).toBe(ordered[ordered.length - 1]);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(activeLabel()).toBe(ordered[0]);
  });

  it("still commits the right row after the search shortens the list", () => {
    const { input, onPick } = openPicker();
    // Walk deep into the full list, then narrow it to a single row. Whether the
    // cursor is reset or merely clamped, Enter must land on the one visible match
    // and not on an index that is now past the end.
    for (let i = 0; i < 5; i++) fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.change(input, { target: { value: "widget" } });
    expect(labels()).toEqual(["Widget"]);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith("t.widget");
  });

  it("follows the pointer, so Enter commits the row being looked at", () => {
    const { onPick, input } = openPicker();
    fireEvent.mouseEnter(screen.getByText("Stats", { selector: ".lay__picker-item b" }).parentElement!);
    expect(activeLabel()).toBe("Stats");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith("t.stat");
  });

  it("closes on Escape without adding anything", () => {
    const { input, onClose, onPick } = openPicker();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("names the contributing plugin on a plugin block, and the type otherwise", () => {
    openPicker();
    const secondary = (label: string) =>
      screen.getByText(label, { selector: ".lay__picker-item b" })
        .parentElement!.querySelector("span")!.textContent;
    expect(secondary("Widget")).toBe("test-plugin");
    expect(secondary("Stats")).toBe("t.stat");
  });
});

describe("duplicating a block", () => {
  const DUPLICATE = "layoutEditor.duplicateBlock";

  it("duplicates by id, at any depth", () => {
    const { ctx } = renderTree();
    fireEvent.click(action("cell", DUPLICATE));
    expect(ctx.duplicate).toHaveBeenCalledWith("cell");
  });

  it("is offered on a required block, unlike delete", () => {
    // The rule is that a template must never have ZERO of a required block, not
    // that it may not have two.
    renderTree({ required: new Set(["t.cell"]) });
    expect(action("cell", DELETE)).toBeNull();
    expect(action("cell", DUPLICATE)).toBeTruthy();
  });

  it("does not also select the row it acts on", () => {
    const { ctx } = renderTree();
    fireEvent.click(action("leafIn", DUPLICATE));
    expect(ctx.select).not.toHaveBeenCalled();
  });
});
