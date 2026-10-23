/**
 * The composed header, edge art, and the tree operations behind their editor controls.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CORE_EDGE_SHAPES, EDGE_ART_LIMITS, edgeArtSchema, type BlockNode, type LayoutDocument } from "@xentium/contracts";
import { LayoutRegion } from "./LayoutRenderer";
import { dateFromMonthDay, EdgeArtLayer, edgeFill, edgePath, edgeShows, edgeStyle, resolveEdgeShape } from "./edgeArt";
import { deregisterEdgeFor, registerEdgeExtension, registerEdgeShape } from "./edgeRegistry";
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

  it("puts the account menu straight after the logo when it is set to the left", () => {
    const masthead = header({ showMasthead: false }, [leaf("l", "logo"), leaf("u", "userMenu")]);
    const order = (props: Record<string, unknown>) => {
      const { container } = draw(doc([masthead, navbar([{ ...leaf("nl", "navLinks"), align: "right" }], props)]));
      const inner = container.querySelector(".pub-nav__inner")!;
      const kids = [...inner.querySelectorAll(":scope > .pub-nav__logo, :scope > .pub-nav__carried, :scope > [data-xt-align]")];
      cleanup();
      return kids.map((k) => k.classList.contains("pub-nav__carried") ? "account" : k.classList.contains("pub-nav__logo") ? "logo" : "links");
    };
    expect(order({})).toEqual(["logo", "links", "account"]);
    expect(order({ accountAlign: "left" })).toEqual(["logo", "account", "links"]);
  });

  it("the navbar's own settings: static, a height, a tone", () => {
    const { container } = draw(doc([navbar([], { sticky: false, height: 60, tone: "brand" })]));
    const nav = container.querySelector<HTMLElement>(".pub-nav")!;
    expect(nav.classList.contains("pub-nav--static")).toBe(true);
    expect(nav.classList.contains("pub-nav--tone-brand")).toBe(true);
    expect(nav.style.getPropertyValue("--nav-height")).toBe("60px");
  });
});

/** Every y coordinate in a path of absolute M/L/H/V/Q/C commands. */
function yCoords(d: string): number[] {
  const ys: number[] = [];
  for (const [, cmd, args] of d.matchAll(/([MLHVQCZ])([^MLHVQCZ]*)/g)) {
    const n = args!.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (cmd === "V") ys.push(...n);
    else if (cmd !== "H" && cmd !== "Z") ys.push(...n.filter((_, i) => i % 2 === 1));
  }
  return ys;
}

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

  it("core art always shows; a plugin may hide an edge for a while — judged on the date the editor is viewing", () => {
    expect(edgeShows(drips, new Date("2026-06-01T12:00:00"))).toBe(true);
    registerEdgeExtension({
      namespace: "test", pluginId: "test-plugin",
      shows: ({ ext, now }) => !(ext as { october?: boolean } | undefined)?.october || now.getMonth() === 9,
    });
    try {
      const october = { ...drips, ext: { test: { october: true } } };
      expect(edgeShows(october, new Date("2026-06-01T12:00:00"))).toBe(false);
      expect(edgeShows(october, dateFromMonthDay("10-01"))).toBe(true);
      expect(edgeShows(drips, new Date("2026-06-01T12:00:00"))).toBe(true);
    } finally {
      deregisterEdgeFor("test-plugin");
    }
  });

  it("every shape draws a closed outline inside its band, at any repeat count", () => {
    for (const shape of CORE_EDGE_SHAPES) {
      if (shape === "image" || shape === "blank") continue;
      for (const count of [undefined, 2, 48]) {
        const d = edgePath(shape, 1200, 40, { count, phase: 0.5 });
        expect(d.startsWith("M"), shape).toBe(true);
        expect(d.endsWith("Z"), shape).toBe(true);
        const ys = yCoords(d);
        expect(ys.every(Number.isFinite), shape).toBe(true);
        // Nothing above the edge, nothing deeper than twice the band (the curve's control point).
        expect(Math.min(...ys), shape).toBeGreaterThanOrEqual(0);
        expect(Math.max(...ys), shape).toBeLessThanOrEqual(80);
      }
    }
  });

  it("an edge saved before the new options parses without them, so it is not an edit", () => {
    expect(Object.keys(drips).sort()).toEqual(["colors", "direction", "fit", "height", "image", "mirror", "shape"]);
    expect(edgeFill(drips)).not.toHaveProperty("opacity");
    expect(edgeStyle(drips, "bottom")).not.toHaveProperty("opacity");
  });

  it("height travels as a custom property so the phone height can win under the breakpoint", () => {
    const style = edgeStyle({ ...drips, mobileHeight: 0 }, "bottom") as Record<string, unknown>;
    expect(style.height).toBeUndefined();
    expect(style["--xt-edge-h"]).toBe("40px");
    expect(style["--xt-edge-h-sm"]).toBe("0px");
  });
  it("clearing both edges removes the field, so an undone edit is not pending", () => {
    const regions: Regions = { header: [navbar([])] };
    const withArt = updateBlockEdges(regions, "n", { bottom: drips });
    expect(findNode(withArt, "n")!.node.edges?.bottom?.shape).toBe("drips");
    const cleared = updateBlockEdges(withArt, "n", { bottom: undefined });
    expect(JSON.stringify(cleared)).toBe(JSON.stringify(regions));
  });
});

