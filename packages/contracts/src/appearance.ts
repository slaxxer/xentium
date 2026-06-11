// Appearance / Style Editor contracts.
//
// HEARTH_DEFAULT_TOKENS is the single shared copy of the editable semantic
// token defaults, consumed by BOTH the API (appearance.service.ts — editor
// display fallback for GET /tokens) and the web Style Editor (display
// defaults + Reset baseline). Values mirror the Hearth palette in
// apps/web/src/styles/tokens.scss — that SCSS file remains the rendering
// source of truth; this constant exists so the editor copies can never
// drift from EACH OTHER again (they previously did: card-radius, dark
// --c-border). When tokens.scss changes an editable token, update it here.

export type TokenMap = Record<string, string>;
export type TokenSet = { light: TokenMap; dark: TokenMap };

export const HEARTH_DEFAULT_TOKENS: TokenSet = {
  light: {
    "--c-bg":           "#f7f2ee",
    "--c-bg-hover":     "#f0eae3",
    "--c-surface":      "#ffffff",
    "--c-card":         "#ffffff",
    "--c-accent":       "#6d56e6",
    "--c-accent2":      "#ff7a59",
    "--c-accent-soft":  "#ece8fc",
    "--c-accent2-soft": "#ffe9e2",
    "--c-fg":           "#2b2535",
    "--c-fg-muted":     "#6f6878",
    "--c-fg-subtle":    "#a39caf",
    "--c-border":       "#efe9e3",
    "--c-success":      "#1fab74",
    "--c-warn":         "#f4a259",
    "--c-danger":       "#ef4444",
    "--card-radius":    "18px",
    "--btn-radius":     "10px",
  },
  dark: {
    "--c-bg":           "#14101c",
    "--c-bg-hover":     "#251d3d",
    "--c-surface":      "#1d1730",
    "--c-card":         "#211a36",
    "--c-accent":       "#8b78ff",
    "--c-accent2":      "#ff8a6a",
    "--c-accent-soft":  "rgba(139, 120, 255, 0.15)",
    "--c-accent2-soft": "rgba(255, 138, 106, 0.15)",
    "--c-fg":           "#f0ecf7",
    "--c-fg-muted":     "#aaa1bd",
    "--c-fg-subtle":    "#736b85",
    "--c-border":       "rgba(255, 255, 255, 0.08)",
    "--c-success":      "#34d399",
    "--c-warn":         "#f4a259",
    "--c-danger":       "#f87171",
    "--card-radius":    "18px",
    "--btn-radius":     "10px",
  },
};
