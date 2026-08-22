// Theming token registry — the single source of truth for the theming token
// system (region + component tokens). Describes every editable token: its value
// kind, which axis/group it belongs to, what it inherits from, whether it can be
// scoped per region, and how the Style Editor should group it into a control.
//
// Consumed by: the Style Editor (builds panels/controls) and the appearance API
// (validates saved token keys ⊆ registry). `apps/web/src/styles/tokens.scss`
// remains the rendering default; this registry is the contract the editor writes
// against. See CONTRIBUTING.md → "Theming tokens" for the contributor guide.

import type { BlockVariant } from "./layout.js";

export type TokenValueType = "color" | "length" | "shadow" | "keyword";
export type TokenKind = "semantic" | "region" | "component" | "shape";

/**
 * Scopes a token may be overridden within.
 *
 * Two kinds, and the distinction matters: a REGION scope is a place on the page
 * (`navbar`), while a VARIANT scope is a named look a layout block opts into
 * (`variant.accent` — see `BLOCK_VARIANTS` in `layout.ts`). Both resolve to a DOM
 * selector the same way, which is why one mechanism serves both.
 */
export type ThemeScope =
  | "global" | "navbar" | "content" | "footer" | "aside"
  | "variant.surface" | "variant.muted" | "variant.accent" | "variant.plain";

/** Editor grouping — regions (where) and components (what). */
export type TokenGroup =
  | "global" | "navbar" | "content" | "footer" | "aside"   // palette + regions
  | "button" | "card" | "field" | "menu" | "segment";      // components

export interface TokenDef {
  var: string;
  label: string;
  type: TokenValueType;
  kind: TokenKind;
  group: TokenGroup;
  /** Compound editor control this token folds into (else a plain row). */
  control?: "border" | "shadow" | "radius";
  /** Per-side facet (border long-hands). */
  side?: "top" | "right" | "bottom" | "left";
  /** Base token it falls back to when unset — seeds the inherit↔override UX. */
  inheritsFrom?: string;
  /** Component token that may be re-scoped per region. */
  scopeable?: boolean;
  state?: "hover" | "active" | "focus" | "disabled";
  editable: boolean;
}

/** scope id → the DOM root selector its overrides are emitted under (buildCSS). */
export const SCOPE_SELECTOR: Record<ThemeScope, string> = {
  global:  ":root",
  navbar:  ".pub-nav",
  content: ".app-main",
  footer:  ".nv-foot",
  // TODO(phase-3): unify rails under a single `.app-rail` class across home/profile;
  // for now the home rails are the only aside surfaces.
  aside:   ".hf-left, .hf-right",

  // Variant scopes. Listed rather than generated so the mapping is greppable and the
  // `Record<ThemeScope, string>` type keeps them exhaustive — a new variant that is
  // added to `BLOCK_VARIANTS` and forgotten here fails to typecheck.
  "variant.surface": ".nv-v--surface",
  "variant.muted":   ".nv-v--muted",
  "variant.accent":  ".nv-v--accent",
  "variant.plain":   ".nv-v--plain",
};

/** The scope id a block variant's overrides are stored under. */
export const variantScopeId = (variant: BlockVariant): ThemeScope =>
  `variant.${variant}` as ThemeScope;

/** True for a scope that is a named look rather than a place on the page. */
export const isVariantScope = (scope: string): boolean => scope.startsWith("variant.");

/**
 * What the Layout Editor's Style panel edits for the selected block's variant.
 *
 * A curated short list, NOT the whole registry: the panel exists so an admin can
 * recolour the look they just applied without leaving the page they are arranging.
 * The Style Editor stays the complete surface — it can re-scope every component token
 * to a variant through its scope picker.
 *
 * `--surface-*` are the tokens `section` paints from. They have no global definition
 * on purpose: an unstyled section must paint nothing, so the consumer supplies the
 * fallback (`var(--surface-bg, transparent)`) and only a variant ever defines them.
 *
 * There is deliberately no separate row for a CARD's background: `tokens.scss` aliases
 * `--card-bg` to `--surface-bg` for every variant, so one row moves both kinds of
 * surface. Two rows meant recolouring a variant looked like it did nothing on a card.
 */
