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
  | "button" | "card" | "field" | "menu" | "segment"       // components
  | "usermenu"                                              // the header's action pill
  // Foundation: everything else the site is built from. Every token `_tokenDefaults.scss`
  // declares is in the registry, so the Style Editor can reach all of it.
  | "tints" | "shadows" | "corners" | "type" | "spacing" | "layout" | "base";

export interface TokenDef {
  var: string;
  label: string;
  type: TokenValueType;
  kind: TokenKind;
  group: TokenGroup;
  /** Compound editor control this token folds into (else a plain row). */
  control?: "border" | "shadow" | "radius" | "size" | "text" | "weight";
  /** `size` only: the slider's ends, in px. A length needs a range to be draggable,
   *  and the sensible range for a rail is not the sensible range for a radius. */
  min?: number;
  max?: number;
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
  footer:  ".xt-foot",
  /*
   * Every rail on the site, however it was built.
   *
   * It used to be `.hf-left, .hf-right` — the home page's two hardcoded rail
   * wrappers — and those classes were DELETED when home was decomposed into blocks.
   * The scope survived them: the Style Editor kept offering an Aside section whose
   * every edit was emitted under a selector that matched nothing, so "Aside
   * background" was a control that did exactly nothing.
   *
   * Both ways to build a rail are listed, because both are legitimate: the `aside`
   * REGION is the page's one simple rail, and a `column` sized `sidebar`/`rail` is
   * what a page with two rails (or a rail on the left) uses instead.
   */
  aside:   ".xt-region--aside, .xt-column--sidebar, .xt-column--rail",

  // Variant scopes. Listed rather than generated so the mapping is greppable and the
  // `Record<ThemeScope, string>` type keeps them exhaustive — a new variant that is
  // added to `BLOCK_VARIANTS` and forgotten here fails to typecheck.
  "variant.surface": ".xt-v--surface",
  "variant.muted":   ".xt-v--muted",
  "variant.accent":  ".xt-v--accent",
  "variant.plain":   ".xt-v--plain",
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
  { var: "--footer-fg-strong",    label: "Footer strong text",type: "color", kind: "region", group: "footer", inheritsFrom: "--c-fg", editable: true },
  { var: "--footer-fg",           label: "Footer text",       type: "color", kind: "region", group: "footer", inheritsFrom: "--c-fg-muted", editable: true },
  { var: "--footer-fg-subtle",    label: "Footer subtle text",type: "color", kind: "region", group: "footer", inheritsFrom: "--c-fg-subtle", editable: true },
  { var: "--footer-border-color", label: "Footer border",     type: "color", kind: "region", group: "footer", control: "border", inheritsFrom: "--c-border", editable: true },
  { var: "--footer-accent",       label: "Footer accent",     type: "color", kind: "region", group: "footer", inheritsFrom: "--c-accent", editable: true },
  // Aside — the page's rail, whether it is the `aside` region or a `column` track
  { var: "--aside-bg",           label: "Aside background", type: "color", kind: "region", group: "aside", inheritsFrom: "--c-card", editable: true },
  { var: "--aside-border-color", label: "Aside border",     type: "color", kind: "region", group: "aside", control: "border", inheritsFrom: "--c-border", editable: true },
  /*
   * How wide the rail is. It was a pixel value in `_tokenDefaults.scss` and nowhere
   * else — the one measurement of a page's shape that an admin could see and not
   * change. `column width: rail` reads the same token, so a rail is the same width
   * however it was built.
   *
   * ⚠ Global only (no `scopeable`): a rail whose width depends on which rail it is
   * would make the two ways of building one disagree.
   */
  { var: "--rail-width",    label: "Rail width",    type: "length", kind: "region", group: "aside", control: "size", min: 200, max: 480, editable: true },
  { var: "--sidebar-width", label: "Sidebar width", type: "length", kind: "region", group: "aside", control: "size", min: 160, max: 420, editable: true },
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
  // The header dropdowns (account menu, notifications, moderation shield, plugin
  // dropdowns like messages) read these too: secondary text and the two weights.
  { var: "--menu-fg-muted",       label: "Menu secondary text", type: "color", kind: "component", group: "menu", inheritsFrom: "--c-fg-muted", scopeable: true, editable: true },
  { var: "--menu-fw",             label: "Menu text weight",    type: "keyword", kind: "component", group: "menu", control: "weight", scopeable: true, editable: true },
  { var: "--menu-title-fw",       label: "Menu title weight",   type: "keyword", kind: "component", group: "menu", control: "weight", scopeable: true, editable: true },

