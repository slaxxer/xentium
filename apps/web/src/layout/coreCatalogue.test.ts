/**
 * Every core block type is complete in the editor: its own glyph in the tree and the
 * library, and its own picture in the block catalogue. A missing entry falls back
 * quietly (to the category), which is exactly why nothing else would notice.
 */
import { describe, expect, it } from "vitest";
import { blockPropSchemas } from "@xentium/contracts";
import { ICON_TYPES } from "./blockIcons";
import { SHAPE_TYPES } from "./blockArt";
import en from "../../public/locales/en/acp.json";

const CORE = Object.keys(blockPropSchemas);

describe("the core block catalogue", () => {
  it("gives every core block its own icon", () => {
    const missing = CORE.filter((t) => !ICON_TYPES.includes(t));
    expect(missing, `no icon: ${missing.join(", ")}`).toEqual([]);
  });

  it("gives every core block its own catalogue picture", () => {
    const missing = CORE.filter((t) => !SHAPE_TYPES.includes(t));
    expect(missing, `no picture: ${missing.join(", ")}`).toEqual([]);
  });

  it("describes every core block (the inspector's about line and the catalogue)", () => {
    const desc = (en as { layoutEditor: { blockDesc: Record<string, string> } }).layoutEditor.blockDesc;
    const missing = CORE.filter((t) => !desc[t]);
    expect(missing, `no description: ${missing.join(", ")}`).toEqual([]);
  });
});
