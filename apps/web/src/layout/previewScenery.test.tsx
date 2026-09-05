/**
 * A preview is never one document — and all of it is reachable.
 *
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "http://localhost/?__layout=draft&__editing=chrome.header" }
 *
 * The page's regions arrive with the site header and footer around them, and those
 * are as much part of the page as its body: the masthead band and the navbar ARE the
 * header. So every block carries the editor's addressing, plus the DOCUMENT it
 * belongs to — clicking one that lives elsewhere opens that document rather than
 * addressing an id the open one does not contain.
 *
 * Two things stay with the open document, because both act on the tree the editor is
 * holding: dragging a block, and an empty region's drop target.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { BlockNode, LayoutDocument } from "@nodevo/contracts";
import { LayoutRenderer } from "./LayoutRenderer";
import "./blocks/coreBlocks";

afterEach(cleanup);

const heading = (id: string): BlockNode =>
  ({ id, type: "heading", props: { text: "Hi", level: 2 } });

const doc = (templateKey: string, regions: Record<string, BlockNode[]>): LayoutDocument =>
  ({ templateKey, schemaVersion: 1, regions } as LayoutDocument);

const page = () =>
  doc("home", { header: [], main: [heading("feed")], aside: [], footer: [] });

describe("the open document", () => {
  it("is addressable, draggable, and takes drops in its empty regions", () => {
    const { container } = render(
      <LayoutRenderer
        templateKey="chrome.header"
        document={doc("chrome.header", { header: [heading("logo")] })}
      />,
    );
    const block = container.querySelector('[data-nv-block="logo"]')!;
    expect(block).not.toBeNull();
    expect(block.getAttribute("data-nv-template")).toBe("chrome.header");
    expect(block.getAttribute("data-nv-drag")).toBe("1");
  });

  it("draws a placeholder for its own empty region", () => {
    const { container } = render(
      <LayoutRenderer templateKey="chrome.header" document={doc("chrome.header", { header: [] })} />,
    );
    expect(container.querySelector("[data-nv-empty]")).not.toBeNull();
  });
});

describe("the rest of the page", () => {
  it("is addressable too, and says which document it belongs to", () => {
    // This is what makes clicking the masthead — or anything else on the page — open
    // the document that owns it.
    const { container } = render(<LayoutRenderer templateKey="home" document={page()} />);
    const block = container.querySelector('[data-nv-block="feed"]')!;
    expect(block).not.toBeNull();
    expect(block.getAttribute("data-nv-template")).toBe("home");
  });

  it("is NOT draggable — a move rewrites the tree the editor is holding", () => {
    const { container } = render(<LayoutRenderer templateKey="home" document={page()} />);
    expect(container.querySelector('[data-nv-block="feed"]')!.getAttribute("data-nv-drag")).toBeNull();
  });

  it("offers no drop target for a region the open template does not have", () => {
    const { container } = render(<LayoutRenderer templateKey="home" document={page()} />);
    expect(container.querySelector("[data-nv-empty]")).toBeNull();
  });

  it("stamps the owning document on the region too, so a hover resolves the same way", () => {
    const { container } = render(<LayoutRenderer templateKey="home" document={page()} />);
    expect(container.querySelector(".nv-region--main")!.getAttribute("data-nv-template")).toBe("home");
  });
});