  // User menu: the header's action pill (moderation shield, bell, plugin icons, search,
  // ACP link, avatar). Its dropdowns are "menu" above; this is the pill they open from.
  // Global only: the pill sits in the masthead, which no region scope reaches.
  { var: "--usermenu-bg",     label: "User menu background", type: "color",   kind: "component", group: "usermenu", editable: true },
  { var: "--usermenu-fg",     label: "User menu text",       type: "color",   kind: "component", group: "usermenu", editable: true },
  { var: "--usermenu-line",   label: "User menu dividers",   type: "color",   kind: "component", group: "usermenu", editable: true },
  { var: "--usermenu-fw",     label: "User menu text weight", type: "keyword", kind: "component", group: "usermenu", control: "weight", editable: true },
  { var: "--usermenu-radius", label: "User menu radius",     type: "length",  kind: "component", group: "usermenu", control: "radius", inheritsFrom: "--radius-md", editable: true },

  // Segment / sort buttons (e.g. the /members sort control)
  { var: "--seg-bg",        label: "Sort button bg",        type: "color", kind: "component", group: "segment", inheritsFrom: "--c-bg", editable: true },
  { var: "--seg-fg",        label: "Sort button text",      type: "color", kind: "component", group: "segment", inheritsFrom: "--c-fg-subtle", editable: true },
  { var: "--seg-hover-bg",  label: "Sort button hover",     type: "color", kind: "component", group: "segment", inheritsFrom: "--c-bg-hover", state: "hover", editable: true },
  { var: "--seg-active-bg", label: "Sort button selected",  type: "color", kind: "component", group: "segment", inheritsFrom: "--c-fg", state: "active", editable: true },
  { var: "--seg-active-fg", label: "Selected text",         type: "color", kind: "component", group: "segment", inheritsFrom: "--c-bg", state: "active", editable: true },
];

// ── Foundation tokens (global) ─────────────────────────────────────────────────
//
// ⚠ The rest of the site's design. These existed in `_tokenDefaults.scss` and nowhere
// in the editor, so a tint like `--c-accent-soft` (every selected row, every active
// tab) could only be changed with custom CSS. `foundationCoverage.test.ts` fails if a
// token is added to the stylesheet without being registered here.
const f = (v: string, label: string, group: TokenGroup, type: TokenValueType, extra: Partial<TokenDef> = {}): TokenDef =>
  ({ var: v, label, type, kind: "shape", group, editable: true, ...extra });

