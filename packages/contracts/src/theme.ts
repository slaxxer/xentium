/**
 * The `.xttheme` package format (ADR-0005).
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
/**
 * The package format's own version.
 *
 * 2 — a site has ONE look, so `tokens.json` is a single scoped map and the stylesheets
 * collapsed from `light`/`dark` pairs to one of each. A version-1 package still
 * installs: the importer reads the old names and keeps the light half.
 */
export const THEME_PACKAGE_VERSION = 2;

/** Where a package keeps its files. */
export const THEME_PATHS = {
  manifest: 'manifest.json',
  /** Full scoped token set — the lossless one. */
  tokens: 'tokens.json',
  /** Global tokens as `:root` CSS. Kept so a `.xttheme` is still a `.xtstyle` superset. */
  css: 'styles/tokens.css',
  /** The admin's own stylesheet, scoped at build time on the importing site. */
  custom: 'styles/custom.css',
  layouts: 'layouts/',
  assets: 'assets/',
} as const;

/**
 * What a package built before there was ONE look called those two files.
 *
 * Read on import, never written on export. A site has one palette now, so the LIGHT
 * half is the half that survives: `:root` was already the light palette, and it is what
 * a visitor rendered unless their OS asked otherwise. Dropping the dark file silently
 * would be wrong — the importer reports it — but carrying it forward would mean
 * reintroducing the second palette this format just stopped having.
 */
export const THEME_PATHS_LEGACY = {
  cssLight: 'styles/light.css',
  cssDark: 'styles/dark.css',
  customLight: 'styles/custom-light.css',
  customDark: 'styles/custom-dark.css',
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
  minXentiumVersion: z.string().regex(/^\d+\.\d+/, 'minXentiumVersion must be semver'),
  maxXentiumVersion: z.string().regex(/^\d+\./).optional(),
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

  /**
   * Whether the author built a DARK theme or a LIGHT one.
   *
   * A site has one look, so this is not a mode the theme offers — it is a fact about
   * the theme, the way "serif" is a fact about a typeface. It exists because the one
   * thing a buyer has to know before opening a preview is which of the two they are
   * looking at, and a thumbnail on a storefront card is too small to say it reliably.
   *
   * Declared, not inferred. Guessing it from `--c-bg` works until a theme is
   * mid-grey, sepia, or sets its background only in custom CSS — and a card that is
   * confidently wrong about this is worse than a card that does not say.
   *
   * Defaults to `light`, which is what stock Xentium is and therefore what a theme
   * that says nothing is built on top of.
   */
  appearance: z.enum(['light', 'dark']).default('light'),
});

export type ThemeManifest = z.infer<typeof themeManifestSchema>;

// `tokens.json` is validated by `scopedTokenSetSchema`, which lives in `appearance.ts`
// beside the token types it describes — the same shape guards the Style Editor's own
// writes, and one definition means a theme import and a token save can never disagree
// about what a token may contain.
