/**
 * The catalogue — the ONE way to add a block now that every `+` opens it.
 *
 * @vitest-environment jsdom
 *
 * It inherited these invariants from the dropdown picker it replaced, and they are
 * the ones that matter: it must offer exactly what the TARGET accepts, and no more.
 * A catalogue that lists a block the tree would refuse is worse than a short one —
 * the refusal happens after the click, when the admin has already decided.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { cleanup, render, fireEvent, screen } from "@testing-library/react";
import { deregisterBlock, registerBlock } from "../../../layout/blockRegistry";
import { BlockCatalogue } from "./BlockCatalogue";

const TYPES = ["t.box", "t.row", "t.cell", "t.leaf", "t.zeta", "t.alpha", "t.widget"];
const noop = () => null;

beforeEach(() => {
  for (const type of TYPES) deregisterBlock(type);
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
  // Registered out of alphabetical order on purpose: the grid sorts, and
  // registration order is an accident of which file imported first.
  registerBlock({
    type: "t.zeta", schema: z.object({}), component: noop,
    editorMeta: { label: "Zeta text", category: "content" },
  });
  registerBlock({
    type: "t.alpha", schema: z.object({}), component: noop,
    editorMeta: { label: "Alpha text", category: "content" },
  });
  registerBlock({
    type: "t.widget", schema: z.object({}), component: noop, pluginId: "test-plugin",
    editorMeta: { label: "Widget", category: "plugin" },
  });
});

afterEach(() => {
  cleanup();
  for (const type of TYPES) deregisterBlock(type);
});

const open = (over: Partial<Parameters<typeof BlockCatalogue>[0]> = {}) => {
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(
    <BlockCatalogue
      templateKey="home" regionName="Body"
      onPick={onPick} onClose={onClose}
      {...over}
    />,
  );
  return { onPick, onClose };
};

const names = () =>
  [...document.querySelectorAll(".xt-cat__name")].map((n) => n.firstChild?.textContent);
const search = () => screen.getByRole("textbox");
const tab = (label: string) =>
  [...document.querySelectorAll(".xt-cat__tabs button")]
    .find((b) => b.textContent?.startsWith(label)) as HTMLButtonElement;

describe("what the catalogue offers", () => {
  it("sorts alphabetically, whatever order blocks registered in", () => {
    open();
    const all = names();
    expect(all.indexOf("Alpha text")).toBeLessThan(all.indexOf("Zeta text"));
  });

  it("keeps a container-only block out of a REGION's list", () => {
    // t.cell declares onlyInside: ["t.row"], and a region is not a container.
    open();
    expect(names()).toContain("Leaf");
    expect(names()).not.toContain("Cell");
  });

  it("offers only what a container accepts", () => {
    // t.row declares childTypes: ["t.cell"], so that is the whole list.
    open({ parentType: "t.row" });
    expect(names()).toEqual(["Cell"]);
  });

  it("adds the block and closes, in that order", () => {
    const { onPick, onClose } = open();
    fireEvent.click(screen.getByText("Leaf", { selector: ".xt-cat__name" }).closest("button")!);
    expect(onPick).toHaveBeenCalledWith("t.leaf");
    expect(onClose).toHaveBeenCalled();
  });
});

describe("finding a block", () => {
  it("filters by label", () => {
    open();
    fireEvent.change(search(), { target: { value: "zeta" } });
    expect(names()).toEqual(["Zeta text"]);
  });

  it("filters by type, for an author who knows it", () => {
    // Nothing is LABELLED "t.alpha"; a `.xttheme` and the docs speak in types.
    open();
    fireEvent.change(search(), { target: { value: "t.alpha" } });
    expect(names()).toEqual(["Alpha text"]);
  });

  it("says nothing MATCHED, rather than that nothing is available", () => {
    open();
    fireEvent.change(search(), { target: { value: "qqqq" } });
    expect(names()).toEqual([]);
    expect(screen.getByText("layoutEditor.catalogueNoMatch")).toBeTruthy();
    expect(screen.queryByText("layoutEditor.catalogueEmpty")).toBeNull();
  });

  it("narrows to one kind, and back", () => {
    open();
    fireEvent.click(tab("layoutEditor.category.content"));
    expect(names()).toEqual(["Alpha text", "Leaf", "Zeta text"]);
    fireEvent.click(tab("layoutEditor.categoryAll"));
    expect(names()).toContain("Box");
  });

  it("disables a kind with nothing in it rather than hiding it", () => {
    // Which kinds EXIST is part of what a catalogue teaches; a tab row that changes
    // shape per template teaches the opposite.
    open({ parentType: "t.row" });   // only t.cell fits — structure
    expect(tab("layoutEditor.category.content").disabled).toBe(true);
    expect(tab("layoutEditor.category.structure").disabled).toBe(false);
  });

  it("counts what each kind holds", () => {
    open();
    expect(tab("layoutEditor.categoryAll").textContent).toContain("6");
    expect(tab("layoutEditor.category.plugin").textContent).toContain("1");
  });
});

describe("leaving without adding", () => {
  it("closes on Escape", () => {
    const { onClose, onPick } = open();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(onPick).not.toHaveBeenCalled();
  });

  it("closes on a click outside, but not on one inside", () => {
    const { onClose } = open();
    fireEvent.click(document.querySelector(".xt-cat")!);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector(".acp-modal-overlay")!);
    expect(onClose).toHaveBeenCalled();
  });
});
