import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUTS, type BlockNode } from "@xentium/contracts";
import { activeFooterPreset, activeHeaderPreset, footerPreset, headerPreset } from "./chromePresets";

const header = () => structuredClone(DEFAULT_LAYOUTS["chrome.header"].regions) as Record<string, BlockNode[]>;
const footer = () => structuredClone(DEFAULT_LAYOUTS["chrome.footer"].regions) as Record<string, BlockNode[]>;
const types = (nodes: BlockNode[]) => nodes.map((n) => n.type);

describe("header presets", () => {
  it("the shipped header IS the 'band below' preset", () => {
    expect(activeHeaderPreset(header())).toBe("below");
  });

  it("arranges each style and is recognised again afterwards", () => {
    const above = headerPreset(header(), "above");
    expect(types(above.header!)).toEqual(["header", "navbar"]);
    expect(above.header![0]!.props.showButtons).toBe(true);
    expect(activeHeaderPreset(above)).toBe("above");

    const row = headerPreset(header(), "row");
    expect(row.header!.find((n) => n.type === "header")!.props.showMasthead).toBe(false);
    expect(activeHeaderPreset(row)).toBe("row");

    const centred = headerPreset(header(), "centred");
    expect(centred.header![0]!.props.logoAlign).toBe("center");
    expect(activeHeaderPreset(centred)).toBe("centred");
  });

  it("keeps the site's band colours and navbar tone", () => {
    const now = header();
    now.header!.find((n) => n.type === "header")!.props.backgroundGradient = ["#111111", "#222222"];
    now.header!.find((n) => n.type === "navbar")!.props.tone = "dark";
    const out = headerPreset(now, "above");
    expect(out.header!.find((n) => n.type === "header")!.props.backgroundGradient).toEqual(["#111111", "#222222"]);
    expect(out.header!.find((n) => n.type === "navbar")!.props.tone).toBe("dark");
  });
});

describe("footer presets", () => {
  it("the shipped footer IS 'full', and the others drop pieces", () => {
    expect(activeFooterPreset(footer())).toBe("full");
    expect(types(footerPreset(footer(), "minimal").footer![0]!.children!)).toEqual(["footerBar"]);
    expect(types(footerPreset(footer(), "community").footer![0]!.children!)).toEqual(["whosOnline", "boardStats", "footerBar"]);
    expect(activeFooterPreset(footerPreset(footer(), "minimal"))).toBe("minimal");
  });
});
