import { afterEach, describe, expect, it } from "vitest";
import { blockPanelsFor, deregisterBlockPanelsFor, registerBlockPanel, type BlockPanel } from "./blockPanelRegistry";

const panel = (over: Partial<BlockPanel> = {}): BlockPanel => ({
  id: "test.ring", pluginId: "test-plugin", blockTypes: ["profileAvatar"], title: () => "Ring", Panel: () => null, ...over,
});

describe("block panels", () => {
  afterEach(() => { deregisterBlockPanelsFor("test-plugin"); deregisterBlockPanelsFor("other-plugin"); });

  it("shows a panel on the blocks it names, and nowhere else", () => {
    registerBlockPanel(panel());
    expect(blockPanelsFor("profileAvatar").map((p) => p.id)).toEqual(["test.ring"]);
    expect(blockPanelsFor("header")).toEqual([]);
  });

  it("refuses a bare id and another plugin's id", () => {
    expect(() => registerBlockPanel(panel({ id: "ring" }))).toThrow();
    registerBlockPanel(panel());
    expect(() => registerBlockPanel(panel({ pluginId: "other-plugin" }))).toThrow();
  });

  it("forgets a plugin's panels when it goes", () => {
    registerBlockPanel(panel());
    deregisterBlockPanelsFor("test-plugin");
    expect(blockPanelsFor("profileAvatar")).toEqual([]);
  });
});