describe("edge art from plugins", () => {
  afterEach(() => deregisterEdgeFor("test-plugin"));
  const bottomEdge = (edge: Record<string, unknown>) =>
    draw(doc([{ ...navbar([]), edges: { bottom: edgeArtSchema.parse(edge) } }])).container;

  it("a plugin shape is a namespaced name; core keeps its own", () => {
    expect(edgeArtSchema.safeParse({ shape: "fx.icicles" }).success).toBe(true);
    expect(edgeArtSchema.safeParse({ shape: "icicles" }).success).toBe(false);
    expect(() => registerEdgeShape({ id: "icicles", pluginId: "test-plugin", labelKey: "x", path: () => "" })).toThrow();
    // A bare name that is not core's needs a plugin; a plugin cannot take a core name.
    expect(() => registerEdgeShape({ id: "sparkle", labelKey: "x", path: () => "" })).toThrow();
    expect(() => registerEdgeShape({ id: "wave", pluginId: "test-plugin", labelKey: "x", path: () => "" })).toThrow();
  });

  it("draws a registered plugin shape like a core one", () => {
    registerEdgeShape({ id: "test.box", pluginId: "test-plugin", labelKey: "x", path: (W, H) => `M0 0 H${W} V${H} H0 Z` });
    expect(edgePath("test.box", 100, 10)).toBe("M0 0 H100 V10 H0 Z");
    expect(bottomEdge({ shape: "test.box" }).querySelector(".xt-edge__fill")).not.toBeNull();
  });

  it("with its plugin off, an edge draws its fallback — or nothing — and keeps everything", () => {
    const stored = edgeArtSchema.parse({ shape: "test.box", fallback: "wave", ext: { test: { glitter: true } } });
    expect(resolveEdgeShape(stored)).toBe("wave");
    expect(resolveEdgeShape({ ...stored, fallback: undefined })).toBeNull();
    expect(bottomEdge({ shape: "test.box" }).querySelector(".xt-edge")).toBeNull();
    expect(bottomEdge({ shape: "test.box", fallback: "wave" }).querySelector(".xt-edge__fill")).not.toBeNull();
    // Nothing is dropped on the way through the schema.
    expect(edgeArtSchema.parse(stored)).toEqual(stored);
  });

  it("a band drawn twice over with a period repeats exactly — what a seamless slide needs", () => {
    // A unit that writes its own index as its depth, so the path spells the sequence.
    registerEdgeShape({
      id: "test.index", pluginId: "test-plugin", labelKey: "x", defaultCount: 3,
      unit: { base: () => 0, unit: (x, _w, _H, i) => ` L ${x} ${i}` },
    });
    const indices = (opts: { count: number; period?: number }) =>
      [...edgePath("test.index", 600, 10, opts).matchAll(/L \S+ (\d+)/g)].map((m) => Number(m[1]));
    // One unit of overhang at each end, so a shifted band still covers the edge.
    expect(indices({ count: 6 })).toEqual([0, 1, 2, 3, 4, 5, 0, 1]);
    expect(indices({ count: 6, period: 3 })).toEqual([0, 1, 2, 0, 1, 2, 0, 1]);
  });

  it("a blank edge draws no outline but keeps what plugins carry", () => {
    const blank = edgeArtSchema.parse({ shape: "blank", ext: { test: { sky: true } } });
    expect(resolveEdgeShape(blank)).toBe("blank");
    expect(edgeFill(blank)).toBeNull();
    expect(edgePath("blank", 100, 10)).toBe("");
    // "blank" is what absent already means, so it is never a stand-in.
    expect(edgeArtSchema.safeParse({ shape: "test.box", fallback: "blank" }).success).toBe(false);
  });

  it("plugin settings are opaque but bounded", () => {
    expect(edgeArtSchema.safeParse({ shape: "wave", ext: { fx: { any: ["thing", 1] } } }).success).toBe(true);
    expect(edgeArtSchema.safeParse({ shape: "wave", ext: { fx: { big: "x".repeat(EDGE_ART_LIMITS.ext) } } }).success).toBe(false);
    expect(edgeArtSchema.safeParse({ shape: "wave", ext: { "Bad NS": {} } }).success).toBe(false);
  });

  it("an extension may draw the edge itself, with core's drawing to hand", () => {
    registerEdgeExtension({
      namespace: "test", pluginId: "test-plugin",
      render: ({ ext, drawCore }) => ext ? <span className="xt-edge-layer test-extra">{drawCore()}</span> : null,
    });
    // Without its settings it declines, and core draws.
    expect(bottomEdge({ shape: "wave" }).querySelector(".test-extra")).toBeNull();
    const drawn = bottomEdge({ shape: "wave", ext: { test: { on: true } } });
    expect(drawn.querySelector(".test-extra > .xt-edge > .xt-edge__fill")).not.toBeNull();
  });

});

describe("an outward edge over the navbar", () => {
  /** A masthead host in its block wrapper, and the navbar before or after it. */
  function page(navAfter: boolean, direction: "out" | "in") {
    const wrapper = document.createElement("div");
    const host = document.createElement("header");
    host.className = "xt-header";
    wrapper.appendChild(host);
    const nav = document.createElement("nav");
    nav.className = "pub-nav";
    document.body.append(...(navAfter ? [wrapper, nav] : [nav, wrapper]));
    const bottom = edgeArtSchema.parse({ shape: "drips", direction, height: 44 });
    render(<EdgeArtLayer edges={{ bottom }} wrapper={wrapper} />);
    return host;
  }
  afterEach(() => { document.body.innerHTML = ""; });

  it("lifts a masthead ABOVE the navbar when its edge hangs down onto it", () => {
    expect(page(true, "out").classList.contains("xt-edge-host--over-nav")).toBe(true);
  });
  it("leaves a masthead BELOW the navbar under it, so it still scrolls under the stuck navbar", () => {
    expect(page(false, "out").classList.contains("xt-edge-host--over-nav")).toBe(false);
  });
  it("leaves an inward edge alone: it never reaches the navbar", () => {
    expect(page(true, "in").classList.contains("xt-edge-host--over-nav")).toBe(false);
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
