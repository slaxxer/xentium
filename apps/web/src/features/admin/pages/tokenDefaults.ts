/**
 * Every token's stock value, read from the stylesheet that renders it.
 *
 * `_tokenDefaults.scss` is the source of truth for the site's defaults; the Style
 * Editor used to keep a hand-written copy of about twenty of them, so any token outside
 * that copy showed an empty row. Reading the file itself (the three blocks the site
 * applies: primitives, the light palette, components) means a token added there has a
 * starting value in the editor the moment it exists.
 */
import source from "../../../styles/_tokenDefaults.scss?raw";

/** The mixins the SITE applies, in the order it applies them (styles/tokens.scss). */
const SITE_MIXINS = ["primitives", "palette-light", "components"];

export function parseTokenDefaults(scss: string, mixins: string[] = SITE_MIXINS): Record<string, string> {
  const out: Record<string, string> = {};
  const clean = scss.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const name of mixins) {
    const start = clean.indexOf(`@mixin ${name} {`);
    if (start < 0) continue;
    // The block ends at its matching brace; these mixins hold declarations only.
    let depth = 0;
    let i = clean.indexOf("{", start);
    const from = i + 1;
    for (; i < clean.length; i++) {
      if (clean[i] === "{") depth++;
      else if (clean[i] === "}" && --depth === 0) break;
    }
    const body = clean.slice(from, i);
    for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  }
  return out;
}

export const STYLESHEET_DEFAULTS: Record<string, string> = parseTokenDefaults(source);

/**
 * A CSS colour expression resolved to `#rrggbb`, for the colour picker.
 *
 * Defaults are often `var(--primitive-…)`, `rgba(…)` or `color-mix(…)`, which an
 * `<input type="color">` cannot show. The browser resolves them on a probe element;
 * the alpha is dropped because the picker has none (the text field keeps the full value).
 */
export function resolveColor(value: string, probeHost: HTMLElement | null = typeof document !== "undefined" ? document.body : null): string | null {
  if (!value) return null;
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(value)) return `#${value.slice(1).split("").map((c) => c + c).join("")}`.toLowerCase();
  if (!probeHost) return null;
  const probe = document.createElement("span");
  probe.style.display = "none";
  probe.style.color = value;
  if (!probe.style.color) return null;          // not a colour the browser accepts
  probeHost.appendChild(probe);
  const rgb = getComputedStyle(probe).color;
  probe.remove();
  const m = rgb.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
  if (!m) return null;
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
}
