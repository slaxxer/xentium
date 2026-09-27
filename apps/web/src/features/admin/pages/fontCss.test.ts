import { describe, it, expect } from "vitest";
import { fontRootDecls, fontBodyRule, FONT_FAMILIES, FONT_STACKS } from "@xentium/contracts";

/**
 * The API's `buildCSS` and the Style Editor's live preview both build the site font
 * from these. They used to build it separately, and diverged in the two ways that
 * matter most: the preview never emitted the WEIGHT, so the control looked broken,
 * and it sized the page with `html { font-size }` — rescaling every rem — where
 * production sets `body { font-size }`. A preview that does not render what ships is
 * worse than no preview.
 */
describe("site font CSS", () => {
  it("emits the family site-wide — body and headings", () => {
    expect(fontRootDecls({ family: "Nunito" })).toEqual([
      "  --ff-sans: Nunito, sans-serif;",
      "  --font-display: Nunito, sans-serif;",
    ]);
  });

  it("emits the weight, which the preview used to drop", () => {
    expect(fontRootDecls({ weight: "700" })).toContain("  --fw-body: 700;");
    expect(fontBodyRule({ weight: "700" })).toContain("font-weight: var(--fw-body);");
  });

  it("sizes through the text scale, never by rescaling the root", () => {
    // 18px means every step is 18/16 of its default — all text, not only the body.
    expect(fontRootDecls({ size: "18" })).toContain("  --fs-scale: 1.125;");
    expect(fontRootDecls({ size: "13" })).toContain("  --fs-scale: 0.8125;");
    expect(fontRootDecls({ size: "junk" }).some((d) => d.includes("--fs-scale"))).toBe(false);
    const rule = fontBodyRule({ size: "13" })!;
    expect(rule).toContain("font-size: var(--fs-base);");
    expect(rule.startsWith("body, input, textarea, select, button {")).toBe(true);
    expect(rule).not.toMatch(/^html/);
  });

  it("quotes a family that needs it", () => {
    expect(FONT_STACKS["Open Sans"]).toBe('"Open Sans", sans-serif');
  });

  it("has a stack for every offered family", () => {
    expect(FONT_FAMILIES.filter((f) => !FONT_STACKS[f])).toEqual([]);
  });

  it("emits nothing when nothing is set, so the app keeps its bundled type", () => {
    expect(fontRootDecls({})).toEqual([]);
    expect(fontBodyRule({})).toBeNull();
  });

  it("ignores a family with no stack rather than emitting a broken declaration", () => {
    expect(fontRootDecls({ family: "Comic Sans" })).toEqual([]);
  });

  /**
   * The rule targets `body`, and `body.xt-acp` IS a body — which is how the site's
   * size and weight leaked into the admin panel. The ACP opts out by re-pinning all
   * four custom properties (AcpLayout.scss), so the rule must keep addressing them
   * through variables rather than literal values.
   */
  it("applies every property through a variable, so the ACP can opt out", () => {
    const rule = fontBodyRule({ family: "Poppins", weight: "700", size: "13" })!;
    for (const decl of rule.split("\n").slice(1, -1)) {
      expect(decl.trim()).toMatch(/^[a-z-]+: var\(--[a-z-]+\);$/);
    }
  });
});
