/**
 * The icon style table.
 *
 * ⚠ Lives here rather than in `packages/contracts`, which has no test runner —
 * the same reason `templateAdoption` and `styleTokens` test contract data from the
 * web app. It is still a CONTRACTS test: change the table, run this.
 *
 * ⚠ This list is the contract between the API (which validates the stored setting)
 * and the browser (which turns it into classes). A style that validates but produces
 * no classes, or classes the kit does not define, blanks every icon in the product
 * at once — so the invariants below matter more than they look.
 */
import { describe, it, expect } from "vitest";
import {
  ICON_STYLE_DEFS, ICON_STYLES, DEFAULT_ICON_STYLE,
  isIconStyle, iconStyleClasses, iconStyleDef,
  parseIconToken, formatIconToken,
} from "@xentium/contracts";

describe("the table", () => {
  it("has unique ids", () => {
    expect(new Set(ICON_STYLES).size).toBe(ICON_STYLES.length);
  });

  /** Every id must be resolvable, or validation would accept an unusable value. */
  it("resolves every id it validates", () => {
    for (const id of ICON_STYLES) {
      expect(isIconStyle(id)).toBe(true);
      expect(iconStyleDef(id)).toBeDefined();
    }
  });

  it("builds classes from a family and a weight", () => {
    expect(iconStyleClasses("light")).toBe("fa-light");
    expect(iconStyleClasses("duotone-light")).toBe("fa-duotone fa-light");
    expect(iconStyleClasses("sharp-thin")).toBe("fa-sharp fa-thin");
    expect(iconStyleClasses("sharp-duotone-solid")).toBe("fa-sharp-duotone fa-solid");
    expect(iconStyleClasses("slab-press-duo-regular")).toBe("fa-slab-press-duo fa-regular");
    expect(iconStyleClasses("utility-semibold")).toBe("fa-utility fa-semibold");
  });

  /** ⚠ Only lowercase, digits and hyphens — these strings are written as markup. */
  it("emits nothing but safe class characters", () => {
    for (const d of ICON_STYLE_DEFS) {
      expect(d.classes).toMatch(/^[a-z0-9- ]+$/);
    }
  });
});

describe("degrading safely", () => {
  /** The bundled free set. Rendering it as a class would be wrong, not just useless. */
  it("gives the default no classes at all", () => {
    expect(DEFAULT_ICON_STYLE).toBe("solid");
    expect(iconStyleClasses("solid")).toBeNull();
  });

  /**
   * ⚠ An unknown style must fall back to the BUNDLED set, never to an undefined
   * class. A stale row from an older version, or a hand-edited database, would
   * otherwise leave a site with no visible icons anywhere.
   */
  it("falls back to the bundled set for anything unknown", () => {
    for (const v of ["", "nonsense", "fa-light", "SOLID", null, undefined, 7, {}]) {
      expect(isIconStyle(v)).toBe(false);
      expect(iconStyleClasses(v as string)).toBeNull();
    }
  });
});

describe("what is deliberately absent", () => {
  /**
   * ⚠ BRANDS. It is listed in every kit's styles, so it is an easy thing to add by
   * mistake — but it is a separate ICON SET, not a weight. Applying it site-wide
   * would ask for `fa-brands fa-star`, which does not exist, and every icon in the
   * product would vanish at once.
   */
  it("has no brands style", () => {
    expect(ICON_STYLES).not.toContain("brands");
    for (const d of ICON_STYLE_DEFS) expect(d.classes).not.toContain("fa-brands");
  });

  /** Coverage is a promise to the admin: only these three families draw everything. */
  it("claims full coverage only for the families that have it", () => {
    const full = ICON_STYLE_DEFS.filter((d) => d.full).map((d) => d.group);
    expect(new Set(full)).toEqual(new Set(["classic", "duotone", "sharp", "sharpDuotone"]));
    expect(ICON_STYLE_DEFS.filter((d) => d.group === "proPlus").every((d) => !d.full)).toBe(true);
  });
});

describe("icon tokens", () => {
  it("reads a plain name as following the site", () => {
    expect(parseIconToken("star")).toEqual({ style: null, name: "star" });
  });

  it("reads a pinned style", () => {
    expect(parseIconToken("jelly-regular:star"))
      .toEqual({ style: "jelly-regular", name: "star" });
  });

  /** ⚠ Badges shipped with camelCase before tokens existed; no migration needed. */
  it("reads a legacy camelCase name", () => {
    expect(parseIconToken("faStar")).toEqual({ style: null, name: "star" });
    expect(parseIconToken("faUserAstronaut")).toEqual({ style: null, name: "user-astronaut" });
  });

  /** ⚠ The NAME survives; only the unusable half is dropped. */
  it("keeps the name when the style is unknown", () => {
    expect(parseIconToken("madeup:star")).toEqual({ style: null, name: "star" });
  });

  it("refuses a name outside the charset", () => {
    for (const v of ['star" x', "star<script>", "../x", "STAR", "", "  ", null, 7]) {
      expect(parseIconToken(v)).toBeNull();
    }
  });

  it("round-trips through format", () => {
    expect(formatIconToken("jelly-regular", "star")).toBe("jelly-regular:star");
    expect(formatIconToken(null, "star")).toBe("star");
    // ⚠ Solid is the bundled set, so pinning to it is the same as not pinning —
    // storing `solid:star` would be a pin that survives a site-style change for no
    // reason the admin asked for.
    expect(formatIconToken("solid", "star")).toBe("star");
  });
});
