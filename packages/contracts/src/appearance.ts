import { z } from 'zod';

// Appearance / Style Editor contracts.
//
// HEARTH_DEFAULT_TOKENS is the single shared copy of the editable semantic
// token defaults, consumed by BOTH the API (appearance.service.ts — editor
// display fallback for GET /tokens) and the web Style Editor (display
// defaults + Reset baseline). Values mirror the Nebula palette in
// apps/web/src/styles/tokens.scss — that SCSS file remains the rendering
// source of truth; this constant exists so the editor copies can never
// drift from EACH OTHER again (they previously did: card-radius, dark
// --c-border). When tokens.scss changes an editable token, update it here.
//
// ONE palette, and it is the light one — the same decision tokens.scss makes. The
// dark half was deleted with the theme toggle; a dark SITE is now a dark theme.

export type TokenMap = Record<string, string>;
/**
 * @deprecated A site has ONE look, so a "set" is a single map.
 *
 * Kept as an alias, like `ScopedTokenSet`, so call sites that name a whole palette
 * still read; anything reaching for `.light` / `.dark` is a compile error.
 */
export type TokenSet = TokenMap;

// Region-scoped overrides (ADR-0003 region/component theming): each theme maps a
// scope id (`global` + region ids) → token map. `global` is emitted on the theme
// root; region scopes are emitted under that region's DOM selector (SCOPE_SELECTOR)
// so a re-scoped *component* token only cascades inside that region. Storage is
// sparse: a token absent from every bucket inherits via tokens.scss `var(--base)`.
export type ScopedTokens   = Record<string, TokenMap>;
/**
 * @deprecated A site has ONE look now, so a "set" is a single scoped map.
 *
 * Kept as an alias rather than deleted so the name still reads at the call sites
 * that describe a whole appearance layer (the admin's, the theme's). Anything
 * still reaching for `.light` / `.dark` is a compile error, which is the point —
 * those are the places that had a second palette to lose.
 */
export type ScopedTokenSet = ScopedTokens;

// ── Validation ────────────────────────────────────────────────────────────────
// Every token that reaches storage is emitted verbatim into a served stylesheet, so
// the shape is validated at the door rather than trusted: a value containing `}` would
// close the block early and everything after it becomes arbitrary CSS. Applies to all
// three ways in — the Style Editor, the Layout Editor's variant panel, and a
// `.xttheme` import.

export const tokenMapSchema = z.record(
  z.string().regex(/^--[\w-]+$/, 'token names must be CSS custom properties'),
  z.string().max(400).refine((v) => !/[{}<>;]/.test(v), 'token values may not contain { } < > or ;'),
);

export const scopedTokensSchema = z.record(
  z.string().regex(/^[\w.:-]+$/, 'scope ids must be identifiers'),
  tokenMapSchema,
);

/** @deprecated One look, one map — an alias of `scopedTokensSchema`. */
export const scopedTokenSetSchema = scopedTokensSchema;

export const HEARTH_DEFAULT_TOKENS: TokenMap = {
  "--c-bg":           "#f3f4fb",
  "--c-bg-hover":     "#ebedf7",
  "--c-surface":      "#ffffff",
  "--c-card":         "#ffffff",
  "--c-accent":       "#5865f2",
  "--c-accent2":      "#00b1cf",
  "--c-accent-soft":  "#e7e9fd",
  "--c-accent2-soft": "#d6f3f8",
  "--c-fg":           "#1a1c2e",
  "--c-fg-muted":     "#5b5e74",
  "--c-fg-subtle":    "#9499ae",
  "--c-border":       "#e6e7f1",
  "--c-success":      "#23a55a",
  "--c-warn":         "#f4a259",
  "--c-danger":       "#ef4444",
  // Both are editable rows in the Style Editor's Feedback group, so both need a
  // default here or the row renders empty and "Inherited" names nothing.
  "--c-info":         "#38bdf8",
  "--c-update":       "#414144",
  "--btn-bg":         "#5865f2",
  "--card-radius":    "18px",
  "--btn-radius":     "10px",
};

// ── Site font ─────────────────────────────────────────────────────────────────
//
// ONE definition, used by the API's `buildCSS` and by the Style Editor's live
// preview. They emitted the font differently before: the server applied the size
// through `body { font-size: var(--fs-base) }` while the preview applied it through
// `html { font-size }` — which also rescales every rem on the page — and the preview
// never emitted the WEIGHT at all, so the one control with no visible effect was the
// one an admin was most likely to reach for. A preview that does not render what
// ships is worse than no preview.

export const FONT_FAMILIES = ["Poppins", "Nunito", "Montserrat", "Open Sans", "Ubuntu"] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];

export const FONT_STACKS: Record<string, string> = {
  "Poppins":    "Poppins, sans-serif",
  "Nunito":     "Nunito, sans-serif",
  "Montserrat": "Montserrat, sans-serif",
  "Open Sans":  '"Open Sans", sans-serif',
  "Ubuntu":     "Ubuntu, sans-serif",
};

export interface SiteFont {
  family?: string;
  /** Numeric weight as a string, e.g. "500". */
  weight?: string;
  /** Base size in px, unitless, e.g. "16". */
  size?: string;
}

/**
 * The custom properties the site font sets, for a `:root` block.
 *
 * The family is site-wide — body (`--ff-sans`) AND headings (`--font-display`).
 * The ACP re-pins all four on `body.xt-acp`, which is what keeps the admin panel on
 * its own type regardless of what the site is set to.
 */
export function fontRootDecls(font: SiteFont): string[] {
  const out: string[] = [];
  if (font.family && FONT_STACKS[font.family]) {
    out.push(`  --ff-sans: ${FONT_STACKS[font.family]};`);
    out.push(`  --font-display: ${FONT_STACKS[font.family]};`);
  }
  if (font.weight) out.push(`  --fw-body: ${font.weight};`);
  // The size is the SITE's text size: it sets the scale every `--fs-*` step multiplies
  // by, so 18 makes all text 18/16 of its default — headings, captions and all — rather
  // than only the body text it used to move.
  const scale = fontScale(font.size);
  if (scale !== null) out.push(`  --fs-scale: ${scale};`);
  return out;
}

/** "18" → 1.125: the text-size scale a base size in px means. Null when unset or not a size. */
export function fontScale(size: string | undefined): number | null {
  const px = Number(size);
  if (!size || !Number.isFinite(px) || px <= 0) return null;
  return Math.round((px / 16) * 10000) / 10000;
}

/** The rule that applies those properties, or null when nothing is set. */
export function fontBodyRule(font: SiteFont): string | null {
  const rules: string[] = [];
  if (font.family) rules.push(`  font-family: var(--ff-sans);`);
  if (font.size)   rules.push(`  font-size: var(--fs-base);`);
  if (font.weight) rules.push(`  font-weight: var(--fw-body);`);
  if (!rules.length) return null;
  return `body, input, textarea, select, button {\n${rules.join("\n")}\n}`;
}