const FOUNDATION_TOKENS: TokenDef[] = [
  // Tints & states — the soft backgrounds and lines the palette colours are shown on.
  f("--c-accent-soft",  "Accent tint",       "tints", "color", { kind: "semantic" }),
  f("--c-accent2-soft", "Accent 2 tint",     "tints", "color", { kind: "semantic" }),
  f("--c-accent-glow",  "Accent glow",       "tints", "color", { kind: "semantic" }),
  f("--c-on-accent",    "Text on accent",    "tints", "color", { kind: "semantic" }),
  f("--c-border-hi",    "Strong border",     "tints", "color", { kind: "semantic" }),
  f("--c-rowline",      "Row divider",       "tints", "color", { kind: "semantic" }),
  f("--c-success-soft", "Success tint",      "tints", "color", { kind: "semantic" }),
  f("--c-danger-soft",  "Danger tint",       "tints", "color", { kind: "semantic" }),
  f("--avatar-presence","Online dot",        "tints", "color", { kind: "semantic", inheritsFrom: "--c-success" }),

  // Shadows
  f("--shadow-card",        "Card shadow",    "shadows", "shadow", { control: "shadow" }),
  f("--shadow-pop",         "Popover shadow", "shadows", "shadow", { control: "shadow" }),
  f("--shadow-sm",          "Small shadow",   "shadows", "shadow", { control: "shadow", inheritsFrom: "--shadow-card" }),
  f("--shadow-md",          "Medium shadow",  "shadows", "shadow", { control: "shadow", inheritsFrom: "--shadow-card" }),
  f("--shadow-lg",          "Large shadow",   "shadows", "shadow", { control: "shadow", inheritsFrom: "--shadow-pop" }),
  f("--shadow-glow",        "Glow",           "shadows", "shadow", { control: "text" }),
  f("--shadow-inset-knob",  "Switch knob",    "shadows", "shadow", { control: "text" }),
  f("--glow-accent",        "Glow on accent elements", "shadows", "shadow", { control: "text" }),

  // Corners
  f("--radius-sm",   "Small corners",  "corners", "length", { control: "radius" }),
  f("--radius-md",   "Medium corners", "corners", "length", { control: "radius" }),
  f("--radius-lg",   "Large corners",  "corners", "length", { control: "radius" }),
  f("--radius-xl",   "Extra-large corners", "corners", "length", { control: "radius" }),
  f("--radius-pill", "Pill corners",   "corners", "length", { control: "size", min: 0, max: 999 }),
  // Chamfered corners (Theme style → Corners). A cut is a clip-path, so it sits in its
  // own tokens: `none` by default, because a rectangle clip would still cut off every
  // card's shadow. See `themeStyle.ts`.
  f("--corner-cut",    "Corner cut (cards)",   "corners", "length", { control: "size", min: 0, max: 32 }),
  f("--corner-cut-sm", "Corner cut (small)",   "corners", "length", { control: "size", min: 0, max: 16 }),
  f("--clip-card",     "Card corner shape",    "corners", "keyword", { control: "text" }),
  f("--clip-sm",       "Small corner shape",   "corners", "keyword", { control: "text" }),

  // Typography — the steps are `calc(<rem> * var(--fs-scale))`; the site-wide text size
  // is the Size control, which sets the scale. A step set here replaces its calc.
  f("--fs-2xs",  "Text · smallest (12px)",  "type", "length", { control: "text" }),
  f("--fs-xs",   "Text · caption (13px)",   "type", "length", { control: "text" }),
  f("--fs-sm",   "Text · small (14px)",     "type", "length", { control: "text" }),
  f("--fs-md",   "Text · UI (15px)",        "type", "length", { control: "text" }),
  f("--fs-base", "Text · body (16px)",      "type", "length", { control: "text" }),
  f("--fs-read", "Text · reading (17px)",   "type", "length", { control: "text" }),
  f("--fs-lg",   "Heading · small (18px)",  "type", "length", { control: "text" }),
  f("--fs-xl",   "Heading · medium (20px)", "type", "length", { control: "text" }),
  f("--fs-2xl",  "Heading · large (24px)",  "type", "length", { control: "text" }),
  f("--fs-3xl",  "Heading · huge (30px)",   "type", "length", { control: "text" }),
  f("--font-display", "Heading font",        "type", "keyword", { control: "text" }),
  f("--font-headline", "Headline font",      "type", "keyword", { control: "text" }),
  f("--font-body",    "Body font",           "type", "keyword", { control: "text" }),
  f("--ff-mono",      "Code font",           "type", "keyword", { control: "text" }),

  // Spacing
  ...([1, 2, 3, 4, 5, 6, 8, 10, 12, 16] as const).map((n) =>
    f(`--sp-${n}`, `Space ${n} (${n * 4}px)`, "spacing", "length", { control: "size", min: 0, max: 96 })),

  // Layout
  f("--nav-height",     "Navbar height",       "layout", "length", { control: "size", min: 44, max: 120 }),
  f("--content-max",    "Page width",          "layout", "length", { control: "size", min: 720, max: 1800 }),
  f("--content-narrow", "Narrow page width",   "layout", "length", { control: "size", min: 480, max: 1100 }),
  // A group's rank image, where it replaces the text badge (ACP → Settings → Rank display).
  f("--rank-image-height", "Rank image height", "layout", "length", { control: "size", min: 12, max: 64 }),

  // Button sizing sits with the button colours.
  f("--btn-pad-y", "Button padding (vertical)",   "button", "length", { kind: "component", control: "size", min: 0, max: 32, scopeable: true }),
  f("--btn-pad-x", "Button padding (horizontal)", "button", "length", { kind: "component", control: "size", min: 0, max: 48, scopeable: true }),
  f("--btn-fs",    "Button text size",            "button", "length", { kind: "component", control: "text", inheritsFrom: "--fs-sm", scopeable: true }),
  f("--btn-fw",    "Button text weight",          "button", "keyword", { kind: "component", control: "text", scopeable: true }),
  f("--btn-gap",   "Button icon gap",             "button", "length", { kind: "component", control: "size", min: 0, max: 24, scopeable: true }),

  // Base palette — the raw colours the semantic tokens are made from. Changing one
  // moves every colour built on it that has not been set on its own.
  ...([
    ["--primitive-blurple-600", "Blurple 600"], ["--primitive-blurple-400", "Blurple 400"], ["--primitive-blurple-300", "Blurple 300"],
    ["--primitive-cyan-500", "Cyan 500"], ["--primitive-cyan-400", "Cyan 400"],
    ["--primitive-green-500", "Green 500"], ["--primitive-green-400", "Green 400"],
    ["--primitive-amber-500", "Amber 500"], ["--primitive-sky-400", "Sky 400"], ["--primitive-red-400", "Red 400"],
    ["--primitive-mist-50", "Mist 50"], ["--primitive-white", "White"],
    ["--primitive-ink-900", "Ink 900"], ["--primitive-ink-600", "Ink 600"], ["--primitive-ink-400", "Ink 400"],
    ["--primitive-night-950", "Night 950"], ["--primitive-night-900", "Night 900"],
    ["--primitive-night-850", "Night 850"], ["--primitive-night-50", "Night 50"],
  ] as const).map(([v, label]) => f(v, label, "base", "color", { kind: "semantic" })),
];

export const TOKEN_REGISTRY: TokenDef[] = [...REGION_TOKENS, ...COMPONENT_TOKENS, ...FOUNDATION_TOKENS];

/** Fast lookup by CSS var name. */
export const TOKEN_BY_VAR: Record<string, TokenDef> = Object.fromEntries(
  TOKEN_REGISTRY.map((t) => [t.var, t]),
);
