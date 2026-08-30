/**
 * Style variants (ADR-0005): the document field, the tree op, and the wrapper.
 *
 * @vitest-environment jsdom
 *
 * The load-bearing claim is that the variant wrapper exists on the LIVE site and is
 * `display: contents`. Both halves matter: without the wrapper a variant does nothing
 * outside the editor, and with a real box it would silently break the navbar's flex
 * rules and every `column.width` track — the same reason the preview wrapper is
 * `display: contents`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  BLOCK_VARIANTS,
  SCOPE_SELECTOR,
  blockNodeSchema,
  variantClass,
  variantScopeId,
  type BlockNode,
  type LayoutDocument,
} from "@nodevo/contracts";
import { LayoutRegion } from "./LayoutRenderer";
import { updateBlockVariant } from "./blockTree";
import "./blocks/coreBlocks";

afterEach(cleanup);

const heading = (extra: Partial<BlockNode> = {}): BlockNode =>
  ({ id: "h", type: "heading", props: { text: "Hi", level: 2 }, ...extra });

const doc = (nodes: BlockNode[]): LayoutDocument =>
  ({ templateKey: "home", schemaVersion: 1, regions: { main: nodes } });

// ── The contract ────────────────────────────────────────────────────────────

describe("the variant field", () => {
  it("accepts every variant this build defines", () => {
    for (const v of BLOCK_VARIANTS) {
      expect(blockNodeSchema.safeParse(heading({ variant: v })).success).toBe(true);
    }
  });

  it("rejects a variant it does not know", () => {
    // A stored document — including one from a `.nvtheme` — must not be able to name a
    // look the renderer has no class for.
    expect(blockNodeSchema.safeParse({ ...heading(), variant: "neon" }).success).toBe(false);
  });

  it("is optional, so documents written before variants existed still parse", () => {
    expect(blockNodeSchema.safeParse(heading()).success).toBe(true);
  });

  it("gives every variant a scope AND a selector — the drift guard", () => {
    // Adding a variant without a selector would store overrides that buildCSS then
    // silently skips, which looks exactly like the save failing.
    for (const v of BLOCK_VARIANTS) {
      const scope = variantScopeId(v);
      expect(SCOPE_SELECTOR[scope]).toBe(`.${variantClass(v)}`);
    }
  });
});

// ── The tree op ─────────────────────────────────────────────────────────────

describe("updateBlockVariant", () => {
  const regions = () => ({ main: [heading()] });

  it("sets a variant", () => {
    const next = updateBlockVariant(regions(), "h", "accent");
    expect(next.main![0]!.variant).toBe("accent");
  });

  it("DELETES the field when cleared, rather than storing a default", () => {
    // Draft-vs-live "pending" is a `JSON.stringify` comparison, so applying a variant
    // and removing it again has to leave the document byte-identical.
    const before = regions();
    const applied = updateBlockVariant(before, "h", "muted");
    const cleared = updateBlockVariant(applied, "h", undefined);
    expect("variant" in cleared.main![0]!).toBe(false);
    expect(JSON.stringify(cleared)).toBe(JSON.stringify(before));
  });

  it("returns the input untouched for an unknown id, so no autosave fires", () => {
    const before = regions();
    expect(updateBlockVariant(before, "nope", "accent")).toBe(before);
  });

  it("reaches a nested block", () => {
    const nested = {
      main: [{ id: "s", type: "section", props: {}, children: [heading()] }],
    };
    const next = updateBlockVariant(nested, "h", "plain");
    expect(next.main![0]!.children![0]!.variant).toBe("plain");
  });
});

// ── The wrapper ─────────────────────────────────────────────────────────────

describe("the rendered wrapper", () => {
  it("stamps the variant class on the LIVE site, not only in the preview", () => {
    render(<LayoutRegion document={doc([heading({ variant: "accent" })])} region="main" />);
    const el = document.querySelector(".nv-v--accent") as HTMLElement;
    expect(el).toBeTruthy();
    expect(el.style.display).toBe("contents");
  });

  it("adds no VARIANT class when the block has no variant", () => {
    render(<LayoutRegion document={doc([heading()])} region="main" />);
    expect(document.querySelector('[class*="nv-v--"]')).toBeNull();
    // There IS still a wrapper — it carries the block's type class, which every block
    // gets so a theme can target one without an admin adding a handle
    // (`classContract.test.tsx`). It stays `display: contents`, so nothing about the
    // variant's safety on a flex or grid parent changes.
    const region = document.querySelector(".nv-region") as HTMLElement;
    const wrapper = region.firstElementChild as HTMLElement;
    expect(wrapper.classList.contains("nv-b--heading")).toBe(true);
    expect(wrapper.style.display).toBe("contents");
    expect(wrapper.firstElementChild!.classList.contains("nv-heading")).toBe(true);
  });

  it("wraps the block itself, so the block's element stays inside", () => {
    render(<LayoutRegion document={doc([heading({ variant: "muted" })])} region="main" />);
    const el = document.querySelector(".nv-v--muted") as HTMLElement;
    expect(el.querySelector(".nv-heading")).toBeTruthy();
  });

  it("applies to a container, whose children then inherit the bucket", () => {
    render(<LayoutRegion document={doc([{
      id: "s", type: "section", props: { width: "normal", padding: "md" },
      variant: "surface",
      children: [heading()],
    }])} region="main" />);
    const el = document.querySelector(".nv-v--surface") as HTMLElement;
    // The section is INSIDE the wrapper — that is what makes custom properties reach
    // it and everything below it.
    expect(el.querySelector(".nv-section .nv-heading")).toBeTruthy();
  });

  it("nests wrappers when a variant sits inside another — variants cascade", () => {
    render(<LayoutRegion document={doc([{
      id: "s", type: "section", props: { width: "normal", padding: "md" },
      variant: "accent",
      children: [heading({ variant: "plain" })],
    }])} region="main" />);
    expect(document.querySelector(".nv-v--accent .nv-v--plain")).toBeTruthy();
  });
});
