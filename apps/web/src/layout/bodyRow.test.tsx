/**
 * BODY and ASIDE are one row.
 *
 * @vitest-environment jsdom
 *
 * `aside` means beside. Every region used to be emitted in template order, so the
 * page's rail rendered as a strip UNDER the body — four landmarks reading as four
 * stacked bands, which is not what the word says and not what anyone arranging a
 * page expects.
 *
 * The pairing lives in `LayoutRenderer` rather than in a stylesheet because it is a
 * property of the template's REGION SET: a template that declares no `aside` gets no
 * row, and the row (not each region) owns the page's content column.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { BlockNode, LayoutDocument } from "@nodevo/contracts";
import { LayoutRenderer } from "./LayoutRenderer";
import "./blocks/coreBlocks";

afterEach(cleanup);

const heading = (id: string, text: string): BlockNode =>
  ({ id, type: "heading", props: { text, level: 2 } });

const doc = (regions: Record<string, BlockNode[]>): LayoutDocument =>
  ({ templateKey: "home", schemaVersion: 1, regions } as LayoutDocument);

describe("the body row", () => {
  it("puts the body and the rail in one row", () => {
    const { container } = render(
      <LayoutRenderer
        templateKey="home"
        document={doc({ header: [], main: [heading("m", "Body")], aside: [heading("a", "Rail")], footer: [] })}
      />,
    );
    const row = container.querySelector(".nv-body-row");
    expect(row).not.toBeNull();
    expect(row!.querySelector(".nv-region--main")).not.toBeNull();
    expect(row!.querySelector(".nv-region--aside")).not.toBeNull();
  });

  it("renders the body BEFORE the rail whatever order the template lists", () => {
    // The row is a flex row, so DOM order is reading order — and a rail that came
    // first would read before the page's content to a screen reader as well.
    const { container } = render(
      <LayoutRenderer
        templateKey="home"
        regions={["aside", "main"]}
        document={doc({ main: [heading("m", "Body")], aside: [heading("a", "Rail")] })}
      />,
    );
    const kids = [...container.querySelector(".nv-body-row")!.children];
    expect(kids.map((el) => el.className.split(" ").find((c) => c.startsWith("nv-region--"))))
      .toEqual(["nv-region--main", "nv-region--aside"]);
  });

  it("still emits the aside LANDMARK, not a div in a row", () => {
    const { container } = render(
      <LayoutRenderer
        templateKey="home"
        document={doc({ main: [heading("m", "Body")], aside: [heading("a", "Rail")] })}
      />,
    );
    expect(container.querySelector(".nv-body-row > aside")).not.toBeNull();
  });

  it("leaves an empty rail out of the document entirely on the live site", () => {
    // Not merely hidden: `LayoutRegion` renders nothing for an empty region outside
    // the editor, so the row has one child and the body takes the full width.
    const { container } = render(
      <LayoutRenderer
        templateKey="home"
        document={doc({ main: [heading("m", "Body")], aside: [] })}
      />,
    );
    expect(container.querySelector(".nv-region--aside")).toBeNull();
    expect(container.querySelector(".nv-body-row")!.children).toHaveLength(1);
  });

  it("does not build a row for a template with no aside", () => {
    // `chrome.header` is one region. A row around it would wrap the site header in a
    // page-content column — the exact box `.pub-head` dissolves on purpose.
    const { container } = render(
      <LayoutRenderer
        templateKey="chrome.header"
        document={{ templateKey: "chrome.header", schemaVersion: 1,
                    regions: { header: [heading("h", "Site") ] } } as LayoutDocument}
      />,
    );
    expect(container.querySelector(".nv-body-row")).toBeNull();
  });

  it("is the whole page — a page has no bands above or below it any more", () => {
    // The two regions used to be four. `regionsFor` decides what exists, and the row
    // is built from what it declares, so a document still carrying the old keys
    // renders neither (the migration folds them into the body on boot).
    const { container } = render(
      <LayoutRenderer
        templateKey="home"
        document={doc({
          header: [heading("h", "Band")],
          main:   [heading("m", "Body")],
          aside:  [heading("a", "Rail")],
          footer: [heading("f", "Bottom")],
        })}
      />,
    );
    expect(container.querySelector(".nv-region--header")).toBeNull();
    expect(container.querySelector(".nv-region--footer")).toBeNull();
    expect([...container.querySelectorAll(".nv-body-row > .nv-region")]
      .map((el) => el.className.split(" ").find((c) => c.startsWith("nv-region--"))))
      .toEqual(["nv-region--main", "nv-region--aside"]);
  });
});

/**
 * ⚠⚠ ONE header and ONE footer, and they are the SITE's.
 *
 * The masthead band and the navbar are what a visitor sees at the top of the page —
 * that is the header. A page's own `header` region is a band between it and the body,
 * and while it emitted a `<header>` too, every page carried two banner landmarks with
 * the one that is not the header nested inside `<main>`. The tree said the same thing,
 * which is how "the header region is above the actual header" came to be a fair
 * description of the editor.
 */
describe("whose header it is", () => {
  it("gives a page no header or footer landmark, because it has neither region", () => {
    const { container } = render(
      <LayoutRenderer
        templateKey="home"
        document={doc({ main: [heading("m", "Body")], aside: [heading("a", "Rail")] })}
      />,
    );
    expect(container.querySelector("header.nv-region--header")).toBeNull();
    expect(container.querySelector("footer.nv-region--footer")).toBeNull();
  });

  it("gives the site's header and footer theirs", () => {
    const header = render(
      <LayoutRenderer
        templateKey="chrome.header"
        document={{ templateKey: "chrome.header", schemaVersion: 1,
                    regions: { header: [heading("nav", "Navbar")] } } as LayoutDocument}
      />,
    );
    expect(header.container.querySelector("header.nv-region--header")).not.toBeNull();
    cleanup();

    const footer = render(
      <LayoutRenderer
        templateKey="chrome.footer"
        document={{ templateKey: "chrome.footer", schemaVersion: 1,
                    regions: { footer: [heading("legal", "Legal")] } } as LayoutDocument}
      />,
    );
    expect(footer.container.querySelector("footer.nv-region--footer")).not.toBeNull();
  });
});
