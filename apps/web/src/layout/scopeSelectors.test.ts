/**
 * Every theme SCOPE has to point at something the app actually renders.
 *
 * A scope is how a region gets its own token values: the Style Editor writes them,
 * `buildCSS` emits them under `SCOPE_SELECTOR[scope]`, and the browser applies them
 * to whatever that selector matches. When it matches nothing, the whole mechanism
 * fails SILENTLY — the panel is there, the edit saves, the CSS is served, and the
 * page does not change.
 *
 * That is not hypothetical. `aside` pointed at `.hf-left, .hf-right` — the home
 * page's two hardcoded rail wrappers — and those classes were DELETED when home was
 * decomposed into blocks. The scope outlived them, so "Aside background" was a
 * control that did precisely nothing until this test was written.
 *
 * Source text rather than a render: a scope's target may be emitted by a component
 * no test can mount without host data, and the promise is about the NAME.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SCOPE_SELECTOR, type ThemeScope } from "@xentium/contracts";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Comments stripped, and that is the point.
 *
 * `.hf-left` is still NAMED all over this codebase — in the comments explaining why
 * it is gone. A scan that counted those would have passed on the very bug it exists
 * to catch. Block comments, and whole lines that are a comment, are removed; a `//`
 * that follows code on the same line is left alone, because a URL in a string is
 * more common there than a class name is.
 */
const decomment = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "")
     .split("\n")
     .filter((line) => !/^\s*(\/\/|\*)/.test(line))
     .join("\n");

/** Every .ts/.tsx/.scss in the web app, minus tests — what the browser can receive. */
function sources(): string {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(tsx?|scss)$/.test(entry.name)) continue;
      if (/\.test\.tsx?$/.test(entry.name)) continue;
      out.push(decomment(fs.readFileSync(full, "utf8")));
    }
  };
  walk(SRC);
  return out.join("\n");
}

const ALL = sources();

/** `.a, .b` → ["a", "b"]. Every selector in the map is a plain class list. */
const classesOf = (selector: string): string[] =>
  selector.split(",").map((s) => s.trim().replace(/^\./, "")).filter(Boolean);

/**
 * Is this class name still emitted anywhere?
 *
 * A modifier is rarely written whole: the renderer composes it
 * (`nv-column--${props.width}`) and the stylesheet nests it (`&--sidebar`). So a
 * BEM class counts as present when its base and its modifier are both there. A
 * class with no modifier — `.hf-left`, the one this test was written for — has to
 * appear literally, which is the case that matters.
 */
function rendered(cls: string): boolean {
  if (ALL.includes(cls)) return true;
  const cut = cls.indexOf("--");
  if (cut === -1) return false;
  return ALL.includes(cls.slice(0, cut)) && ALL.includes(`&${cls.slice(cut)}`);
}

describe("SCOPE_SELECTOR", () => {
  it("names a class the app still emits, for every scope", () => {
    for (const [scope, selector] of Object.entries(SCOPE_SELECTOR) as [ThemeScope, string][]) {
      if (selector === ":root") continue;   // the document itself, not a class
      for (const cls of classesOf(selector)) {
        expect(rendered(cls), `scope "${scope}" targets .${cls}, which nothing renders any more`)
          .toBe(true);
      }
    }
  });

  it("points the rail scope at BOTH ways of building a rail", () => {
    // The `aside` region is the page's one simple rail; a `column` sized
    // `sidebar`/`rail` is what a page with two rails, or one on the left, uses
    // instead. A scope that knew only one of them would style a rail or not
    // depending on how it happened to be built.
    expect(SCOPE_SELECTOR.aside).toContain(".nv-region--aside");
    expect(SCOPE_SELECTOR.aside).toContain(".nv-column--rail");
    expect(SCOPE_SELECTOR.aside).toContain(".nv-column--sidebar");
  });
});
