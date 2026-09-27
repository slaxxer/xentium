// Shared vocabulary for the Style Editor and anything that has to name a token.
//
// Split out of StyleEditorPage.tsx so the style-history list can label a snapshot's
// tokens with the same words the editor uses — a history row that says
// `--nav-active-bg` when the editor calls it "Active link bg" describes a different
// product than the one the admin was just using.

import type { TFunction } from "i18next";
import {
  TOKEN_BY_VAR,
  VARIANT_TOKEN_ROWS,
  type ThemeScope,
  type TokenGroup,
} from "@xentium/contracts";

/** A palette row — a semantic token that is NOT in TOKEN_REGISTRY (it IS the base). */
export interface ColorRow { l: string; cssVar: string }

export const PALETTE_ROWS: ColorRow[] = [
  { l: "styleEditor.rowBg", cssVar: "--c-bg" },
  { l: "styleEditor.rowSurface", cssVar: "--c-surface" },
  { l: "styleEditor.rowCard", cssVar: "--c-card" },
  { l: "styleEditor.rowAccent", cssVar: "--c-accent" },
  { l: "styleEditor.rowAccent2", cssVar: "--c-accent2" },
  { l: "styleEditor.rowBorder", cssVar: "--c-border" },
];
export const TEXT_ROWS: ColorRow[] = [
  { l: "styleEditor.rowFg", cssVar: "--c-fg" },
  { l: "styleEditor.rowMuted", cssVar: "--c-fg-muted" },
  { l: "styleEditor.rowSubtle", cssVar: "--c-fg-subtle" },
  { l: "styleEditor.rowHoverBg", cssVar: "--c-bg-hover" },
];
export const FEEDBACK_ROWS: ColorRow[] = [
  { l: "styleEditor.rowSuccess", cssVar: "--c-success" },
  { l: "styleEditor.rowWarn", cssVar: "--c-warn" },
  { l: "styleEditor.rowDanger", cssVar: "--c-danger" },
  { l: "styleEditor.rowInfo", cssVar: "--c-info" },
  { l: "styleEditor.rowUpdate", cssVar: "--c-update" },
];

/** The editor's groups, in the order the Jump-to list offers them. */
export type SectionKind = "palette" | "text" | "feedback" | "region" | "component" | "foundation";
export interface Section {
  id: string;
  label: string;
  kind: SectionKind;
  group?: TokenGroup;
  /** Palette-ish sections carry their rows here; registry sections read `group`. */
  rows?: ColorRow[];
}

export const SECTIONS: Section[] = [
  { id: "palette",  label: "styleEditor.secPalette",  kind: "palette",   rows: PALETTE_ROWS },
  { id: "text",     label: "styleEditor.secText",     kind: "text",      rows: TEXT_ROWS },
  { id: "feedback", label: "styleEditor.secFeedback", kind: "feedback",  rows: FEEDBACK_ROWS },
  { id: "tints",    label: "styleEditor.secTints",    kind: "foundation", group: "tints" },
  { id: "navbar",   label: "styleEditor.secNavbar",   kind: "region",    group: "navbar" },
  { id: "content",  label: "styleEditor.secContent",  kind: "region",    group: "content" },
  { id: "footer",   label: "styleEditor.secFooter",   kind: "region",    group: "footer" },
  { id: "aside",    label: "styleEditor.secAside",    kind: "region",    group: "aside" },
  { id: "button",   label: "styleEditor.secButton",   kind: "component", group: "button" },
  { id: "card",     label: "styleEditor.secCard",     kind: "component", group: "card" },
  { id: "field",    label: "styleEditor.secField",    kind: "component", group: "field" },
  { id: "menu",     label: "styleEditor.secMenu",     kind: "component", group: "menu" },
  { id: "segment",  label: "styleEditor.secSegment",  kind: "component", group: "segment" },
  // Foundation: the rest of what the site is built from. Global only.
  { id: "type",     label: "styleEditor.secType",     kind: "foundation", group: "type" },
  { id: "spacing",  label: "styleEditor.secSpacing",  kind: "foundation", group: "spacing" },
  { id: "corners",  label: "styleEditor.secCorners",  kind: "foundation", group: "corners" },
  { id: "shadows",  label: "styleEditor.secShadows",  kind: "foundation", group: "shadows" },
  { id: "layout",   label: "styleEditor.secLayout",   kind: "foundation", group: "layout" },
  { id: "base",     label: "styleEditor.secBase",     kind: "foundation", group: "base" },
];

export const SECTION_BY_ID: Record<string, Section> =
  Object.fromEntries(SECTIONS.map((s) => [s.id, s]));

