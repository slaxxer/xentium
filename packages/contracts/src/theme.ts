/**
 * The `.nvtheme` package format (ADR-0005).
 *
 * A theme is DATA — layout documents, design tokens, custom CSS and assets. It never
 * executes, so reviewing one is reading JSON and a `:root`-only stylesheet.
 *
 * This lives in contracts rather than beside the API's theme service because the
 * format is a contract between two installs: the one that exported and the one that
 * imports. It also replaces a stale three-field `ThemeManifest` interface that sat in
 * `index.ts` and described nothing that was ever written to disk.
 */
import { z } from 'zod';

/** Bumped when the PACKAGE layout changes, independently of the layout schema. */
export const THEME_PACKAGE_VERSION = 1;

/** Where a package keeps its files. */
export const THEME_PATHS = {
  manifest: 'manifest.json',
  /** Full scoped token set — the lossless one. */
  tokens: 'tokens.json',
  /** Global tokens as `:root` CSS. Kept so a `.nvtheme` is still a `.nvstyle` superset. */
  cssLight: 'styles/light.css',
  cssDark: 'styles/dark.css',
  /** The admin's own stylesheet, scoped at build time on the importing site. */
  customLight: 'styles/custom-light.css',
  customDark: 'styles/custom-dark.css',
  layouts: 'layouts/',
  assets: 'assets/',
} as const;

/**
 * What a theme may carry as an asset.
 *
 * Images and fonts only, and checked by magic bytes on import rather than by
 * extension — a package is an untrusted archive from the internet.
 */
export const THEME_ASSET_MIME = [
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml', 'image/avif',
  'font/woff', 'font/woff2', 'font/ttf', 'font/otf',
] as const;

/** Bounded so an import cannot exhaust the disk. */
export const THEME_ASSET_LIMITS = { maxFiles: 100, maxBytesEach: 5_000_000, maxBytesTotal: 40_000_000 };

export const themeManifestSchema = z.object({
  id:      z.string().regex(/^[a-z0-9-]+$/, 'id must be kebab-case'),
  name:    z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+/, 'version must be semver'),
  vendor:  z.string().min(1),

  /** Mirrors the plugin manifest rather than inventing a second convention. */
  minNodevoVersion: z.string().regex(/^\d+\.\d+/, 'minNodevoVersion must be semver'),
  maxNodevoVersion: z.string().regex(/^\d+\./).optional(),
  description:      z.string().max(500).optional(),

  /** The layout schema authored against — surfaced, not enforced: an unknown block is
   *  skipped rather than fatal, which is the whole forward-compatibility story. */
  schemaVersion: z.number().int().min(1).default(1),
  /** The PACKAGE format version, so a future reader knows what it is holding. */
  packageVersion: z.number().int().min(1).default(THEME_PACKAGE_VERSION),

  // ── Distribution metadata ────────────────────────────────────────────────
  // A theme that is sold or shared needs to say who made it and on what terms.
  // Absent before, which made a marketplace listing guesswork.
  license:   z.string().max(120).optional(),
  homepage:  z.string().url().max(300).optional(),
  authorUrl: z.string().url().max(300).optional(),
  /** Asset-relative path to a preview image, e.g. `assets/screenshot.png`. */
  screenshot: z.string().max(300).optional(),
});

export type ThemeManifest = z.infer<typeof themeManifestSchema>;

// `tokens.json` is validated by `scopedTokenSetSchema`, which lives in `appearance.ts`
// beside the token types it describes — the same shape guards the Style Editor's own
// writes, and one definition means a theme import and a token save can never disagree
// about what a token may contain.
