/**
 * A block's heading face: stored only when set, drawn on the block's wrapper from the
 * fixed stack map, and refused by the schema for anything not on the list.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { cleanup, render } from "@testing-library/react";
import { HEADING_FONT_STACKS, blockNodeSchema, type BlockNode, type LayoutDocument } from "@xentium/contracts";
import { LayoutRegion } from "./LayoutRenderer";
import { deregisterBlock, registerBlock } from "./blockRegistry";
import { updateBlockHeadingFont } from "./blockTree";

beforeEach(() => {
  deregisterBlock("t.hbox"); deregisterBlock("t.hleaf");
  registerBlock({
    type: "t.hbox", schema: z.object({}), container: true,
    component: ({ children }) => <section className="hbox">{children}</section>,
    editorMeta: { label: "box", category: "structure" },
  });
  registerBlock({
    type: "t.hleaf", schema: z.object({}), component: () => <h2>Title</h2>,
    editorMeta: { label: "leaf", category: "content" },
  });
});
afterEach(cleanup);

const doc = (main: BlockNode[]): LayoutDocument => ({ templateKey: "home", schemaVersion: 1, regions: { main } });

describe("block heading font", () => {
  it("is stored only when set, so clearing it leaves the document as it was", () => {
    const regions = { main: [{ id: "a", type: "t.hleaf", props: {} }] };
    const set = updateBlockHeadingFont(regions, "a", "Bricolage Grotesque");
    expect(set.main![0]!.headingFont).toBe("Bricolage Grotesque");
    const cleared = updateBlockHeadingFont(set, "a", undefined);
    expect(cleared).toEqual(regions);
  });

  it("puts the face on the block's wrapper, which the headings inside inherit", () => {
    render(<LayoutRegion region="main" document={doc([
      { id: "box", type: "t.hbox", props: {}, headingFont: "JetBrains Mono", children: [{ id: "leaf", type: "t.hleaf", props: {} }] },
      { id: "plain", type: "t.hleaf", props: {} },
    ])} />);
    const wrappers = [...document.querySelectorAll<HTMLElement>(".xt-block")];
    const box = wrappers.find((w) => w.querySelector(".hbox"))!;
    expect(box.classList.contains("xt-hf")).toBe(true);
    expect(box.style.getPropertyValue("--xt-heading-font")).toBe(HEADING_FONT_STACKS["JetBrains Mono"]);
    // A block with no face of its own carries nothing.
    const plain = wrappers.filter((w) => !w.querySelector(".hbox")).at(-1)!;
    expect(plain.classList.contains("xt-hf")).toBe(false);
  });

  it("refuses a face that is not on the list — it would become CSS", () => {
    const bad = { id: "a", type: "t.hleaf", props: {}, headingFont: 'x; background: url(//evil)' };
    expect(blockNodeSchema.safeParse(bad).success).toBe(false);
    expect(blockNodeSchema.safeParse({ ...bad, headingFont: "Bricolage Grotesque" }).success).toBe(true);
  });
});
