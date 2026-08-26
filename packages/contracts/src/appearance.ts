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

export type TokenMap = Record<string, string>;
export type TokenSet = { light: TokenMap; dark: TokenMap };

// Region-scoped overrides (ADR-0003 region/component theming): each theme maps a
// scope id (`global` + region ids) → token map. `global` is emitted on the theme
// root; region scopes are emitted under that region's DOM selector (SCOPE_SELECTOR)
// so a re-scoped *component* token only cascades inside that region. Storage is
// sparse: a token absent from every bucket inherits via tokens.scss `var(--base)`.
export type ScopedTokens   = Record<string, TokenMap>;
export type ScopedTokenSet = { light: ScopedTokens; dark: ScopedTokens };

// ── Validation ────────────────────────────────────────────────────────────────
// Every token that reaches storage is emitted verbatim into a served stylesheet, so
// the shape is validated at the door rather than trusted: a value containing `}` would
// close the block early and everything after it becomes arbitrary CSS. Applies to all
// three ways in — the Style Editor, the Layout Editor's variant panel, and a
// `.nvtheme` import.

export const tokenMapSchema = z.record(
  z.string().regex(/^--[\w-]+$/, 'token names must be CSS custom properties'),
  z.string().max(400).refine((v) => !/[{}<>;]/.test(v), 'token values may not contain { } < > or ;'),
);

export const scopedTokensSchema = z.record(
  z.string().regex(/^[\w.:-]+$/, 'scope ids must be identifiers'),
  tokenMapSchema,
);

export const scopedTokenSetSchema = z.object({
  light: scopedTokensSchema.default({}),
  dark:  scopedTokensSchema.default({}),
});

export const HEARTH_DEFAULT_TOKENS: TokenSet = {
  light: {
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
  },
  dark: {
    "--c-bg":           "#0c0d18",
    "--c-bg-hover":     "#232645",
    "--c-surface":      "#14162a",
    "--c-card":         "#1b1e36",
    "--c-accent":       "#7c84ff",
    "--c-accent2":      "#2bd4ee",
    "--c-accent-soft":  "rgba(124, 132, 255, 0.15)",
    "--c-accent2-soft": "rgba(43, 212, 238, 0.15)",
    "--c-fg":           "#e9ebff",
    "--c-fg-muted":     "#9da2c4",
    "--c-fg-subtle":    "#6a6f90",
    "--c-border":       "rgba(255, 255, 255, 0.08)",
    "--c-success":      "#3ba55d",
    "--c-warn":         "#f4a259",
    "--c-danger":       "#f87171",
    "--c-info":         "#38bdf8",
    "--c-update":       "#8f8f94",   // lighter neutral — #414144 vanishes on dark cards
    "--btn-bg":         "#7c84ff",
    "--card-radius":    "18px",
    "--btn-radius":     "10px",
  },
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
 * The ACP re-pins all four on `body.nv-acp`, which is what keeps the admin panel on
 * its own type regardless of what the site is set to.
 */
export function fontRootDecls(font: SiteFont): string[] {
  const out: string[] = [];
  if (font.family && FONT_STACKS[font.family]) {
    out.push(`  --ff-sans: ${FONT_STACKS[font.family]};`);
    out.push(`  --font-display: ${FONT_STACKS[font.family]};`);
  }
  if (font.weight) out.push(`  --fw-body: ${font.weight};`);
  if (font.size)   out.push(`  --fs-base: ${font.size}px;`);
  return out;
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