export interface VariantTokenRow {
  cssVar: string;
  /** i18n key (acp namespace) — matches how the Style Editor labels its palette rows. */
  label: string;
  type: Extract<TokenValueType, "color" | "length" | "shadow">;
}

export const VARIANT_TOKEN_ROWS: VariantTokenRow[] = [
  { cssVar: "--surface-bg",     label: "layoutEditor.tokPanelBg",     type: "color" },
  { cssVar: "--surface-border", label: "layoutEditor.tokPanelBorder", type: "color" },
  { cssVar: "--c-fg",           label: "layoutEditor.tokText",        type: "color" },
  { cssVar: "--c-fg-muted",     label: "layoutEditor.tokTextMuted",   type: "color" },
  { cssVar: "--c-accent",       label: "layoutEditor.tokAccent",      type: "color" },
];

// ── Region surface tokens ──────────────────────────────────────────────────────
const REGION_TOKENS: TokenDef[] = [
  // Navbar
  { var: "--nav-bg",            label: "Navbar background", type: "color", kind: "region", group: "navbar", inheritsFrom: "--c-surface", editable: true },
  { var: "--nav-fg",            label: "Navbar text",       type: "color", kind: "region", group: "navbar", inheritsFrom: "--c-fg", editable: true },
  { var: "--nav-fg-muted",      label: "Navbar muted text", type: "color", kind: "region", group: "navbar", inheritsFrom: "--c-fg-muted", editable: true },
  { var: "--nav-border-color",  label: "Navbar border",     type: "color", kind: "region", group: "navbar", control: "border", inheritsFrom: "--c-border", editable: true },
  { var: "--nav-active",        label: "Active link",       type: "color", kind: "region", group: "navbar", inheritsFrom: "--c-accent", editable: true },
  { var: "--nav-active-bg",     label: "Active link bg",    type: "color", kind: "region", group: "navbar", inheritsFrom: "--c-accent-soft", editable: true },
  { var: "--nav-icon-btn-bg",       label: "Action button bg",    type: "color", kind: "region", group: "navbar", inheritsFrom: "--c-bg", editable: true },
  { var: "--nav-icon-btn-hover-bg", label: "Action button hover", type: "color", kind: "region", group: "navbar", inheritsFrom: "--c-accent-soft", state: "hover", editable: true },
  // Content
  { var: "--content-bg",           label: "Content background", type: "color", kind: "region", group: "content", inheritsFrom: "--c-bg", editable: true },
  { var: "--content-border-color", label: "Content border",     type: "color", kind: "region", group: "content", control: "border", inheritsFrom: "--c-border", editable: true },
  // Footer
  { var: "--footer-bg",           label: "Footer background", type: "color", kind: "region", group: "footer", inheritsFrom: "--c-surface", editable: true },
  { var: "--footer-fg",           label: "Footer text",       type: "color", kind: "region", group: "footer", inheritsFrom: "--c-fg-muted", editable: true },
  { var: "--footer-fg-subtle",    label: "Footer subtle text",type: "color", kind: "region", group: "footer", inheritsFrom: "--c-fg-subtle", editable: true },
  { var: "--footer-border-color", label: "Footer border",     type: "color", kind: "region", group: "footer", control: "border", inheritsFrom: "--c-border", editable: true },
  { var: "--footer-accent",       label: "Footer accent",     type: "color", kind: "region", group: "footer", inheritsFrom: "--c-accent", editable: true },
  // Aside (home/profile rails)
  { var: "--aside-bg",           label: "Aside background", type: "color", kind: "region", group: "aside", inheritsFrom: "--c-card", editable: true },
  { var: "--aside-border-color", label: "Aside border",     type: "color", kind: "region", group: "aside", control: "border", inheritsFrom: "--c-border", editable: true },
];

