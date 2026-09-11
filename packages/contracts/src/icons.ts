/**
 * The icon styles a FontAwesome kit can draw in.
 *
 * ⚠ Shared by the API (which validates the setting) and the web app (which turns it
 * into classes). It lives in contracts because it was previously written out twice
 * with a "keep these in step" comment, which is a promise no one can keep.
 *
 * A style is a FAMILY plus a WEIGHT. Classic has no family prefix; everything else
 * names one. `solid` is the odd one out: it is the bundled free set and the only
 * value that needs no kit at all.
 *
 * ⚠ BRANDS IS DELIBERATELY ABSENT. It appears in every kit's style list, but it is
 * not a weight — it is a separate icon set (GitHub, X, Discord). Applying it
 * site-wide would ask for `fa-brands fa-star`, which does not exist, and every icon
 * in the product would vanish at once.
 */

export type IconStyleGroup = "classic" | "duotone" | "sharp" | "sharpDuotone" | "proPlus";

export interface IconStyleDef {
  /** Stored in `appearance.icons.style`. */
  id:      string;
  /** FontAwesome's own product name. NOT translated — these are brand terms. */
  label:   string;
  /** The classes prepended to `fa-<name>`. */
  classes: string;
  group:   IconStyleGroup;
  /**
   * ⚠ Whether this family covers the whole icon library.
   *
   * Classic, Duotone and Sharp draw every icon. The Pro+ families are stylised sets
   * with partial coverage, so a site-wide choice can leave individual icons blank
   * with nothing to fall back to — the kit simply has no glyph under that name. The
   * ACP warns before one is chosen.
   */
  full:    boolean;
}

const classic = (id: string, label: string, weight: string): IconStyleDef =>
  ({ id, label, classes: `fa-${weight}`, group: "classic", full: true });

const family = (
  group: IconStyleGroup, prefix: string, id: string, label: string, weight: string, full = true,
): IconStyleDef => ({ id, label, classes: `fa-${prefix} fa-${weight}`, group, full });

export const ICON_STYLE_DEFS: readonly IconStyleDef[] = [
  // Classic — `solid` is the bundled free set and the default.
  classic("solid",   "Solid",   "solid"),
  classic("regular", "Regular", "regular"),
  classic("light",   "Light",   "light"),
  classic("thin",    "Thin",    "thin"),

  family("duotone", "duotone", "duotone-solid",   "Duotone Solid",   "solid"),
  family("duotone", "duotone", "duotone-regular", "Duotone Regular", "regular"),
  family("duotone", "duotone", "duotone-light",   "Duotone Light",   "light"),
  family("duotone", "duotone", "duotone-thin",    "Duotone Thin",    "thin"),

  family("sharp", "sharp", "sharp-solid",   "Sharp Solid",   "solid"),
  family("sharp", "sharp", "sharp-regular", "Sharp Regular", "regular"),
  family("sharp", "sharp", "sharp-light",   "Sharp Light",   "light"),
  family("sharp", "sharp", "sharp-thin",    "Sharp Thin",    "thin"),

  family("sharpDuotone", "sharp-duotone", "sharp-duotone-solid",   "Sharp Duotone Solid",   "solid"),
  family("sharpDuotone", "sharp-duotone", "sharp-duotone-regular", "Sharp Duotone Regular", "regular"),
  family("sharpDuotone", "sharp-duotone", "sharp-duotone-light",   "Sharp Duotone Light",   "light"),
  family("sharpDuotone", "sharp-duotone", "sharp-duotone-thin",    "Sharp Duotone Thin",    "thin"),

  /**
   * Pro+ families. Each ships exactly ONE weight — they are drawn styles, not a
   * weight axis — so the id carries that weight and there is nothing to choose.
   */
  family("proPlus", "chisel",         "chisel-regular",          "Chisel",          "regular",  false),
  family("proPlus", "etch",           "etch-solid",              "Etch",            "solid",    false),
  family("proPlus", "graphite",       "graphite-thin",           "Graphite",        "thin",     false),
  family("proPlus", "jelly",          "jelly-regular",           "Jelly",           "regular",  false),
  family("proPlus", "jelly-duo",      "jelly-duo-regular",       "Jelly Duo",       "regular",  false),
  family("proPlus", "jelly-fill",     "jelly-fill-regular",      "Jelly Fill",      "regular",  false),
  family("proPlus", "mosaic",         "mosaic-solid",            "Mosaic",          "solid",    false),
  family("proPlus", "notdog",         "notdog-solid",            "Notdog",          "solid",    false),
  family("proPlus", "notdog-duo",     "notdog-duo-solid",        "Notdog Duo",      "solid",    false),
  family("proPlus", "pixel",          "pixel-regular",           "Pixel",           "regular",  false),
  family("proPlus", "slab",           "slab-regular",            "Slab",            "regular",  false),
  family("proPlus", "slab-duo",       "slab-duo-regular",        "Slab Duo",        "regular",  false),
  family("proPlus", "slab-press",     "slab-press-regular",      "Slab Press",      "regular",  false),
  family("proPlus", "slab-press-duo", "slab-press-duo-regular",  "Slab Press Duo",  "regular",  false),
  family("proPlus", "thumbprint",     "thumbprint-light",        "Thumbprint",      "light",    false),
  family("proPlus", "utility",        "utility-semibold",        "Utility",         "semibold", false),
  family("proPlus", "utility-duo",    "utility-duo-semibold",    "Utility Duo",     "semibold", false),
  family("proPlus", "utility-fill",   "utility-fill-semibold",   "Utility Fill",    "semibold", false),
  family("proPlus", "vellum",         "vellum-solid",            "Vellum",          "solid",    false),
  family("proPlus", "whiteboard",     "whiteboard-semibold",     "Whiteboard",      "semibold", false),
] as const;

