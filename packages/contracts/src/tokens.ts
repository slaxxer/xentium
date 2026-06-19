// Theming token registry — the single source of truth for the theming token
// system (region + component tokens). Describes every editable token: its value
// kind, which axis/group it belongs to, what it inherits from, whether it can be
// scoped per region, and how the Style Editor should group it into a control.
//
// Consumed by: the Style Editor (builds panels/controls) and the appearance API
// (validates saved token keys ⊆ registry). `apps/web/src/styles/tokens.scss`
// remains the rendering default; this registry is the contract the editor writes
// against. See CONTRIBUTING.md → "Theming tokens" for the contributor guide.

export type TokenValueType = "color" | "length" | "shadow" | "keyword";
export type TokenKind = "semantic" | "region" | "component" | "shape";

/** Region scopes a component token may be overridden within. */
export type ThemeScope = "global" | "navbar" | "content" | "footer" | "aside";

/** Editor grouping — regions (where) and components (what). */
export type TokenGroup =
  | "global" | "navbar" | "content" | "footer" | "aside"   // palette + regions
  | "button" | "card" | "field" | "menu";                  // components

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
};

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
  { var: "--menu-border-color",   label: "Menu border",     type: "color",  kind: "component", group: "menu", control: "border", inheritsFrom: "--c-border", scopeable: true, editable: true },
  { var: "--menu-item-hover-bg",  label: "Menu item hover", type: "color",  kind: "component", group: "menu", inheritsFrom: "--c-bg-hover", scopeable: true, state: "hover", editable: true },
  { var: "--menu-radius",         label: "Menu radius",     type: "length", kind: "component", group: "menu", control: "radius", scopeable: true, editable: true },
];

export const TOKEN_REGISTRY: TokenDef[] = [...REGION_TOKENS, ...COMPONENT_TOKENS];

/** Fast lookup by CSS var name. */
export const TOKEN_BY_VAR: Record<string, TokenDef> = Object.fromEntries(
  TOKEN_REGISTRY.map((t) => [t.var, t]),
);
