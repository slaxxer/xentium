/**
 * The two handles a designer needs (theme-marketplace step 1): a stable CSS class on
 * any block, and an image that can be a link.
 *
 * @vitest-environment jsdom
 *
 * The load-bearing claims are that `className` rides the SAME `display: contents`
 * wrapper the variant uses — so it is uniform across core and plugin blocks and can
 * never break a flex or grid parent — and that a stored document can never put a
 * script-bearing URL into an `href`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  blockClassNameSchema,
  blockNodeSchema,
  blockPropSchemas,
  linkHrefSchema,
  type BlockNode,
  type LayoutDocument,
} from "@nodevo/contracts";
import { LayoutRegion } from "./LayoutRenderer";
import { updateBlockClassName } from "./blockTree";
import "./blocks/coreBlocks";

afterEach(cleanup);

const heading = (extra: Partial<BlockNode> = {}): BlockNode =>
  ({ id: "h", type: "heading", props: { text: "Hi", level: 2 }, ...extra });

const doc = (nodes: BlockNode[]): LayoutDocument =>
  ({ templateKey: "home", schemaVersion: 1, regions: { main: nodes } });

// ── The class contract ──────────────────────────────────────────────────────

describe("blockClassNameSchema", () => {
  it("accepts an ordinary handle and a short list of them", () => {
    expect(blockClassNameSchema.safeParse("nav-tile").success).toBe(true);
    expect(blockClassNameSchema.safeParse("nav-tile is_primary").success).toBe(true);
  });

  it("REFUSES the reserved `nv-` prefix", () => {
    // Core's own classes live there and are the contract a theme styles against. A
    // document that could mint one could impersonate a core class — or hand itself a
    // variant (`nv-v--accent`) nobody granted it.
    expect(blockClassNameSchema.safeParse("nv-card").success).toBe(false);
    expect(blockClassNameSchema.safeParse("nv-v--accent").success).toBe(false);
    expect(blockClassNameSchema.safeParse("NV-Card").success).toBe(false);
    expect(blockClassNameSchema.safeParse("ok-one nv-card").success).toBe(false);
  });

  it("refuses anything that could terminate a selector or an attribute", () => {
    for (const bad of ['a"b', "a'b", "a.b", "a{b", "a>b", "a:hover", "a,b", "a[b]", "a/*b"]) {
      expect(blockClassNameSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("refuses an empty handle and a class starting with a digit", () => {
    expect(blockClassNameSchema.safeParse("").success).toBe(false);
    expect(blockClassNameSchema.safeParse("   ").success).toBe(false);
    expect(blockClassNameSchema.safeParse("2cool").success).toBe(false);
  });

  it("is bounded — a handle is a hook, not a stylesheet", () => {
    expect(blockClassNameSchema.safeParse("a b c d").success).toBe(true);
    expect(blockClassNameSchema.safeParse("a b c d e").success).toBe(false);
    expect(blockClassNameSchema.safeParse("a".repeat(121)).success).toBe(false);
  });

  it("is optional on a node, so documents written before it still parse", () => {
    expect(blockNodeSchema.safeParse(heading()).success).toBe(true);
    expect(blockNodeSchema.safeParse(heading({ className: "nav-tile" })).success).toBe(true);
    expect(blockNodeSchema.safeParse({ ...heading(), className: "nv-x" }).success).toBe(false);
  });
});

// ── The tree op ─────────────────────────────────────────────────────────────

describe("updateBlockClassName", () => {
  const regions = () => ({ main: [heading()] });

  it("sets a handle", () => {
    expect(updateBlockClassName(regions(), "h", "nav-tile").main![0]!.className).toBe("nav-tile");
  });

  it("DELETES the field when cleared, rather than storing an empty string", () => {
    // Same rule as the variant and the audience: draft-vs-live "pending" is a
    // `JSON.stringify`, so setting a handle and removing it must leave the document
    // byte-identical or the editor reports an edit that did not happen.
    const before = regions();
    const cleared = updateBlockClassName(updateBlockClassName(before, "h", "x"), "h", undefined);
    expect("className" in cleared.main![0]!).toBe(false);
    expect(JSON.stringify(cleared)).toBe(JSON.stringify(before));
  });

  it("normalises whitespace, so one handle cannot be stored two ways", () => {
    expect(updateBlockClassName(regions(), "h", "  a   b  ").main![0]!.className).toBe("a b");
    expect("className" in updateBlockClassName(regions(), "h", "   ").main![0]!).toBe(false);
  });

  it("returns the input untouched for an unknown id, so no autosave fires", () => {
    const before = regions();
    expect(updateBlockClassName(before, "nope", "x")).toBe(before);
  });

  it("reaches a nested block", () => {
    const nested = { main: [{ id: "s", type: "section", props: {}, children: [heading()] }] };
    expect(updateBlockClassName(nested, "h", "deep").main![0]!.children![0]!.className).toBe("deep");
  });
});

// ── The wrapper ─────────────────────────────────────────────────────────────

describe("the rendered handle", () => {
  it("appears on the LIVE site, not only in the editor preview", () => {
    render(<LayoutRegion document={doc([heading({ className: "nav-tile" })])} region="main" />);
    const el = document.querySelector(".nav-tile") as HTMLElement;
    expect(el).toBeTruthy();
    expect(el.querySelector(".nv-heading")).toBeTruthy();
  });

  it("generates NO box — the block's own element stays the one its parent sizes", () => {
    render(<LayoutRegion document={doc([heading({ className: "nav-tile" })])} region="main" />);
    expect((document.querySelector(".nav-tile") as HTMLElement).style.display).toBe("contents");
  });

  it("shares ONE wrapper with the variant instead of nesting two", () => {
    render(<LayoutRegion
      document={doc([heading({ className: "nav-tile", variant: "accent" })])} region="main" />);
    const el = document.querySelector(".nv-v--accent") as HTMLElement;
    expect(el.classList.contains("nav-tile")).toBe(true);
    expect(el.querySelector(".nav-tile")).toBeNull();
  });

  it("adds no handle class when the block has none", () => {
    render(<LayoutRegion document={doc([heading()])} region="main" />);
    // The wrapper is unconditional now — it carries the block's type class — so the
    // assertion is about what is NOT on it, not about whether it exists.
    const wrapper = (document.querySelector(".nv-region") as HTMLElement)
      .firstElementChild as HTMLElement;
    // `nv-block` is on every wrapper whatever the block is — it is what lets a rail
    // or a column ask "did anything in here draw?"; `nv-b--heading` says which block.
    expect(wrapper.className).toBe("nv-block nv-b--heading");
    expect(wrapper.firstElementChild!.classList.contains("nv-heading")).toBe(true);
  });

  it("works on a leaf, which is the case it exists for", () => {
    // An image tile in a custom navbar: the variant picker refuses leaves, the handle
    // must not.
    render(<LayoutRegion document={doc([
      { id: "i", type: "image", props: { source: "a.png", ratio: "1:1" }, className: "nav-tile" },
    ])} region="main" />);
    expect(document.querySelector(".nav-tile .nv-image img")).toBeTruthy();
  });
});

// ── The image link ──────────────────────────────────────────────────────────

describe("linkHrefSchema", () => {
  it("accepts the shapes a nav tile actually uses", () => {
    for (const ok of ["/forum", "forum/1", "../up", "https://x.test/a", "mailto:a@b.test", "#top"]) {
      expect(linkHrefSchema.safeParse(ok).success).toBe(true);
    }
  });

  it("REFUSES script-bearing and data URLs, however they are disguised", () => {
    // A `.nvtheme` from a stranger is a way into this field, so the refusal has to
    // survive the whitespace and control characters an href tolerates.
    const disguised = [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "java\tscript:alert(1)",
      "java\nscript:alert(1)",
      "java script:alert(1)",
      " javascript:alert(1)",
      "vbscript:x",
      "data:text/html;base64,PHN2Zz4=",
    ];
    for (const bad of disguised) {
      expect(linkHrefSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("the image block", () => {
  const image = (props: Record<string, unknown>): BlockNode =>
    ({ id: "i", type: "image", props: { source: "tile.png", ratio: "1:1", ...props } });

  it("renders a bare image when no href is set", () => {
    render(<LayoutRegion document={doc([image({})])} region="main" />);
    expect(document.querySelector(".nv-image a")).toBeNull();
    expect(document.querySelector(".nv-image img")).toBeTruthy();
  });

  it("wraps the image in a link when one is — the image navbar case", () => {
    render(<LayoutRegion document={doc([image({ href: "/forum" })])} region="main" />);
    const a = document.querySelector(".nv-image__link") as HTMLAnchorElement;
    expect(a.getAttribute("href")).toBe("/forum");
    expect(a.getAttribute("rel")).toContain("noopener");
    expect(a.querySelector("img")).toBeTruthy();
  });

  it("keeps href optional in the prop schema", () => {
    expect(blockPropSchemas.image.safeParse({ source: "a.png" }).success).toBe(true);
    expect(blockPropSchemas.image.safeParse({ source: "a.png", href: "javascript:x" }).success)
      .toBe(false);
  });
});
