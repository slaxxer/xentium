/**
 * Xentium Dark: the first-party dark theme every install ships with, the core look
 * after dark.
 *
 * The core look itself is the built-in Core theme (the `core-look` mixin in the web
 * app's `_tokenDefaults.scss`, and the code-default layouts). It has ONE accent and
 * ships no colourways; so does this.
 *
 * Xentium Dark is a THEME, not a mode: a site has one look, and a reader who prefers
 * dark wears this one (see docs/style-system.md, "One look, one palette"). It ships
 * tokens only, so its layouts are Core's and it follows them.
 */
import type { TokenMap } from './appearance.js';

/** Its palette. White on a light accent fails contrast, so text on the accent is dark. */
export const XENTIUM_DARK_TOKENS: TokenMap = {
  '--c-bg':           '#121514',
  '--c-bg-hover':     '#1b201e',
  '--c-surface':      '#171b1a',
  '--c-card':         '#1a1e1d',
  '--c-accent':       '#3fb8ab',
  '--c-accent2':      '#6fcfc4',
  '--c-accent-soft':  'rgba(63, 184, 171, 0.14)',
  '--c-accent2-soft': 'rgba(111, 207, 196, 0.12)',
  '--c-accent-glow':  'rgba(63, 184, 171, 0.22)',
  '--c-on-accent':    '#08110f',
  '--c-fg':           '#e8ecea',
  '--c-fg-muted':     '#a1aaa6',
  '--c-fg-subtle':    '#747c78',
  '--c-border':       '#29302d',
  '--c-border-hi':    '#353d39',
  '--c-rowline':      '#1f2422',
  '--input-bg':       '#121514',
  '--c-success':      '#6fbf5a',
  '--c-success-soft': 'rgba(111, 191, 90, 0.14)',
  '--c-warn':         '#e0a43b',
  '--c-danger':       '#ef5d58',
  '--c-danger-soft':  'rgba(239, 93, 88, 0.14)',
  '--c-info':         '#8ea6d0',
  '--c-update':       '#a1aaa6',
  '--shadow-card':    '0 0 0 1px rgba(255, 255, 255, 0.06)',
  '--shadow-pop':     '0 0 0 1px #29302d, 0 16px 40px rgba(0, 0, 0, 0.5)',
  '--nav-bg':         '#171b1a',
  '--footer-bg':      '#171b1a',
  // The header band: a darker teal than the light look's, so it sits on these surfaces.
  '--masthead-from':  '#0b2b28',
  '--masthead-to':    '#1a7f74',
};

/** The id Xentium Dark is installed under. */
export const XENTIUM_DARK_ID = 'xentium-dark';

/**
 * Xentium Dark as a library row would hold it. `version` moves when the bundled package
 * changes, which is what lets an install pick up a newer one at boot.
 */
export const XENTIUM_DARK_PACKAGE = {
  manifest: {
    id: XENTIUM_DARK_ID,
    name: 'Xentium Dark',
    version: '1.0.0',
    vendor: 'Xentium',
    minXentiumVersion: '1.0.0',
    description: 'The core look after dark: deep neutral surfaces and the same teal accent.',
    appearance: 'dark' as const,
    schemaVersion: 1,
    packageVersion: 2,
  },
  payload: {
    documents: {},
    tokens: { global: XENTIUM_DARK_TOKENS },
    // Form controls and scrollbars follow the palette.
    customCss: ':root { color-scheme: dark; }',
  },
};
