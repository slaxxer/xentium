/**
 * The footer is a BLOCK.
 *
 * @vitest-environment jsdom
 *
 * `chrome.header` shipped `[header, navbar]` — a band and a container — while
 * `chrome.footer` shipped four loose leaves, and the footer's own appearance stayed
 * hardcoded in `SiteFooter`. So an admin could arrange what was IN the footer and
 * never touch the footer itself: no background, no height, no way to switch off the
 * line above it, and nothing to select when they clicked it in the preview.
 *
 * The band is a container rather than a sibling — unlike the masthead, which sits
 * ABOVE the navbar — because the footer's pieces are painted ON it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  DEFAULT_LAYOUTS, SCOPE_SELECTOR,
  type BlockNode, type LayoutDocument,
} from "@xentium/contracts";
import { LayoutRegion } from "./LayoutRenderer";
import "./blocks/coreBlocks";
import "./blocks/chromeBlocks";

afterEach(cleanup);

const doc = (nodes: BlockNode[]): LayoutDocument =>
  ({ templateKey: "chrome.footer", schemaVersion: 1, regions: { footer: nodes } } as LayoutDocument);

const band = (props: Record<string, unknown> = {}, children: BlockNode[] = []): BlockNode =>
  ({ id: "f-band", type: "footer", props, children });

/** The real footer pieces each own a query — the band holds components, not markup. */
const withQuery = (ui: React.ReactNode) =>
  render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

describe("the footer band", () => {
  it("paints .xt-foot — the class the Style Editor's Footer panel is emitted under", () => {
    // Not cosmetic: `SCOPE_SELECTOR.footer` IS this class, so renaming it silently
    // empties that whole panel.
    const { container } = render(<LayoutRegion document={doc([band()])} region="footer" />);
    expect(container.querySelector(".xt-foot")).not.toBeNull();
    expect(SCOPE_SELECTOR.footer).toBe(".xt-foot");
  });

  it("holds its pieces INSIDE the band, not beside it", () => {
    const { container } = withQuery(<LayoutRegion
      document={doc([band({}, [{ id: "b", type: "branding", props: { showUptime: false } }])])}
      region="footer"
    />);
    expect(container.querySelector(".xt-foot .xt-b--branding")).not.toBeNull();
  });

  it("draws a background only when the document asks for one", () => {
    // An existing site keeps `--footer-bg` from the Style Editor. A band that always
    // painted would override a colour the admin chose somewhere else entirely.
    const plain = render(<LayoutRegion document={doc([band()])} region="footer" />);
    expect(plain.container.querySelector(".xt-foot--bg")).toBeNull();
    cleanup();

    const painted = render(<LayoutRegion
      document={doc([band({ backgroundGradient: ["#101014", "#26263a"], backgroundAngle: 90 })])}
      region="footer"
    />);
    const el = painted.container.querySelector<HTMLElement>(".xt-foot--bg");
    expect(el).not.toBeNull();
    expect(el!.style.backgroundImage).toContain("linear-gradient");
  });

  it("can drop the line above it, for a footer whose background already separates it", () => {
    const { container } = render(
      <LayoutRegion document={doc([band({ showTopBorder: false })])} region="footer" />);
    expect(container.querySelector(".xt-foot--noline")).not.toBeNull();
  });

  it("is what the shipped default puts in the region, with its pieces inside it", () => {
    const shipped = DEFAULT_LAYOUTS["chrome.footer"].regions.footer!;
    expect(shipped.map((b) => b.type)).toEqual(["footer"]);
    // The bottom row is one footer bar: the copyright on one side, links on the other.
    expect(shipped[0]!.children!.map((b) => b.type))
      .toEqual(["whosOnline", "groupLegend", "boardStats", "footerBar"]);
  });

  it("still renders a footer whose pieces were never migrated", () => {
    // Loose leaves are a legal document — an admin may drag the pieces out of the
    // band to say "no footer chrome". They render unpainted rather than not at all.
    const { container } = withQuery(
      <LayoutRegion document={doc([{ id: "b", type: "branding", props: { showUptime: false } }])} region="footer" />);
    expect(container.querySelector(".xt-b--branding")).not.toBeNull();
    expect(container.querySelector(".xt-foot")).toBeNull();
  });
});

describe("the footer bar", () => {
  const bar = (props: Record<string, unknown>) => doc([{
    id: "f", type: "footer", props: {}, children: [{ id: "bar", type: "footerBar", props }],
  }]);
  const sides = (c: HTMLElement) =>
    [...c.querySelectorAll(".xt-footbar > *")].map((e) => e.className);

  it("puts the links and the theme picker in a row, with the copyright under them", () => {
    const { container } = withQuery(<LayoutRegion document={bar({})} region="footer" />);
    expect(sides(container)).toEqual(["xt-footbar__top", "xt-foottext"]);
    expect(container.querySelector(".xt-footbar__top .xt-footlinks__list")).not.toBeNull();
  });

  it("drops the row when there are no links and no theme picker", () => {
    const { container } = withQuery(<LayoutRegion document={bar({ showThemeChooser: false })} region="footer" />);
    expect(sides(container)).toEqual(["xt-foottext"]);
  });

  it("shows uptime and latency only when asked", () => {
    const off = withQuery(<LayoutRegion document={bar({})} region="footer" />);
    expect(off.container.querySelector(".xt-foottext__meta")).toBeNull();
    cleanup();
    const on = withQuery(<LayoutRegion document={bar({ showUptime: true })} region="footer" />);
    expect(on.container.querySelector(".xt-foottext__meta")).not.toBeNull();
  });

  it("draws the fixed line", () => {
    const { container } = withQuery(<LayoutRegion document={bar({})} region="footer" />);
    expect(container.querySelector(".xt-foottext__line")).not.toBeNull();
  });
});
