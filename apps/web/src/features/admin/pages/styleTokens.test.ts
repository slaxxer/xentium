import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TOKEN_REGISTRY, HEARTH_DEFAULT_TOKENS } from "@xentium/contracts";
import { SECTIONS, BOARD, SCOPE_OPTIONS, PALETTE_ROWS, TEXT_ROWS, FEEDBACK_ROWS, tokenLabel } from "./styleTokens";
import { BASE_FALLBACK, previewOverlayRules } from "./StyleEditorPage";

const LOCALES = ["en", "de", "es", "fr", "pt"] as const;

function acp(locale: string): Record<string, Record<string, unknown>> {
  return JSON.parse(readFileSync(resolve(__dirname, `../../../../public/locales/${locale}/acp.json`), "utf8"));
}

const en = acp("en");
const editable = TOKEN_REGISTRY.filter((t) => t.editable);

/**
 * The Style Editor is the one ACP page whose row labels come from a CONTRACT rather
 * than from a locale file. `TOKEN_REGISTRY.label` is English documentation, so a
 * token added there without a `styleEditor.tok.*` key ships untranslated to five
 * languages and nothing else notices — the page still renders, in English.
 */
describe("token labels", () => {
  it("has an English label for every editable registry token", () => {
    const tok = en.styleEditor!.tok as Record<string, string>;
    const missing = editable.map((t) => t.var.replace(/^--/, "")).filter((k) => !tok[k]);
    expect(missing).toEqual([]);
  });

  it("has no label for a token that no longer exists", () => {
    const known = new Set(TOKEN_REGISTRY.map((t) => t.var.replace(/^--/, "")));
    const stale = Object.keys(en.styleEditor!.tok as object).filter((k) => !known.has(k));
    expect(stale).toEqual([]);
  });
});

/**
 * A token the editor cannot reach is a token the admin cannot set, and the section
 * list is hand-written while the registry is not.
 */
describe("editor coverage", () => {
  it("offers every editable registry token in some section", () => {
    const groups = new Set(SECTIONS.map((s) => s.group).filter(Boolean));
    const orphans = [...new Set(editable.map((t) => t.group))].filter((g) => !groups.has(g));
    expect(orphans).toEqual([]);
  });

  it("points every board tile at a section that owns its token", () => {
    for (const cluster of BOARD) {
      for (const tile of cluster.tiles) {
        const section = SECTIONS.find((s) => s.id === tile.section);
        expect(section, `${tile.cssVar} → ${tile.section}`).toBeDefined();
        expect(section!.rows?.some((r) => r.cssVar === tile.cssVar), `${tile.cssVar} in ${tile.section}`).toBe(true);
      }
    }
  });

  it("names every palette row with a key that exists", () => {
    for (const row of [...PALETTE_ROWS, ...TEXT_ROWS, ...FEEDBACK_ROWS]) {
      const key = row.l.replace("styleEditor.", "");
      expect(en.styleEditor![key], row.l).toBeTruthy();
    }
  });
});

/**
 * Five locales, hand-edited. A key added to one and forgotten in the others falls
 * back to English silently — which is exactly how the region and component labels
 * went untranslated for as long as they did.
 */
describe("locale parity", () => {
  const expected = {
    styleEditor: Object.keys(en.styleEditor!).sort(),
    studioHistory: Object.keys(en.studioHistory!).sort(),
    tok: Object.keys(en.styleEditor!.tok as object).sort(),
  };

  for (const locale of LOCALES.filter((l) => l !== "en")) {
    it(`${locale} has the same Style Editor keys as en`, () => {
      const d = acp(locale);
      expect(Object.keys(d.styleEditor!).sort()).toEqual(expected.styleEditor);
      expect(Object.keys(d.studioHistory!).sort()).toEqual(expected.studioHistory);
      expect(Object.keys(d.styleEditor!.tok as object).sort()).toEqual(expected.tok);
    });
  }
});