export const ICON_STYLES = ICON_STYLE_DEFS.map((s) => s.id) as readonly string[];

/** The default, and the only style that draws without a kit. */
export const DEFAULT_ICON_STYLE = "solid";

const BY_ID = new Map(ICON_STYLE_DEFS.map((s) => [s.id, s]));

export function isIconStyle(v: unknown): v is string {
  return typeof v === "string" && BY_ID.has(v);
}

export function iconStyleDef(id: string): IconStyleDef | undefined {
  return BY_ID.get(id);
}

/**
 * The classes for a style, or null when the bundled free set should be used.
 *
 * ⚠ Returns null for `solid` AND for anything unrecognised. Emitting a class nothing
 * defines would leave every icon on the page blank, which is far worse than plain
 * ones — so an unknown value degrades to the bundled set rather than to nothing.
 */
export function iconStyleClasses(id: string): string | null {
  if (id === DEFAULT_ICON_STYLE) return null;
  return BY_ID.get(id)?.classes ?? null;
}

// ── Icon tokens ─────────────────────────────────────────────────────────────

/**
 * How an icon is STORED wherever one is data — a badge's glyph, a block's prop.
 *
 * Two shapes, and the difference is the whole point:
 *
 *   "star"                 follow the site's icon style
 *   "jelly-regular:star"   pinned to Jelly, whatever the site is set to
 *
 * ⚠ Unpinned is the DEFAULT and should stay the common case. It is what lets an
 * admin restyle the entire product from one select; every pin is a small exception
 * carved out of that, which is exactly why pinning is opt-in and explicit rather
 * than something the picker writes by default.
 *
 * ⚠ Legacy `faStar` is accepted and read as `star`. Badges shipped with camelCase
 * names before tokens existed, and a tolerant reader is cheaper and safer than a
 * migration over rows an admin may have hand-edited.
 */
export interface IconToken {
  /** A style id, or null to follow the site's setting. */
  style: string | null;
  /** A FontAwesome icon name, already lowercase-kebab (`user-astronaut`). */
  name:  string;
}

/** ⚠ This ends up in a class attribute. Closed charset, always. */
const ICON_NAME = /^[a-z0-9-]{1,60}$/;

/** `faUserAstronaut` → `user-astronaut`. */
function fromCamel(v: string): string {
  return v.slice(2).replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

export function parseIconToken(raw: unknown): IconToken | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v) return null;

  const colon = v.indexOf(":");
  if (colon === -1) {
    const name = /^fa[A-Z][A-Za-z0-9]*$/.test(v) ? fromCamel(v) : v;
    return ICON_NAME.test(name) ? { style: null, name } : null;
  }

  const style = v.slice(0, colon);
  const name  = v.slice(colon + 1);
  // ⚠ An unknown STYLE is not a reason to drop the icon. The name is the part the
  // admin chose; a style that no longer exists degrades to "follow the site".
  if (!ICON_NAME.test(name)) return null;
  return { style: isIconStyle(style) ? style : null, name };
}

export function formatIconToken(style: string | null, name: string): string {
  return style && style !== DEFAULT_ICON_STYLE ? `${style}:${name}` : name;
}