// ── Component tokens (scopeable per region) ────────────────────────────────────
const COMPONENT_TOKENS: TokenDef[] = [
  // Button
  { var: "--btn-bg",        label: "Button colour", type: "color",  kind: "component", group: "button", inheritsFrom: "--c-accent", scopeable: true, editable: true },
  { var: "--btn-fg",        label: "Button text",   type: "color",  kind: "component", group: "button", inheritsFrom: "--c-on-accent", scopeable: true, editable: true },
  { var: "--btn-danger-bg", label: "Danger button", type: "color",  kind: "component", group: "button", inheritsFrom: "--c-danger", scopeable: true, editable: true },
  { var: "--btn-radius",    label: "Button radius", type: "length", kind: "component", group: "button", control: "radius", scopeable: true, editable: true },
  // Card
  { var: "--card-bg",           label: "Card background", type: "color",  kind: "component", group: "card", inheritsFrom: "--c-card", scopeable: true, editable: true },
  { var: "--card-border-color", label: "Card border",     type: "color",  kind: "component", group: "card", control: "border", inheritsFrom: "--c-border", scopeable: true, editable: true },
  { var: "--card-radius",       label: "Card radius",     type: "length", kind: "component", group: "card", control: "radius", scopeable: true, editable: true },
  { var: "--card-shadow",       label: "Card shadow",     type: "shadow", kind: "component", group: "card", control: "shadow", inheritsFrom: "--shadow-card", scopeable: true, editable: true },
  // Field (input / select / textarea)
  { var: "--input-bg",           label: "Field background", type: "color",  kind: "component", group: "field", inheritsFrom: "--c-bg", scopeable: true, editable: true },
  { var: "--input-border-color", label: "Field border",     type: "color",  kind: "component", group: "field", control: "border", inheritsFrom: "--c-border", scopeable: true, editable: true },
  { var: "--input-fg",           label: "Field text",       type: "color",  kind: "component", group: "field", inheritsFrom: "--c-fg", scopeable: true, editable: true },
  { var: "--input-radius",       label: "Field radius",     type: "length", kind: "component", group: "field", control: "radius", scopeable: true, editable: true },
  { var: "--input-border-focus", label: "Field focus",      type: "color",  kind: "component", group: "field", inheritsFrom: "--c-accent", scopeable: true, state: "focus", editable: true },
  // Menu (dropdown + options)
  { var: "--menu-bg",             label: "Menu background", type: "color",  kind: "component", group: "menu", inheritsFrom: "--c-card", scopeable: true, editable: true },
  { var: "--menu-fg",             label: "Menu text",       type: "color",  kind: "component", group: "menu", inheritsFrom: "--c-fg", scopeable: true, editable: true },
  { var: "--menu-border-color",   label: "Menu border",     type: "color",  kind: "component", group: "menu", control: "border", inheritsFrom: "--c-border", scopeable: true, editable: true },
  { var: "--menu-item-hover-bg",  label: "Menu item hover", type: "color",  kind: "component", group: "menu", inheritsFrom: "--c-bg-hover", scopeable: true, state: "hover", editable: true },
  { var: "--menu-radius",         label: "Menu radius",     type: "length", kind: "component", group: "menu", control: "radius", scopeable: true, editable: true },

  // Segment / sort buttons (e.g. the /members sort control)
  { var: "--seg-bg",        label: "Sort button bg",        type: "color", kind: "component", group: "segment", inheritsFrom: "--c-bg", editable: true },
  { var: "--seg-fg",        label: "Sort button text",      type: "color", kind: "component", group: "segment", inheritsFrom: "--c-fg-subtle", editable: true },
  { var: "--seg-hover-bg",  label: "Sort button hover",     type: "color", kind: "component", group: "segment", inheritsFrom: "--c-bg-hover", state: "hover", editable: true },
  { var: "--seg-active-bg", label: "Sort button selected",  type: "color", kind: "component", group: "segment", inheritsFrom: "--c-fg", state: "active", editable: true },
  { var: "--seg-active-fg", label: "Selected text",         type: "color", kind: "component", group: "segment", inheritsFrom: "--c-bg", state: "active", editable: true },
];

export const TOKEN_REGISTRY: TokenDef[] = [...REGION_TOKENS, ...COMPONENT_TOKENS];

/** Fast lookup by CSS var name. */
export const TOKEN_BY_VAR: Record<string, TokenDef> = Object.fromEntries(
  TOKEN_REGISTRY.map((t) => [t.var, t]),
);
