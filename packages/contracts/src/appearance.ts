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
    "--btn-bg":         "#7c84ff",
    "--card-radius":    "18px",
    "--btn-radius":     "10px",
  },
};
