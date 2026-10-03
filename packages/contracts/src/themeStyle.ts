/**
 * Theme style — the few theme-wide choices the Layout Editor offers beside a block:
 * a colourway, the shape of corners, and whether accent fills glow.
 *
 * None of them is a new kind of setting. Each is a named set of TOKEN values, written
 * into the theme's appearance draft like any Style Editor edit, so they publish,
 * export in a `.xttheme` and show in the Style Editor exactly as tokens do. This file
 * only names the sets and answers "which one is this site wearing?".
 */
import { z } from 'zod';
import { tokenMapSchema, type TokenMap } from './appearance.js';

/** A colourway a theme ships: a name and the global tokens it sets. */
export const colourwaySchema = z.object({
  id:     z.string().regex(/^[a-z0-9-]+$/, 'colourway id must be kebab-case').max(40),
  name:   z.string().min(1).max(40),
  tokens: tokenMapSchema,
});
export type Colourway = z.infer<typeof colourwaySchema>;

export const CORNER_MODES = ['rounded', 'chamfered', 'sharp'] as const;
export type CornerMode = (typeof CORNER_MODES)[number];

/** Top-right and bottom-left cut, the way the Respawn design draws it. */
const cut = (v: string) =>
  `polygon(0 0, calc(100% - var(${v})) 0, 100% var(${v}), 100% 100%, var(${v}) 100%, 0 calc(100% - var(${v})))`;

/**
 * What each corner mode sets. `rounded` is the stock look, and its values are the
 * defaults in `_tokenDefaults.scss` (a test keeps them equal), so choosing it on an
 * unthemed site clears the override rather than freezing a copy of the default.
 */
export const CORNER_PRESETS: Record<CornerMode, TokenMap> = {
  rounded: {
    '--radius-sm': '10px', '--radius-md': '14px', '--radius-lg': '18px', '--radius-xl': '22px',
    '--corner-cut': '0px', '--corner-cut-sm': '0px', '--clip-card': 'none', '--clip-sm': 'none',
  },
  chamfered: {
    '--radius-sm': '0px', '--radius-md': '0px', '--radius-lg': '0px', '--radius-xl': '0px',
    '--corner-cut': '16px', '--corner-cut-sm': '8px',
    '--clip-card': cut('--corner-cut'), '--clip-sm': cut('--corner-cut-sm'),
  },
  sharp: {
    '--radius-sm': '0px', '--radius-md': '0px', '--radius-lg': '0px', '--radius-xl': '0px',
    '--corner-cut': '0px', '--corner-cut-sm': '0px', '--clip-card': 'none', '--clip-sm': 'none',
  },
};

export const GLOW_PRESETS = {
  off: { '--glow-accent': 'none' },
  on:  { '--glow-accent': '0 0 24px color-mix(in srgb, var(--c-accent) 45%, transparent)' },
} satisfies Record<'on' | 'off', TokenMap>;

/** The stock value of every token a theme-style choice touches. */
export const THEME_STYLE_DEFAULTS: TokenMap = { ...CORNER_PRESETS.rounded, ...GLOW_PRESETS.off };

/** Whitespace-insensitive, so `0 0` and `0  0` are the same value. */
const norm = (v: string | undefined) => (v ?? '').replace(/\s+/g, ' ').trim();

/** True when every token of `set` has that value in `effective`. */
export function wears(set: TokenMap, effective: TokenMap): boolean {
  return Object.entries(set).every(([k, v]) => norm(effective[k] ?? THEME_STYLE_DEFAULTS[k]) === norm(v));
}

/** Which corner mode the effective tokens describe, or null for a hand-made mix. */
export function cornerModeOf(effective: TokenMap): CornerMode | null {
  return CORNER_MODES.find((m) => wears(CORNER_PRESETS[m], effective)) ?? null;
}

/**
 * The admin-layer patch that makes `set` the look, given what the theme ships.
 *
 * A value the layer underneath already gives is CLEARED (`null`) rather than written:
 * otherwise picking a theme's own colourway would freeze a copy of it, and the next
 * theme update could no longer move it.
 */
export function patchFor(set: TokenMap, shipped: TokenMap): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(set)) {
    const under = shipped[k] ?? THEME_STYLE_DEFAULTS[k];
    out[k] = under !== undefined && norm(under) === norm(v) ? null : v;
  }
  return out;
}
