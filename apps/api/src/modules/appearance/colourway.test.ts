/**
 * A visitor's colourway: the chosen colourway's tokens go over the theme's global
 * scope — on top of the admin's edits — and an id the theme does not ship is ignored.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { appearanceService, bustThemeCss, parseColourwayId } from "./appearance.service.js";

afterEach(() => { vi.restoreAllMocks(); bustThemeCss(); });

const EMBER = { id: "ember", name: "Ember", tokens: { "--c-accent": "#ff3d4a", "--c-bg": "#0d0808" } };

function stub() {
  vi.spyOn(appearanceService, "getStyleVersion").mockResolvedValue(1);
  vi.spyOn(appearanceService, "getColourways").mockResolvedValue([EMBER]);
  vi.spyOn(appearanceService, "getEffectiveTokens").mockResolvedValue({
    global: { "--c-accent": "#9b5cff", "--c-fg": "#eef0f6" },
    "region.header": { "--c-accent": "#123456" },
  });
  return vi.spyOn(appearanceService, "buildCSS").mockImplementation(async (tokens) => JSON.stringify(tokens));
}

describe("getCssFor with a colourway", () => {
  it("lays the colourway over the global scope and leaves the rest alone", async () => {
    const build = stub();
    await appearanceService.getCssFor("vanguard", "ember");
    expect(build.mock.calls[0]![0]).toEqual({
      global: { "--c-accent": "#ff3d4a", "--c-fg": "#eef0f6", "--c-bg": "#0d0808" },
      "region.header": { "--c-accent": "#123456" },
    });
  });

  it("ignores a colourway the theme does not ship", async () => {
    const build = stub();
    await appearanceService.getCssFor("vanguard", "cryo");
    expect(build.mock.calls[0]![0].global).toEqual({ "--c-accent": "#9b5cff", "--c-fg": "#eef0f6" });
  });

  it("memoises each colourway separately", async () => {
    const build = stub();
    const plain = await appearanceService.getCssFor("vanguard");
    const ember = await appearanceService.getCssFor("vanguard", "ember");
    expect(plain).not.toBe(ember);
    await appearanceService.getCssFor("vanguard", "ember");
    expect(build).toHaveBeenCalledTimes(2);
  });
});

describe("parseColourwayId", () => {
  it("accepts kebab-case ids and nothing else", () => {
    expect(parseColourwayId("ember")).toBe("ember");
    expect(parseColourwayId("deep-sea")).toBe("deep-sea");
    expect(parseColourwayId("<x>")).toBeNull();
    expect(parseColourwayId("Ember")).toBeNull();
    expect(parseColourwayId(["ember"])).toBeNull();
    expect(parseColourwayId(undefined)).toBeNull();
  });
});
