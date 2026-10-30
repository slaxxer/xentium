/**
 * A page's `headerBand` is drawn by the SITE header, not inside the page.
 *
 * @vitest-environment jsdom
 *
 * The page renders in `<main>`, the header above it; the band is the page's region
 * all the same, handed over through `usePageBand` and taken back when the page goes.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HEADER_BAND_REGION, registerTemplate, type BlockNode, type LayoutDocument } from "@xentium/contracts";
import { LayoutRegion, LayoutRenderer } from "./LayoutRenderer";
import { usePageBand } from "./siteFrame";
import "./blocks/coreBlocks";

afterEach(cleanup);

registerTemplate({
  key: "bandtest.page",
  pluginId: "bandtest",
  regions: [HEADER_BAND_REGION, "main"],
  defaultDocument: { templateKey: "bandtest.page", regions: {} },
});

const heading = (id: string, text: string): BlockNode => ({ id, type: "heading", props: { text, level: 2 } });
const doc = (regions: Record<string, BlockNode[]>): LayoutDocument =>
  ({ templateKey: "bandtest.page", schemaVersion: 1, regions } as LayoutDocument);

/** What `PubNav` does with the band. */
function Header() {
  const band = usePageBand();
  return <header data-testid="site-header">{band && <LayoutRegion document={band.document} region={HEADER_BAND_REGION} context={band.context} />}</header>;
}

describe("the page's header band", () => {
  it("renders in the site header and not in the page", () => {
    const { getByTestId, container } = render(
      <>
        <Header />
        <main data-testid="page">
          <LayoutRenderer templateKey="bandtest.page" document={doc({ headerBand: [heading("h", "Hero")], main: [heading("m", "Body")] })} />
        </main>
      </>,
    );
    expect(getByTestId("site-header").textContent).toContain("Hero");
    expect(getByTestId("page").textContent).toBe("Body");
    expect(container.querySelectorAll(".xt-region--headerBand")).toHaveLength(1);
  });

  it("leaves with the page", () => {
    const { getByTestId, rerender } = render(
      <>
        <Header />
        <LayoutRenderer templateKey="bandtest.page" document={doc({ headerBand: [heading("h", "Hero")], main: [] })} />
      </>,
    );
    expect(getByTestId("site-header").textContent).toContain("Hero");
    rerender(<Header />);
    expect(getByTestId("site-header").textContent).toBe("");
  });

  it("is not handed over by a template without the region", () => {
    const { getByTestId } = render(
      <>
        <Header />
        <LayoutRenderer templateKey="article.index" document={{ templateKey: "article.index", schemaVersion: 1, regions: { main: [heading("m", "Body")] } } as LayoutDocument} />
      </>,
    );
    expect(getByTestId("site-header").textContent).toBe("");
  });
});

describe("the page's masthead inside the site masthead", () => {
  it("draws the page's band inside the masthead, under the logo row, with its content", async () => {
    await import("./blocks/chromeBlocks");
    const header = {
      templateKey: "chrome.header", schemaVersion: 1,
      regions: { header: [{ id: "band", type: "header", props: { height: 0, showButtons: false }, children: [
        { id: "logo", type: "logo", props: {} },
        { id: "page", type: "mastheadPage", props: {} },
        { id: "cta", type: "buttons", props: { primaryLabel: "Browse", primaryHref: "/store" } },
      ] }] },
    } as unknown as LayoutDocument;
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}><MemoryRouter>
        <LayoutRegion document={header} region="header" />
        <LayoutRenderer templateKey="bandtest.page" document={doc({ headerBand: [heading("h", "Hero")], main: [heading("m", "Body")] })} />
      </MemoryRouter></QueryClientProvider>,
    );
    const body = container.querySelector(".xt-header__body")!;
    expect(body).not.toBeNull();
    expect(body.textContent).toContain("Hero");
    expect(body.querySelector("a.btn-primary")?.getAttribute("href")).toBe("/store");
    // The logo row is untouched: the content is not in the action group.
    expect(container.querySelector(".xt-header__actions")).toBeNull();
  });
});
