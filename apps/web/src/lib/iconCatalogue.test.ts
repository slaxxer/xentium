import { describe, expect, it } from "vitest";
import { faChessKnight } from "@fortawesome/free-solid-svg-icons";
import { bundledIcon, bundledIconNames, registerBundledIcons } from "./iconCatalogue";

describe("registerBundledIcons", () => {
  it("adds a plugin's icons to the bundled tier, once", () => {
    expect(bundledIcon("chess-knight")).toBeUndefined();
    const before = bundledIconNames().length;
    registerBundledIcons([faChessKnight, faChessKnight]);
    expect(bundledIcon("chess-knight")).toBe(faChessKnight);
    expect(bundledIconNames()).toContain("chess-knight");
    expect(bundledIconNames().length).toBe(before + 1);
  });
});