describe("scope options", () => {
  it("covers the scopes buildCSS can emit", () => {
    // The picker is what writes a scope bucket; one it does not offer can only be
    // reached by a theme package, and then never edited back.
    expect(SCOPE_OPTIONS.map((o) => o.id)).toEqual([
      "global", "navbar", "content", "footer", "aside",
      "variant.surface", "variant.muted", "variant.accent", "variant.plain",
    ]);
  });
});

/**
 * Every `inheritsFrom` chain has to END somewhere that holds a value. A target that
 * resolves nowhere makes the row render its PLACEHOLDER — "Button text" showed
 * `#rrggbb` instead of white, and "Info" showed an empty swatch, for exactly this
 * reason. Both looked like styling bugs and neither failed anything.
 */
describe("inheritance chains terminate", () => {
  const resolvable = new Set([
    ...Object.keys(HEARTH_DEFAULT_TOKENS),
    ...Object.keys(BASE_FALLBACK),
    ...TOKEN_REGISTRY.map((t) => t.var),
  ]);

  it("resolves every inheritsFrom target to a value", () => {
    const dangling = [...new Set(TOKEN_REGISTRY.map((t) => t.inheritsFrom).filter(Boolean))]
      .filter((v) => !resolvable.has(v!));
    expect(dangling).toEqual([]);
  });

  it("gives every editable palette row a default", () => {
    const rows = [...PALETTE_ROWS, ...TEXT_ROWS, ...FEEDBACK_ROWS].map((r) => r.cssVar);
    expect(rows.filter((v) => HEARTH_DEFAULT_TOKENS[v] === undefined)).toEqual([]);
  });
});

/**
 * `VARIANT_TOKEN_ROWS` and the palette rows both name `--c-fg`, `--c-fg-muted` and
 * `--c-accent`, with different words. The Style Editor's own vocabulary has to win —
 * getting the merge order backwards renamed "Primary text" to "Text" and nothing but
 * looking at the page caught it.
 */
describe("label precedence", () => {
  const t = ((key: string) => key) as unknown as Parameters<typeof tokenLabel>[1];

  it("prefers the Style Editor's palette name over the variant panel's", () => {
    expect(tokenLabel("--c-fg", t)).toBe("styleEditor.rowFg");
    expect(tokenLabel("--c-fg-muted", t)).toBe("styleEditor.rowMuted");
    expect(tokenLabel("--c-accent", t)).toBe("styleEditor.rowAccent");
  });

  it("still names a variant-only token", () => {
    expect(tokenLabel("--surface-bg", t)).toBe("layoutEditor.tokPanelBg");
  });
});

/**
 * The selection ring may only ever DECORATE the specimen. It used to round itself
 * with `border-radius:4px`, which set the radius of the very element it was
 * highlighting — so selecting Card pinned the card at 4px and the Card radius
 * slider appeared to do nothing. Editing a radius is exactly when its group is
 * selected, so every radius control was dead, in the preview whose entire job is
 * showing the effect.
 */
describe("preview overlay", () => {
  it("never sets a property the specimen is being edited for", () => {
    const css = previewOverlayRules({ activeGroup: "card", hotspots: true, previewState: "base" });
    expect(css).toContain("outline");
    expect(css).not.toMatch(/border-radius/);
    // Nothing that paints or lays out, either — an outline is the whole budget.
    expect(css).not.toMatch(/(^|[;{])\s*(background|border|padding|margin|box-shadow)\s*:/);
  });

  it("forces only state-token styling for hover and focus", () => {
    expect(previewOverlayRules({ hotspots: false, previewState: "hover" }))
      .toContain("--menu-item-hover-bg");
    expect(previewOverlayRules({ hotspots: false, previewState: "focus" }))
      .toContain("--input-border-focus");
  });

  it("outlines every editable area only when asked", () => {
    expect(previewOverlayRules({ hotspots: false, previewState: "base" })).toBe("");
    expect(previewOverlayRules({ hotspots: true, previewState: "base" })).toContain("[data-group]");
  });
});