/**
 * The palette board — the swatches an admin reaches for first, lifted out of the
 * section list so the site's colours are visible without opening anything.
 *
 * Each tile selects the section that owns the token, so the board is navigation
 * as well as display.
 */
export interface BoardCluster { heading: string; tiles: { section: string; cssVar: string }[] }

export const BOARD: BoardCluster[] = [
  { heading: "styleEditor.clSurfaces", tiles: [
    { section: "palette", cssVar: "--c-bg" },
    { section: "palette", cssVar: "--c-surface" },
    { section: "palette", cssVar: "--c-card" },
    { section: "palette", cssVar: "--c-border" },
    { section: "text",    cssVar: "--c-bg-hover" },
  ]},
  { heading: "styleEditor.clBrand", tiles: [
    { section: "palette", cssVar: "--c-accent" },
    { section: "palette", cssVar: "--c-accent2" },
  ]},
  { heading: "styleEditor.clText", tiles: [
    { section: "text", cssVar: "--c-fg" },
    { section: "text", cssVar: "--c-fg-muted" },
    { section: "text", cssVar: "--c-fg-subtle" },
  ]},
  { heading: "styleEditor.clFeedback", tiles: [
    { section: "feedback", cssVar: "--c-success" },
    { section: "feedback", cssVar: "--c-warn" },
    { section: "feedback", cssVar: "--c-danger" },
    { section: "feedback", cssVar: "--c-info" },
  ]},
];

/**
 * Scope picker options for component sections (region surface tokens are global-only).
 *
 * The variant scopes are here because a variant IS a scope (ADR-0005): the Layout
 * Editor's Style panel edits a curated six tokens per variant, and this is where the
 * rest — button, field, menu, radius — can be re-scoped to one. Without them a theme
 * author could apply a look to a block and then not fully define it.
 */
export const SCOPE_OPTIONS: { id: ThemeScope; label: string }[] = [
  { id: "global",  label: "styleEditor.scopeAll" },
  { id: "navbar",  label: "styleEditor.secNavbar" },
  { id: "content", label: "styleEditor.secContent" },
  { id: "footer",  label: "styleEditor.secFooter" },
  { id: "aside",   label: "styleEditor.secAside" },
  { id: "variant.surface", label: "layoutEditor.variant.surface" },
  { id: "variant.muted",   label: "layoutEditor.variant.muted" },
  { id: "variant.accent",  label: "layoutEditor.variant.accent" },
  { id: "variant.plain",   label: "layoutEditor.variant.plain" },
];

export const SCOPE_LABEL: Record<string, string> =
  Object.fromEntries(SCOPE_OPTIONS.map((o) => [o.id, o.label]));

/**
 * Every var that already has an i18n key, for the label lookup below.
 *
 * `VARIANT_TOKEN_ROWS` is in here because `--surface-*` is real, editable (from the
 * Layout Editor's Style panel) and NOT in TOKEN_REGISTRY — so without it the style
 * history renders a raw `--surface-bg` beside properly named tokens.
 */
// ⚠ Variant rows FIRST, palette rows second: `--c-fg`, `--c-fg-muted` and
// `--c-accent` appear in both, and `Object.fromEntries` keeps the LAST entry. The
// Style Editor's own names have to win, or "Primary text" silently becomes the
// Layout Editor's shorter "Text".
const KEYED_LABEL: Record<string, string> = Object.fromEntries([
  ...VARIANT_TOKEN_ROWS.map((r) => [r.cssVar, r.label]),
  ...[...PALETTE_ROWS, ...TEXT_ROWS, ...FEEDBACK_ROWS].map((r) => [r.cssVar, r.l]),
]);

/**
 * The i18n key that names a token, and the English fallback if there is none.
 *
 * `TOKEN_REGISTRY.label` is plain English — it is the contract's documentation of
 * the token, not a translation — so the editor looks up `styleEditor.tok.<var>`
 * first and falls back to it. A plugin that registers a token without shipping a
 * key therefore still renders a readable name rather than a raw CSS variable.
 */
export type Translate = TFunction<"acp", undefined>;

export function tokenLabel(cssVar: string, t: Translate): string {
  const keyed = KEYED_LABEL[cssVar];
  if (keyed) return t(keyed);
  const key = `styleEditor.tok.${cssVar.replace(/^--/, "")}`;
  const translated = t(key, { defaultValue: "" }) as string;
  if (translated) return translated;
  return TOKEN_BY_VAR[cssVar]?.label ?? cssVar;
}
