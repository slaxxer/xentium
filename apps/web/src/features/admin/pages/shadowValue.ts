// Reading and writing a `box-shadow` token value.
//
// The Style Editor offered three presets — None, Soft, Strong — which is enough to
// pick a shadow and not enough to design one. This turns the same token into an
// editable shadow: which way it falls, how far, how soft, how far it spreads, what
// colour, and whether it sits inside the element.
//
// Kept pure and separate from the control so the round trip is testable: a value
// that survives parse → format unchanged is the whole correctness condition, and a
// value that does NOT survive it must be left alone rather than silently rewritten.

/** A shadow the editor can represent with its own controls. */
export interface ShadowParts {
  inset: boolean;
  /** Which way the shadow falls. Opposite sides cancel; neither means centred. */
  top: boolean;
  bottom: boolean;
  left: boolean;
  right: boolean;
  /** Offset magnitude in px, applied along whichever directions are on. */
  distance: number;
  blur: number;
  /** "Spread" — how much the shadow grows before it starts to blur. */
  spread: number;
  /** #rrggbb. Alpha is carried separately so a colour picker can drive it. */
  color: string;
  alpha: number;
}

export type ShadowValue =
  | { kind: "none" }
  | { kind: "soft" }
  | { kind: "strong" }
  | { kind: "custom"; parts: ShadowParts }
  /** Something we can read but not represent — kept verbatim, edited as text. */
  | { kind: "raw"; value: string };

export type ShadowKind = ShadowValue["kind"];

/** The two presets, as the token values actually stored. */
export const SHADOW_SOFT   = "var(--shadow-card)";
export const SHADOW_STRONG = "var(--shadow-pop)";

/**
 * Starting points when switching a preset to Custom.
 *
 * These mirror `--shadow-card` / `--shadow-pop` in `apps/web/src/styles/tokens.scss`,
 * which stays the rendering truth. They are only a seed — every field is on screen
 * and editable the moment the panel opens — so a drift here changes where you start,
 * never what the site renders.
 */
// One pair, for the one palette. The dark seeds went with the scheme switch: a dark
// theme that wants heavier shadows sets `--shadow-card` itself, which is exactly the
// channel a theme has for it.
export const SHADOW_SEED: Record<"soft" | "strong", ShadowParts> = {
  soft:   { inset: false, top: false, bottom: true, left: false, right: false, distance: 6,  blur: 24, spread: 0, color: "#1e285a", alpha: 0.08 },
  strong: { inset: false, top: false, bottom: true, left: false, right: false, distance: 12, blur: 40, spread: 0, color: "#1e285a", alpha: 0.13 },
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const hex2 = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");

/** `rgb()` / `rgba()` / `#rgb` / `#rrggbb` / `#rrggbbaa` → hex + alpha, else null. */
export function parseColor(raw: string): { color: string; alpha: number } | null {
  const s = raw.trim();

  const rgb = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.%]+))?\s*\)$/i);
  if (rgb) {
    const a = rgb[4] === undefined ? 1
      : rgb[4].endsWith("%") ? parseFloat(rgb[4]) / 100
      : parseFloat(rgb[4]);
    if (isNaN(a)) return null;
    return {
      color: `#${hex2(parseFloat(rgb[1]!))}${hex2(parseFloat(rgb[2]!))}${hex2(parseFloat(rgb[3]!))}`,
      alpha: clamp(a, 0, 1),
    };
  }

  const short = s.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (short) return { color: `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase(), alpha: 1 };

  const long = s.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (long) {
    return {
      color: `#${long[1]!.toLowerCase()}`,
      alpha: long[2] === undefined ? 1 : clamp(parseInt(long[2], 16) / 255, 0, 1),
    };
  }

  return null;
}

/** Compose the stored colour: opaque values stay hex so they read like every other row. */
export function formatColor(color: string, alpha: number): string {
  if (alpha >= 1) return color;
  const m = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return color;
  const [r, g, b] = [m[1]!, m[2]!, m[3]!].map((h) => parseInt(h, 16));
  return `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 100) / 100})`;
}

export function parseShadow(value: string | undefined): ShadowValue {
  const s = (value ?? "").trim();
  if (!s || s === "none") return { kind: "none" };
  if (s === SHADOW_SOFT)   return { kind: "soft" };
  if (s === SHADOW_STRONG) return { kind: "strong" };

  // A single layer only. A comma means stacked shadows, which these controls cannot
  // express — editing one would throw the others away.
  if (s.includes(",") && !/^[^,]*rgba?\([^)]*\)[^,]*$/i.test(s)) return { kind: "raw", value: s };

  const m = s.match(
    /^(inset\s+)?(-?[\d.]+)px\s+(-?[\d.]+)px(?:\s+(-?[\d.]+)px)?(?:\s+(-?[\d.]+)px)?(?:\s+(.+))?$/i,
  );
  if (!m) return { kind: "raw", value: s };

  const x = parseFloat(m[2]!), y = parseFloat(m[3]!);
  const blur = m[4] === undefined ? 0 : parseFloat(m[4]);
  const spread = m[5] === undefined ? 0 : parseFloat(m[5]);
  const col = parseColor(m[6] ?? "#000000");
  if (!col) return { kind: "raw", value: s };

  // The direction model has ONE distance for both axes, so it can only describe an
  // offset whose non-zero components are equal in magnitude. Anything else (a 4px/12px
  // offset, say) would come back rewritten — so it stays raw instead.
  const ax = Math.abs(x), ay = Math.abs(y);
  if (ax !== 0 && ay !== 0 && ax !== ay) return { kind: "raw", value: s };

  return {
    kind: "custom",
    parts: {
      inset: !!m[1],
      right: x > 0, left: x < 0, bottom: y > 0, top: y < 0,
      distance: Math.max(ax, ay),
      blur, spread,
      color: col.color, alpha: col.alpha,
    },
  };
}

export function formatShadow(p: ShadowParts): string {
  const d = p.distance;
  const x = (p.right ? d : 0) - (p.left ? d : 0);
  const y = (p.bottom ? d : 0) - (p.top ? d : 0);
  return [
    p.inset ? "inset" : null,
    `${x}px`, `${y}px`, `${p.blur}px`, `${p.spread}px`,
    formatColor(p.color, p.alpha),
  ].filter(Boolean).join(" ");
}

/** The value a kind writes back, given the parts currently on screen. */
export function shadowValueFor(kind: ShadowKind, parts: ShadowParts, raw: string): string {
  switch (kind) {
    case "none":   return "none";
    case "soft":   return SHADOW_SOFT;
    case "strong": return SHADOW_STRONG;
    case "custom": return formatShadow(parts);
    case "raw":    return raw;
  }
}
