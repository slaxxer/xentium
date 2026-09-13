/**
 * The `page.detail` blocks, and the claim that adopting the template changed
 * nothing on screen.
 *
 * @vitest-environment jsdom
 *
 * `PageReaderPage` used to render image → title → body as hardcoded markup.
 * `DEFAULT_LAYOUTS['page.detail']` is supposed to reproduce that byte for byte, so
 * the adoption is invisible until an admin moves something. That is the assertion
 * worth having: a default that drifts from the markup it replaced silently
 * redesigns every custom page on every site.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { DEFAULT_LAYOUTS } from "@xentium/contracts";
import { LayoutRenderer } from "../LayoutRenderer";
import type { PageDetailContext } from "./pageDetailBlocks";
import "./pageDetailBlocks";

afterEach(cleanup);

const page = (over: Partial<NonNullable<PageDetailContext["page"]>> = {}) => ({
  page: {
    id: "p1",
    title: "About us",
    body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }] },
    featuredImage: null,
    ...over,
  },
});

const renderDefault = (context: PageDetailContext) =>
  render(
    <LayoutRenderer
      templateKey="page.detail"
      document={DEFAULT_LAYOUTS["page.detail"]}
      context={context}
    />,
  );

describe("the shipped default reproduces the old page markup", () => {
  it("renders title and body with their original classes", () => {
    renderDefault(page());
    expect(document.querySelector("h1.page-view__title")!.textContent).toBe("About us");
    expect(document.querySelector(".page-view__body")).toBeTruthy();
    expect(document.querySelector(".page-view__body")!.textContent).toContain("Hello");
  });

  it("keeps the original order: image, then title, then body", () => {
    renderDefault(page({ featuredImage: "pages/p1/hero.png" }));
    const seen = [...document.querySelectorAll(
      ".page-view__header-image, .page-view__title, .page-view__body",
    )].map((el) => el.className);
    expect(seen).toEqual(["page-view__header-image", "page-view__title", "page-view__body"]);
  });

  it("renders the featured image from /uploads", () => {
    renderDefault(page({ featuredImage: "pages/p1/hero.png" }));
    expect(document.querySelector<HTMLImageElement>(".page-view__header-image")!.getAttribute("src"))
      .toBe("/uploads/pages/p1/hero.png");
  });

  it("omits the image entirely when the page has none", () => {
    // Most pages carry no featured image, and a gap where one would be is worse
    // than nothing at all.
    renderDefault(page({ featuredImage: null }));
    expect(document.querySelector(".page-view__header-image")).toBeNull();
  });

  it("places everything in main, leaving the other regions empty", () => {
    renderDefault(page());
    expect(document.querySelector(".nv-region--main")).toBeTruthy();
    for (const region of ["header", "aside", "footer"]) {
      expect(document.querySelector(`.nv-region--${region}`), region).toBeNull();
    }
  });
});

describe("pageTitle", () => {
  it("honours the admin's heading level", () => {
    // A title moved below other headings should not stay an h1.
    render(<LayoutRenderer
      templateKey="page.detail"
      document={{ templateKey: "page.detail", schemaVersion: 1, regions: {
        main: [{ id: "t", type: "pageTitle", props: { level: 2 } }],
      } }}
      context={page()}
    />);
    expect(document.querySelector("h2.page-view__title")).toBeTruthy();
    expect(document.querySelector("h1")).toBeNull();
  });

  it("takes its text from the page, never from a prop", () => {
    // A layout must not be able to rename a page, so there is no text prop to set.
    render(<LayoutRenderer
      templateKey="page.detail"
      document={{ templateKey: "page.detail", schemaVersion: 1, regions: {
        main: [{ id: "t", type: "pageTitle", props: { level: 1, text: "Injected" } }],
      } }}
      context={page({ title: "Real title" })}
    />);
    expect(document.querySelector(".page-view__title")!.textContent).toBe("Real title");
  });
});

describe("no page in context", () => {
  it("renders nothing rather than throwing", () => {
    // The host container handles loading and not-found, but a block must not be the
    // thing that breaks if it is ever rendered without one.
    renderDefault({ page: null });
    expect(document.querySelector(".page-view__title")).toBeNull();
    expect(document.querySelector(".page-view__body")).toBeNull();
    expect(document.querySelector(".page-view__header-image")).toBeNull();
  });
});
