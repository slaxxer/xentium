/**
 * Every icon the site's FontAwesome KIT carries, read from the kit itself.
 *
 * A CSS-mode kit injects its stylesheet into the page (`<style id="fa-main">`), and
 * that sheet holds one rule per icon: `.fa-star { --fa: "\f005"; }` (aliases share
 * the rule: `.fa-close, .fa-xmark { … }`). Reading those rules gives the picker the
 * kit's real catalogue — exactly what THIS site's licence draws, nothing shipped by
 * us, nothing fetched from anywhere else. Licensing-wise it is the same as the kit
 * drawing an icon: names read at runtime from the admin's own kit (docs/icon-kits.md).
 *
 * An SVG/JS-mode kit has no such sheet; the catalogue is then empty and the picker
 * keeps its bundled grid + name field.
 *
 * ⚠ The stylesheet lists every name for EVERY style, but the Pro+ families (Jelly,
 * Slab, Vellum…) are partial sets: `star` may exist in Jelly while `user-astronaut`
 * does not, and a web font draws a missing glyph as nothing, with no error. So a
 * partial family is checked glyph by glyph in a canvas — see `glyphDraws`.
 */

export interface KitIcon {
  /** The canonical (first) name in its rule. */
  name:    string;
  /** Other names the same rule answers to — searchable, never shown as cells. */
  aliases: string[];
  /** The glyph's character, for the presence check. */
  char:    string;
}

let cache: KitIcon[] | null = null;

const NAME = /^\.fa-([a-z0-9-]+)$/;

/** Read the kit's catalogue (memoised once non-empty). */
export function kitIconCatalogue(): KitIcon[] {
  if (cache) return cache;
  if (typeof document === "undefined") return [];
  const out: KitIcon[] = [];
  const seen = new Set<string>();
  for (const sheet of Array.from(document.styleSheets)) {
    // The kit's sheet is inline; a linked sheet is ours (or cross-origin, unreadable).
    if (sheet.href) continue;
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSStyleRule)) continue;
      const raw = rule.style.getPropertyValue("--fa").trim();
      if (!raw) continue;
      // Only the plain `.fa-<name>` rules: the v4 shims are `.fa.fa-<name>` and style
      // classes carry no `--fa` of their own.
      const names = rule.selectorText.split(",").map((s) => NAME.exec(s.trim())?.[1]);
      if (names.some((n) => !n)) continue;
      const char = decodeGlyph(raw);
      if (!char) continue;
      const [name, ...aliases] = names as string[];
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push({ name, aliases, char });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  if (out.length) cache = out;
  return out;
}

/** `"\f005"` (as CSSOM serialises it) → the character. */
function decodeGlyph(raw: string): string | null {
  const v = raw.replace(/^["']|["']$/g, "");
  const esc = /^\\([0-9a-f]{1,6})\s?$/i.exec(v);
  if (esc?.[1]) return String.fromCodePoint(parseInt(esc[1], 16));
  return v.length >= 1 && v.length <= 2 ? v : null;
}

// ── Does a partial family draw this glyph? ──────────────────────────────────

interface FontOf { family: string; weight: string }
const fontCache = new Map<string, FontOf>();

/** The font a style's classes resolve to, measured from a probe. */
function fontOf(classes: string): FontOf {
  const hit = fontCache.get(classes);
  if (hit) return hit;
  const probe = document.createElement("i");
  probe.className = `${classes} fa-star`;
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "position:absolute;left:-9999px;top:0";
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe, "::before");
  const font = { family: cs.fontFamily, weight: cs.fontWeight };
  probe.remove();
  fontCache.set(classes, font);
  return font;
}

/** Where a glyph the family lacks can end up instead. */
const TEXT_FONTS = ["serif", "sans-serif", "monospace"];

let ctx: CanvasRenderingContext2D | null = null;
function render(font: string, ch: string): string {
  if (!ctx) {
    const c = document.createElement("canvas");
    c.width = 40; c.height = 40;
    ctx = c.getContext("2d", { willReadFrequently: true });
  }
  if (!ctx) return "";
  ctx.clearRect(0, 0, 40, 40);
  ctx.font = font;
  ctx.fillText(ch, 2, 32);
  const d = ctx.getImageData(0, 0, 40, 40).data;
  // A cheap fingerprint of the alpha channel is enough to tell two drawings apart.
  let h = 0, ink = 0;
  for (let i = 3; i < d.length; i += 4) { const a = d[i] ?? 0; ink += a; h = (h * 31 + a) | 0; }
  return ink ? String(h) : ""; // "" = drew nothing at all
}

/**
 * Which of `icons` the style actually draws.
 *
 * ⚠ A FontAwesome font answers for names it does not have: it draws a PLACEHOLDER
 * (a crossed box) rather than nothing, so "did anything draw" proves nothing. Every
 * real icon is a different shape, while every missing one is that same placeholder —
 * so each glyph is drawn and fingerprinted, and any drawing shared by several names is
 * the placeholder (or blank). No font parsing, no network.
 */
export async function presentIn(classes: string, icons: KitIcon[]): Promise<Set<string>> {
  const { family, weight } = fontOf(classes);
  const font = `${weight} 32px ${family}`;
  try {
    await document.fonts.load(font, icons.map((i) => i.char).join(""));
  } catch { /* a font that will not load draws nothing — every glyph then reads as missing */ }
  const prints = icons.map((icon) => render(font, icon.char));
  const seen = new Map<string, number>();
  for (const p of prints) seen.set(p, (seen.get(p) ?? 0) + 1);
  const present = new Set<string>();
  // Aliases share a rule, not a glyph, so real duplicates are rare; a handful of
  // genuinely identical drawings (an icon and its mirrored twin) is tolerated.
  icons.forEach((icon, i) => {
    const p = prints[i]!;
    if (!p || (seen.get(p) ?? 0) > 3) return;
    // The number and letter icons (`0`, `a`, `ampersand`) sit on their ASCII
    // characters: a family without one hands it to the browser's text font, which
    // draws a unique shape. Anything a plain text font would draw identically is that.
    if (TEXT_FONTS.some((f) => render(`${weight} 32px ${f}`, icon.char) === p)) return;
    present.add(icon.name);
  });
  return present;
}

/**
 * The brand logos in the kit. They share the catalogue's rules but draw ONLY in the
 * Brands style, which the picker leaves out on purpose (docs/icon-kits.md), so a
 * grid in any other style would be full of blanks.
 */
let brands: Promise<Set<string>> | null = null;
export function kitBrandIcons(icons: KitIcon[]): Promise<Set<string>> {
  // A name the classic font ALSO draws is an icon, not only a logo: it stays.
  brands ??= Promise.all([presentIn("fa-brands", icons), presentIn("fa-solid", icons)])
    .then(([logo, classic]) => new Set([...logo].filter((n) => !classic.has(n))));
  return brands;
}
