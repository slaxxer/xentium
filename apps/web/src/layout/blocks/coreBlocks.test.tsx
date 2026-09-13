/**
 * The two structure blocks whose rendering depends on the tree, not on props.
 *
 * @vitest-environment jsdom
 *
 * `columns` has no `count` prop — the track count IS the number of `column`
 * children — so the grid it produces is only correct if the component reads the
 * tree. That is exactly the kind of thing a prop-based test would miss, since
 * there is no prop to assert on.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { BlockNode, LayoutDocument } from "@xentium/contracts";
import { LayoutRegion } from "../LayoutRenderer";
import "./coreBlocks";
import "./guestBlocks";

afterEach(cleanup);

const col = (id: string, children?: BlockNode[]): BlockNode =>
  ({ id, type: "column", props: {}, ...(children ? { children } : {}) });

const row = (id: string, cols: BlockNode[], gap = "md"): BlockNode =>
  ({ id, type: "columns", props: { gap }, children: cols });

const doc = (nodes: BlockNode[]): LayoutDocument =>
  ({ templateKey: "home", schemaVersion: 1, regions: { main: nodes } });

const gridClass = () => (document.querySelector(".nv-columns") as HTMLElement).className;

describe("columns — tracks follow the children", () => {
  it("renders two tracks for two columns", () => {
    render(<LayoutRegion document={doc([row("r", [col("a"), col("b")])])} region="main" />);
    expect(gridClass()).toContain("nv-columns--2");
  });

  it("renders three tracks for three columns", () => {
    render(<LayoutRegion document={doc([row("r", [col("a"), col("b"), col("c")])])} region="main" />);
    expect(gridClass()).toContain("nv-columns--3");
  });

  it("renders four tracks for four columns", () => {
    render(<LayoutRegion document={doc([row("r", [col("a"), col("b"), col("c"), col("d")])])} region="main" />);
    expect(gridClass()).toContain("nv-columns--4");
  });

  it("clamps beyond the tracks CSS defines, instead of emitting a dead class", () => {
    // A document can arrive from an imported theme, so the ceiling is enforced in
    // the component rather than trusted to the editor.
    const many = ["a", "b", "c", "d", "e", "f"].map((id) => col(id));
    render(<LayoutRegion document={doc([row("r", many)])} region="main" />);
    expect(gridClass()).toContain("nv-columns--4");
  });

  it("stays a one-track grid when emptied, rather than collapsing to nothing", () => {
    render(<LayoutRegion document={doc([{ id: "r", type: "columns", props: { gap: "md" } }])} region="main" />);
    expect(gridClass()).toContain("nv-columns--1");
  });

  it("keeps gap an admin choice", () => {
    render(<LayoutRegion document={doc([row("r", [col("a"), col("b")], "lg")])} region="main" />);
    expect(gridClass()).toContain("nv-columns--gap-lg");
  });

  it("renders each column as a track holding its own children", () => {
    render(<LayoutRegion document={doc([row("r", [
      col("a", [{ id: "h", type: "heading", props: { text: "Inside", level: 2 } }]),
      col("b"),
    ])])} region="main" />);
    const tracks = document.querySelectorAll(".nv-column");
    expect(tracks).toHaveLength(2);
    expect(tracks[0]!.textContent).toContain("Inside");
    expect(tracks[1]!.textContent).toBe("");
  });
});

describe("section", () => {
  it("maps width and padding to token-driven classes, never pixel values", () => {
    render(<LayoutRegion document={doc([
      { id: "s", type: "section", props: { width: "narrow", padding: "lg" }, children: [] },
    ])} region="main" />);
    const el = document.querySelector(".nv-section") as HTMLElement;
    expect(el.className).toContain("nv-section--narrow");
    expect(el.className).toContain("nv-section--pad-lg");
    expect(el.style.cssText).toBe("");
  });

  it("renders its children inside itself", () => {
    render(<LayoutRegion document={doc([{
      id: "s", type: "section", props: { width: "normal", padding: "md" },
      children: [{ id: "h", type: "heading", props: { text: "Nested", level: 3 } }],
    }])} region="main" />);
    const section = document.querySelector(".nv-section") as HTMLElement;
    expect(section.textContent).toContain("Nested");
    expect(section.querySelector("h3")).toBeTruthy();
  });
});

describe("guest hero background", () => {
  const hero = (props: Record<string, unknown>) => ({
    id: "h", type: "guestHero", props,
    children: [{ id: "t", type: "heading", props: { text: "Hi", level: 1 } }],
  });
  const render1 = (props: Record<string, unknown>) =>
    render(<LayoutRegion document={doc([hero(props) as never])} region="main" />);
  const panel = () => document.querySelector(".ghero") as HTMLElement;

  it("keeps the token gradient when no image is set", () => {
    render1({ backgroundImage: "", overlay: "none" });
    expect(panel().className).not.toContain("ghero--image");
    expect(panel().style.backgroundImage).toBe("");
  });

  it("treats a bare value as an upload path", () => {
    render1({ backgroundImage: "themes/assets/hero.jpg", overlay: "none" });
    expect(panel().style.backgroundImage).toContain("/uploads/themes/assets/hero.jpg");
  });

  it("passes an absolute URL through untouched", () => {
    render1({ backgroundImage: "https://cdn.example.com/a.jpg", overlay: "none" });
    expect(panel().style.backgroundImage).toContain("https://cdn.example.com/a.jpg");
    expect(panel().style.backgroundImage).not.toContain("/uploads");
  });

  it("encodes a path with spaces rather than emitting broken CSS", () => {
    render1({ backgroundImage: "themes/my hero.jpg", overlay: "none" });
    expect(panel().style.backgroundImage).toContain("my%20hero.jpg");
  });

  it("applies the contrast scrim as a class, never an inline colour", () => {
    render1({ backgroundImage: "x.jpg", overlay: "dark" });
    expect(panel().className).toContain("ghero--overlay-dark");
    // The scrim is a token in CSS; an inline rgba here would not follow the theme.
    expect(panel().getAttribute("style")).not.toMatch(/rgba?\(/);
  });

  it("still renders its children — it is a container first", () => {
    render1({ backgroundImage: "x.jpg", overlay: "dark" });
    expect(panel().querySelector("h1")?.textContent).toBe("Hi");
  });
});
