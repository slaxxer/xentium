import { describe, it, expect } from "vitest";
import {
  parseShadow, formatShadow, shadowValueFor, parseColor, formatColor,
  SHADOW_SOFT, SHADOW_STRONG, SHADOW_SEED,
  type ShadowParts,
} from "./shadowValue";

const base: ShadowParts = {
  inset: false, top: false, bottom: true, left: false, right: false,
  distance: 6, blur: 24, spread: 0, color: "#1e285a", alpha: 0.08,
};

describe("parseColor", () => {
  it("reads rgba, rgb, and hex in three lengths", () => {
    expect(parseColor("rgba(30, 40, 90, 0.08)")).toEqual({ color: "#1e285a", alpha: 0.08 });
    expect(parseColor("rgb(0,0,0)")).toEqual({ color: "#000000", alpha: 1 });
    expect(parseColor("#abc")).toEqual({ color: "#aabbcc", alpha: 1 });
    expect(parseColor("#1E285A")).toEqual({ color: "#1e285a", alpha: 1 });
    expect(parseColor("#00000080")).toEqual({ color: "#000000", alpha: expect.closeTo(0.5, 2) });
  });

  it("reads the slash and percentage forms", () => {
    expect(parseColor("rgb(0 0 0 / 50%)")).toEqual({ color: "#000000", alpha: 0.5 });
  });

  it("refuses what it cannot represent, rather than guessing", () => {
    expect(parseColor("hsl(210 40% 20%)")).toBeNull();
    expect(parseColor("color-mix(in srgb, red, blue)")).toBeNull();
    expect(parseColor("currentColor")).toBeNull();
  });
});

describe("formatColor", () => {
  it("keeps an opaque colour as hex, so it reads like every other row", () => {
    expect(formatColor("#1e285a", 1)).toBe("#1e285a");
  });
  it("emits rgba below full opacity", () => {
    expect(formatColor("#1e285a", 0.08)).toBe("rgba(30, 40, 90, 0.08)");
  });
});

describe("parseShadow", () => {
  it("recognises none and the two presets", () => {
    expect(parseShadow("none").kind).toBe("none");
    expect(parseShadow("").kind).toBe("none");
    expect(parseShadow(undefined).kind).toBe("none");
    expect(parseShadow(SHADOW_SOFT).kind).toBe("soft");
    expect(parseShadow(SHADOW_STRONG).kind).toBe("strong");
  });

  it("reads a full shadow into its parts", () => {
    const v = parseShadow("0px 6px 24px 0px rgba(30, 40, 90, 0.08)");
    expect(v).toEqual({ kind: "custom", parts: base });
  });

  it("reads inset", () => {
    const v = parseShadow("inset 0px 6px 24px 0px rgba(30, 40, 90, 0.08)");
    expect(v.kind).toBe("custom");
    expect((v as { parts: ShadowParts }).parts.inset).toBe(true);
  });

  it("infers direction and distance from the offsets", () => {
    const up = parseShadow("0px -8px 10px 0px #000000") as { parts: ShadowParts };
    expect(up.parts).toMatchObject({ top: true, bottom: false, distance: 8 });

    const dl = parseShadow("-4px 4px 10px 0px #000000") as { parts: ShadowParts };
    expect(dl.parts).toMatchObject({ left: true, right: false, bottom: true, top: false, distance: 4 });

    const centred = parseShadow("0px 0px 12px 0px #000000") as { parts: ShadowParts };
    expect(centred.parts).toMatchObject({ top: false, bottom: false, left: false, right: false });
  });

  it("tolerates a missing blur and spread", () => {
    const v = parseShadow("0px 4px #000000") as { parts: ShadowParts };
    expect(v.parts).toMatchObject({ blur: 0, spread: 0, distance: 4, bottom: true });
  });

  /**
   * The controls carry ONE distance for both axes, so an offset whose non-zero
   * components differ cannot be shown without changing it. Rewriting an admin's
   * `4px 12px` into `12px 12px` the moment they open the row would be a silent edit,
   * so it stays raw and is edited as text.
   */
  it("refuses an offset the direction model would rewrite", () => {
    expect(parseShadow("4px 12px 10px 0px #000000")).toEqual({
      kind: "raw", value: "4px 12px 10px 0px #000000",
    });
  });

  it("keeps a stacked shadow verbatim rather than dropping layers", () => {
    const two = "0px 1px 2px #000000, 0px 8px 16px #111111";
    expect(parseShadow(two)).toEqual({ kind: "raw", value: two });
  });

  it("keeps anything else verbatim", () => {
    expect(parseShadow("var(--something-else)").kind).toBe("raw");
    expect(parseShadow("0px 4px 10px 0px hsl(210 40% 20%)").kind).toBe("raw");
  });
});

describe("round trip", () => {
  // The correctness condition for the whole control: opening a row and closing it
  // without touching a slider must not change the stored value.
  const cases = [
    "0px 6px 24px 0px rgba(30, 40, 90, 0.08)",
    "inset 0px -8px 12px 2px rgba(0, 0, 0, 0.34)",
    "-6px 6px 20px -4px rgba(0, 0, 0, 0.5)",
    "0px 0px 30px 0px #1e285a",
  ];
  for (const css of cases) {
    it(`survives ${css}`, () => {
      const v = parseShadow(css);
      expect(v.kind).toBe("custom");
      expect(formatShadow((v as { parts: ShadowParts }).parts)).toBe(css);
    });
  }
});

describe("formatShadow", () => {
  it("cancels opposite sides to a centred offset", () => {
    expect(formatShadow({ ...base, top: true, bottom: true }))
      .toBe("0px 0px 24px 0px rgba(30, 40, 90, 0.08)");
  });

  it("emits a negative spread", () => {
    expect(formatShadow({ ...base, spread: -4 }))
      .toBe("0px 6px 24px -4px rgba(30, 40, 90, 0.08)");
  });
});

describe("shadowValueFor", () => {
  it("writes the preset REFERENCE, not its resolved value", () => {
    // A site set to "Soft" should keep following the theme's idea of soft.
    expect(shadowValueFor("soft", base, "")).toBe(SHADOW_SOFT);
    expect(shadowValueFor("strong", base, "")).toBe(SHADOW_STRONG);
    expect(shadowValueFor("none", base, "")).toBe("none");
  });

  it("writes real numbers for custom, and leaves raw alone", () => {
    expect(shadowValueFor("custom", base, "")).toBe("0px 6px 24px 0px rgba(30, 40, 90, 0.08)");
    expect(shadowValueFor("raw", base, "whatever it was")).toBe("whatever it was");
  });
});

describe("seeds", () => {
  it("round-trips every seed, so opening Custom never rewrites what it shows", () => {
    for (const mode of ["light", "dark"] as const) {
      for (const kind of ["soft", "strong"] as const) {
        const parts = SHADOW_SEED[mode][kind];
        expect(parseShadow(formatShadow(parts))).toEqual({ kind: "custom", parts });
      }
    }
  });
});
