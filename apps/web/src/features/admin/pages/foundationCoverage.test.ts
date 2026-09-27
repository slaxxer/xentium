/**
 * The Style Editor reaches EVERY token the site is built from.
 *
 * It used to cover about half: tints like `--c-accent-soft` (every selected row and
 * active tab), the shadows, corners, spacing and type steps existed only in
 * `_tokenDefaults.scss`, changeable with custom CSS and nothing else. This fails the
 * moment a token is added to the stylesheet without a row in the editor.
 */
import { describe, expect, it } from "vitest";
import { TOKEN_BY_VAR, VARIANT_TOKEN_ROWS } from "@xentium/contracts";
import { SECTIONS } from "./styleTokens";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseTokenDefaults } from "./tokenDefaults";

// ⚠ Read from disk: under Vitest a `?raw` stylesheet import comes back EMPTY (its CSS
// handling), which made this test pass while checking nothing. The browser gets the file.
const STYLESHEET_DEFAULTS = parseTokenDefaults(
  readFileSync(fileURLToPath(new URL("../../../styles/_tokenDefaults.scss", import.meta.url)), "utf8"),
);

/** Declared but deliberately not a row, and why. */
const NOT_A_ROW: Record<string, string> = {
  "--fs-scale":     "the Typography Size control sets it",
  "--ff-sans":      "the font family picker sets it (alias of --font-body)",
  "--font-poppins": "a font stack constant the family picker chooses between",
};

const editorVars = new Set<string>([
  ...SECTIONS.flatMap((s) => s.rows?.map((r) => r.cssVar) ?? []),
  ...Object.values(TOKEN_BY_VAR).filter((d) => d.editable).map((d) => d.var),
  ...VARIANT_TOKEN_ROWS.map((r) => r.cssVar),
]);

describe("Style Editor coverage", () => {
  it("has a row for every token the site's stylesheet declares", () => {
    expect(Object.keys(STYLESHEET_DEFAULTS).length).toBeGreaterThan(100);
    const missing = Object.keys(STYLESHEET_DEFAULTS).filter((v) => !editorVars.has(v) && !(v in NOT_A_ROW));
    expect(missing).toEqual([]);
  });

  it("every registry section exists in the editor", () => {
    const groups = new Set(Object.values(TOKEN_BY_VAR).map((d) => d.group));
    const sections = new Set(SECTIONS.map((s) => s.group ?? s.id));
    for (const g of groups) if (g !== "global") expect(sections.has(g), g).toBe(true);
  });

  it("reads defaults from the stylesheet, comments and all", () => {
    expect(STYLESHEET_DEFAULTS["--c-accent-soft"]).toBe("#e7e9fd");
    expect(STYLESHEET_DEFAULTS["--radius-pill"]).toBe("999px");
    expect(parseTokenDefaults("@mixin components {\n  --a: 1px; // note\n  /* x */ --b: var(--a);\n}", ["components"]))
      .toEqual({ "--a": "1px", "--b": "var(--a)" });
  });
});
