/**
 * The composed header, edge art, and the tree operations behind their editor controls.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { edgeArtSchema, type BlockNode, type LayoutDocument } from "@xentium/contracts";
import { LayoutRegion } from "./LayoutRenderer";
import { dateFromMonthDay, edgeShows, edgeStyle } from "./edgeArt";
import { placeBetween, updateBlockEdges, findNode, type Regions } from "./blockTree";
import { hasSurface } from "./blockRegistry";
import "./blocks/guestBlocks";
import "./blocks/profileBlocks";
import "./blocks/coreBlocks";
import "./blocks/chromeBlocks";

afterEach(cleanup);

const doc = (nodes: BlockNode[]): LayoutDocument =>
  ({ templateKey: "chrome.header", schemaVersion: 1, regions: { header: nodes } } as LayoutDocument);

const draw = (d: LayoutDocument) => render(
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter><LayoutRegion document={d} region="header" /></MemoryRouter>
  </QueryClientProvider>,
);

const header = (props: Record<string, unknown>, children: BlockNode[]): BlockNode =>
  ({ id: "h", type: "header", props, children });
const navbar = (children: BlockNode[], props: Record<string, unknown> = {}): BlockNode =>
  ({ id: "n", type: "navbar", props, children });
const leaf = (id: string, type: string): BlockNode => ({ id, type, props: {} });

describe("the composed header", () => {
  it("puts the logo in the brand column and everything else in the action group", () => {
    const { container } = draw(doc([header({}, [leaf("l", "logo"), leaf("s", "search")])]));
    expect(container.querySelector(".xt-header__brand .pub-nav__logo")).not.toBeNull();
    expect(container.querySelector(".xt-header__actions .xt-b--search")).not.toBeNull();
    expect(container.querySelector(".xt-header__actions .pub-nav__logo")).toBeNull();
  });

  it("still draws its own logo when it has no logo child — a header from before containers", () => {
    const { container } = draw(doc([header({ showLogo: true }, [])]));
    expect(container.querySelector(".xt-header__brand .pub-nav__logo")).not.toBeNull();
  });

  it("centres the brand on request", () => {
    const { container } = draw(doc([header({ logoAlign: "center" }, [leaf("l", "logo")])]));
    expect(container.querySelector(".xt-header--center")).not.toBeNull();
  });

  it("with the masthead hidden, the navbar takes the logo and the account menu", () => {
    const d = doc([
      header({ showMasthead: false }, [leaf("l", "logo"), leaf("u", "userMenu")]),
      navbar([leaf("nl", "navLinks")]),
    ]);
    const { container } = draw(d);
    expect(container.querySelector(".xt-header")).toBeNull();
    expect(container.querySelector(".pub-nav .pub-nav__logo")).not.toBeNull();
    expect(container.querySelector(".pub-nav__carried")).not.toBeNull();
  });

  it("with the masthead shown, the navbar adds nothing of its own", () => {
    const d = doc([header({}, [leaf("l", "logo"), leaf("u", "userMenu")]), navbar([leaf("nl", "navLinks")])]);
    const { container } = draw(d);
    expect(container.querySelector(".pub-nav .pub-nav__logo")).toBeNull();
    expect(container.querySelector(".pub-nav__carried")).toBeNull();
  });

  it("the navbar's own settings: static, a height, a tone", () => {
    const { container } = draw(doc([navbar([], { sticky: false, height: 60, tone: "brand" })]));
    const nav = container.querySelector<HTMLElement>(".pub-nav")!;
    expect(nav.classList.contains("pub-nav--static")).toBe(true);
    expect(nav.classList.contains("pub-nav--tone-brand")).toBe(true);
    expect(nav.style.getPropertyValue("--nav-height")).toBe("60px");
  });
});

describe("edge art", () => {
  const drips = edgeArtSchema.parse({ shape: "drips", height: 40 });

  it("is drawn into the block's own element, hidden from assistive technology", () => {
    const node: BlockNode = { ...navbar([]), edges: { bottom: drips } };
    const { container } = draw(doc([node]));
    const art = container.querySelector(".pub-nav > .xt-edge--bottom");
    expect(art).not.toBeNull();
    expect(art!.getAttribute("aria-hidden")).toBe("true");
  });

  it("hangs below for outward-bottom, and flips to rise for inward-bottom", () => {
    expect(edgeStyle(drips, "bottom")).toMatchObject({ top: "100%", transform: "scale(1, 1)" });
    expect(edgeStyle({ ...drips, direction: "in" }, "bottom")).toMatchObject({ bottom: 0, transform: "scale(1, -1)" });
    expect(edgeStyle({ ...drips, direction: "out", mirror: true }, "top")).toMatchObject({ bottom: "100%", transform: "scale(-1, -1)" });
  });

  it("seasonal art shows only in season — judged on the date the editor is viewing", () => {
    const seasonal = { ...drips, season: { from: "10-01", to: "11-01" } };
    expect(edgeShows(seasonal, new Date("2026-06-01T12:00:00"))).toBe(false);
    expect(edgeShows(seasonal, new Date("2026-10-31T12:00:00"))).toBe(true);
    expect(edgeShows(seasonal, dateFromMonthDay("10-01"))).toBe(true);
  });

  it("clearing both edges removes the field, so an undone edit is not pending", () => {
    const regions: Regions = { header: [navbar([])] };
    const withArt = updateBlockEdges(regions, "n", { bottom: drips });
    expect(findNode(withArt, "n")!.node.edges?.bottom?.shape).toBe("drips");
    const cleared = updateBlockEdges(withArt, "n", { bottom: undefined });
    expect(JSON.stringify(cleared)).toBe(JSON.stringify(regions));
  });
});

describe("placing search and the account menu", () => {
  const start = (): Regions => ({
    header: [header({}, [leaf("l", "logo")]), navbar([leaf("nl", "navLinks"), leaf("s", "search"), leaf("u", "userMenu")])],
  });
  const kids = (r: Regions, id: string) => findNode(r, id)!.node.children!.map((c) => c.id);

  it("moves a block between the two, keeping its id", () => {
    const r = placeBetween(start(), "search", "h", "n", "first", () => leaf("new", "search"));
    expect(kids(r, "h")).toContain("s");
    expect(kids(r, "n")).not.toContain("s");
  });

  it("'both' copies it, with a fresh id", () => {
    const r = placeBetween(start(), "search", "h", "n", "both", () => leaf("new", "search"));
    expect(kids(r, "n")).toContain("s");
    const copy = findNode(r, "h")!.node.children!.find((c) => c.type === "search")!;
    expect(copy.id).not.toBe("s");
  });

  it("leaves the input untouched", () => {
    const before = start();
    const json = JSON.stringify(before);
    placeBetween(before, "userMenu", "h", "n", "first", () => leaf("new", "userMenu"));
    expect(JSON.stringify(before)).toBe(json);
  });
});

describe("where edge art is offered", () => {
  it("on blocks that paint a surface", () => {
    for (const t of ["section", "header", "navbar", "footer", "guestSurface", "guestHero", "guestRail", "profileCard", "profileCover"]) {
      expect(hasSurface(t), t).toBe(true);
    }
  });

  it("not on links, buttons or text", () => {
    for (const t of ["footerLinks", "footerText", "logo", "navLinks", "search", "userMenu", "heading", "image"]) {
      expect(hasSurface(t), t).toBe(false);
    }
  });
});
