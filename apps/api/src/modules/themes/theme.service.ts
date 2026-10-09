/**
 * `.xttheme` export / import (ADR-0005, step 5).
 *
 * A theme is DATA: layout documents plus token overrides plus assets. There is no
 * executable code in the package, so importing one cannot run anything — review
 * is reading JSON and a `:root`-only stylesheet. Code extension goes through
 * plugins, which is a separate, trusted path.
 *
 * The package is a strict superset of `.xtstyle`: same `styles/light.css` and
 * `styles/dark.css` under the same `:root`-only rule, plus a `layouts/` folder.
 * A `.xtstyle` is simply a theme with no layouts — and since 2026-08-15 that is not
 * just a resemblance: `.xtstyle` was ABSORBED, its separate upload endpoint and its
 * parallel `:root` validator deleted, and this importer takes both shapes
 * (`adoptStylePack`). Export with `tokensOnly` to produce the palette-only kind.
 *
 * An import lands in the DRAFT, never live. A theme changes every page at once,
 * which is precisely the change an admin should preview before committing —
 * publishing stays a separate, deliberate act.
 */
import AdmZip from "adm-zip";
import fs from "node:fs/promises";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileTypeFromBuffer } from "file-type";
import {
  LAYOUT_SCHEMA_VERSION,
  templateKeys,
  blockPropSchemas,
  blockTypesIn,
  collectAssetRefs,
  rewriteAssetRefs,
  themeManifestSchema,
  THEME_ASSET_LIMITS,
  THEME_ASSET_MIME,
  THEME_PACKAGE_VERSION,
  THEME_PATHS,
  THEME_PATHS_LEGACY,
  scopedTokenSetSchema,
  type ThemeManifest,
  layoutDocumentSchema,
  missingRequiredBlocks,
  requiredBlocksFor,
  regionsFor,
  validateBlockTree,
  type LayoutDocument,
  isPortableAssetRef,
  siteFrameSchema,
  type SiteFrame,
  wears,
  HEARTH_DEFAULT_TOKENS,
} from "@xentium/contracts";
import { env } from "../../config/env.js";
import { prisma } from "../../infrastructure/db.js";
import { storage } from "../../infrastructure/storage/LocalStorageProvider.js";
import { XentiumError } from "../../shared/errors/XentiumError.js";
import { XEC } from "../../shared/errors/xec.js";
import { XENTIUM_VERSION, meetsMinimum, withinMaximum } from "../../config/version.js";
import { appearanceService, bustThemeCss, type ScopedTokenSet, type TokenMap } from "../appearance/appearance.service.js";
import { layoutService, bustThemeLayouts } from "../layouts/layout.service.js";
import { activeThemeKey, CORE_THEME, type ThemeKey } from "./themeKey.js";
import { composeDocuments } from "../layouts/composedChromeMigration.js";
import {
  assertThemeCssSafe,
  collectCssUploadRefs,
  rewriteThemeCssUrls,
  toPackageCssUrls,
} from "./themeCss.js";

/**
 * Block types this install can render, derived from the core catalogue in
 * contracts rather than listed by hand — a hand-kept copy would drift the moment
 * a block is added. The web registry also holds plugin-registered blocks, which
 * the API cannot see; those are reported as unknown, never rejected.
 */
const KNOWN_BLOCKS = new Set(Object.keys(blockPropSchemas));

/**
 * Ceiling for a text entry (manifest, a layout, a stylesheet).
 *
 * A real layout document is tens of KB. The point is not the exact number: it is that
 * the DECLARED size is checked before anything is decompressed, so a 40 KB archive
 * cannot expand to gigabytes of heap inside `getData()`.
 */
const MAX_TEXT_ENTRY = 2_000_000;

/**
 * Every refusal from this module.
 *
 * Its OWN code, not the generic `API_VALIDATION`: the web client resolves a XEC code to
 * a localized string when one exists, and `XEC-API-4001` has one — "Please check your
 * input and try again." — which replaced messages like "layouts/home.json declares
 * template \"profile\"" with something an admin cannot act on. A package is rejected for
 * a specific, nameable reason, and that reason is the whole value of the response.
 */
const themeError = (message: string) =>
  new XentiumError({ code: XEC.CORE_THEME_INVALID, httpStatus: 422, message });

/**
 * Zod issues, with the FIELD each one is about.
 *
 * `issue.message` alone is what these reports used to carry, and for a missing required
 * field Zod's message is "Invalid input: expected string, received undefined" — which,
 * repeated once per absent field, tells an admin nothing at all. The path is the only
 * part that identifies what to go and fix.
 */
function issueList(error: { issues: readonly { path: PropertyKey[]; message: string }[] }): string {
  return error.issues
    .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
    .join("; ");
}

/** The format is a contract between two installs, so it is defined in contracts. */
export type ThemeManifestInput = ThemeManifest;

/** Read a text entry, refusing one whose declared size is implausible. */
function readText(entry: AdmZip.IZipEntry, label: string): string {
  if (entry.header.size > MAX_TEXT_ENTRY) {
    throw themeError(`${label} is implausibly large (${entry.header.size} bytes)`);
  }
  return entry.getData().toString("utf8");
}

/** `:root`-only custom properties, the same rule `.xtstyle` enforces. */
function assertTokenCss(css: string, file: string) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  if (!stripped) return;
  if (!/^(:root\s*\{[^}]*\}[\s]*)+$/.test(stripped)) {
    throw themeError(`${file} contains rules other than \`:root\` custom properties`);
  }
  const inner = stripped.replace(/:root\s*\{/g, "").replace(/\}/g, "");
  for (const line of inner.split(";").map((l) => l.trim()).filter(Boolean)) {
    if (!/^--[\w-]+\s*:\s*.+$/.test(line)) throw themeError(`${file}: unexpected declaration "${line}"`);
  }
}

const parseTokens = (css: string): TokenMap => {
  const map: TokenMap = {};
  for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    if (m[1] && m[2]) map[m[1].trim()] = m[2].trim();
  }
  return map;
};

const renderTokens = (map: TokenMap): string => {
  const lines = Object.entries(map).map(([k, v]) => `  ${k}: ${v};`);
  return lines.length ? `:root {\n${lines.join("\n")}\n}\n` : ":root {\n}\n";
};

/**
 * Let a `.xtstyle` in through the theme importer.
 *
 * The two formats were never siblings: `.xtstyle` is `manifest.json` +
 * `styles/light.css` + `styles/dark.css`, which is a strict SUBSET of what a theme
 * carries — the docblock at the top of this file has claimed as much since the format
 * was written. What actually differed was the manifest: a theme requires `id`,
 * `vendor`, `version` and `minXentiumVersion`; a style pack required only `name`. So
 * the superset claim was true of the files and false of the paperwork, and a `.xtstyle`
 * would have been rejected here.
 *
 * The missing fields are filled in, and ONLY for a package that is unmistakably a style
 * pack: no `layouts/`, no `tokens.json`, and a stylesheet present. A real theme with a
 * malformed manifest still gets the strict error it deserves, rather than being quietly
 * given an invented id.
 *
 * `id` is derived from the name so two different packs do not collide on one row, and
 * `minXentiumVersion` is THIS version because a style pack never declared compatibility
 * and refusing it on a field it could not have set would be nonsense.
 */
function adoptStylePack(raw: unknown, zip: AdmZip): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const m = raw as Record<string, unknown>;

  // Already a theme manifest — nothing to adopt.
  if (m.id && m.vendor && m.version && m.minXentiumVersion) return raw;

  const hasThemeParts = zip.getEntries().some((e) =>
    e.entryName.startsWith(THEME_PATHS.layouts) || e.entryName === THEME_PATHS.tokens);
  const hasStyles = !!zip.getEntry(THEME_PATHS.css)
    || !!zip.getEntry(THEME_PATHS_LEGACY.cssLight) || !!zip.getEntry(THEME_PATHS_LEGACY.cssDark);
  if (hasThemeParts || !hasStyles) return raw;

  const name = typeof m.name === "string" && m.name.trim() ? m.name.trim() : "Imported style";
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  return {
    ...m,
    name,
    id:      m.id      ?? (slug || "imported-style"),
    vendor:  m.vendor  ?? "community",
    version: m.version ?? "1.0.0",
    minXentiumVersion: m.minXentiumVersion ?? XENTIUM_VERSION,
  };
}

function assertCompatible(m: ThemeManifestInput) {
  if (!meetsMinimum(XENTIUM_VERSION, m.minXentiumVersion)) {
    throw themeError(`Theme "${m.id}" requires Xentium ${m.minXentiumVersion}+ (this is ${XENTIUM_VERSION})`);
  }
  if (m.maxXentiumVersion && !withinMaximum(XENTIUM_VERSION, m.maxXentiumVersion)) {
    throw themeError(`Theme "${m.id}" supports Xentium up to ${m.maxXentiumVersion} (this is ${XENTIUM_VERSION})`);
  }
}

export interface ImportReport {
  manifest: ThemeManifestInput;
  /** Templates this install actually took from the package. */
  templates: string[];
  /**
   * Templates the package ships that this install has no definition for — a plugin
   * template whose plugin is not installed or not enabled.
   *
   * Skipped rather than stored: without the plugin there are no declared regions to
   * validate against. Enabling the plugin and re-importing applies them.
   */
  unknownTemplates: string[];
  /**
   * Templates the package ships that were KEPT as the admin had them (inheritance).
   *
   * The whole point of the theme layer: re-importing a newer version of a theme must not
   * throw away work. These are the templates whose stored document had moved away from
   * the baseline, so the new version was recorded as the baseline and the admin's
   * document left alone — recoverable at any time with "Revert to theme".
   */
  kept: string[];
  /** The theme that was installed before this import, when there was one. */
  replaced: { id: string; name: string; version: string } | null;
  /**
   * Whether this import put the theme ON the site.
   *
   * Only an UPDATE to the theme the site is already wearing does. Anything else lands
   * in the library inactive and the admin is asked — keep what the site wears, or
   * switch — because installing and switching are two decisions, and a site that
   * changed its whole look because somebody installed a theme to try it was answering
   * a question nobody asked. When false, `templates`/`kept`/`replaced` are empty: the
   * site was not touched.
   */
  activated: boolean;
  /** The theme the site is still wearing when `activated` is false (null = stock). */
  current: { id: string; name: string; version: string } | null;
  tokensApplied: boolean;
  /** Staged in the theme's own CSS layer, under the admin's stylesheet, like everything
   *  else in the package. It used to overwrite the admin's CSS outright, and live. */
  customCssApplied: boolean;
  assetsImported: number;
  /** Non-fatal: blocks the package references that this install cannot render.
   *  They are kept in the document so enabling the plugin later restores them. */
  unknownBlocks: string[];
  /**
   * Non-fatal: files a pre-collapse package shipped that a site with ONE look has
   * nowhere to put — its dark palette and its dark stylesheet.
   *
   * Reported rather than dropped in silence, because "I exported a theme with a dark
   * mode and importing it lost half of it" deserves a sentence, not a mystery. The
   * light half is taken; see `THEME_PATHS_LEGACY`.
   */
  ignoredFiles: string[];
}

/** Read a file out of the uploads dir, or null if it is not there. */
async function readUpload(relPath: string): Promise<Buffer | null> {
  // The reference comes from a stored document, so it is treated as hostile: resolve
  // it and confirm the result is still inside UPLOAD_DIR before reading.
  const root = path.resolve(env.UPLOAD_DIR);
  const full = path.resolve(root, relPath);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  try {
    return await fs.readFile(full);
  } catch {
    return null;
  }
}

/** An asset that passed every check and is ready to be written. */
interface StagedAsset {
  /** Its name inside the package, e.g. `assets/hero.jpg` — what documents reference. */
  packName: string;
  /** The filename it will be stored under. */
  safe: string;
  data: Buffer;
}

/**
 * Check `assets/` without writing anything.
 *
 * A package is an untrusted archive from the internet, so: the type is read from the
 * CONTENT rather than the extension, names are flattened to a basename (an entry called
 * `../../etc/x.png` must not escape), and count and size are bounded so an import
 * cannot exhaust the disk. Kept separate from the write so a bad asset is caught in the
 * same all-or-nothing pass as a bad layout, before a single file lands.
 */
async function stageAssets(zip: AdmZip): Promise<StagedAsset[]> {
  const entries = zip.getEntries().filter(
    (e) => !e.isDirectory && e.entryName.startsWith(THEME_PATHS.assets),
  );
  if (entries.length > THEME_ASSET_LIMITS.maxFiles) {
    throw themeError(`Package carries ${entries.length} assets; the limit is ${THEME_ASSET_LIMITS.maxFiles}`);
  }

  const staged: StagedAsset[] = [];
  const used = new Set<string>();
  let total = 0;

  for (const entry of entries) {
    // Declared size first — `getData()` would allocate the decompressed bytes.
    if (entry.header.size > THEME_ASSET_LIMITS.maxBytesEach) {
      throw themeError(`Asset "${path.basename(entry.entryName)}" exceeds ${THEME_ASSET_LIMITS.maxBytesEach} bytes`);
    }
    const data = entry.getData();
    if (data.length > THEME_ASSET_LIMITS.maxBytesEach) {
      throw themeError(`Asset "${path.basename(entry.entryName)}" exceeds ${THEME_ASSET_LIMITS.maxBytesEach} bytes`);
    }
    total += data.length;
    if (total > THEME_ASSET_LIMITS.maxBytesTotal) {
      throw themeError(`Package assets exceed ${THEME_ASSET_LIMITS.maxBytesTotal} bytes in total`);
    }

    const detected = await fileTypeFromBuffer(data);
    // SVG is XML, so there are no magic bytes to sniff — it is admitted on its
    // extension alone. It is also the one asset kind that can carry script, so
    // `/uploads/themes/` is served with nosniff + a sandbox CSP (app.ts): embedded in
    // an <img> or a CSS url() a script never runs, and navigating straight to the file
    // cannot execute one either.
    const isSvg = !detected && /\.svg$/i.test(entry.entryName);
    const mime = detected?.mime ?? (isSvg ? "image/svg+xml" : undefined);
    if (!mime || !(THEME_ASSET_MIME as readonly string[]).includes(mime)) {
      throw themeError(`Asset "${path.basename(entry.entryName)}" is not an allowed image or font`);
    }

    const safe = path.basename(entry.entryName).replace(/[^\w.-]/g, "_");
    if (used.has(safe)) {
      throw themeError(`Package holds two assets that would be stored as "${safe}"`);
    }
    used.add(safe);
    staged.push({ packName: entry.entryName, safe, data });
  }
  return staged;
}

/**
 * Open a package and read its manifest, without touching a single setting.
 *
 * Split out of `importTheme` so the marketplace download gate can ask "is this
 * really the theme I asked for?" the way it already asks a `.xtplugin` — the
 * check that a package's manifest id matches the requested product. Doing that
 * by starting an import and rolling it back is not an option: an import is
 * all-or-nothing but it is not free, and the point is to refuse the bytes BEFORE
 * anything is staged.
 */
function readManifest(fileBuffer: Buffer): { zip: AdmZip; manifest: ThemeManifestInput } {
  let zip: AdmZip;
  try {
    zip = new AdmZip(fileBuffer);
  } catch {
    throw themeError("Not a readable .xttheme archive");
  }

  const manifestEntry = zip.getEntry(THEME_PATHS.manifest);
  if (!manifestEntry) throw themeError(`Missing ${THEME_PATHS.manifest}`);

  const manifestText = readText(manifestEntry, THEME_PATHS.manifest);
  let raw: unknown;
  try {
    raw = JSON.parse(manifestText);
  } catch {
    throw themeError("manifest.json is not valid JSON");
  }

  const parsed = themeManifestSchema.safeParse(adoptStylePack(raw, zip));
  if (!parsed.success) {
    throw themeError(`Invalid manifest: ${issueList(parsed.error)}`);
  }
  return { zip, manifest: parsed.data };
}

/** A colourway as the public theme chooser sees it. */
export interface VisitorColourway { id: string; name: string; swatch: string[] }

// ── The Themes page: what each theme looks like, and what it is wearing ─────────

/** The five colours a theme card draws: its background, surfaces, accents and text. */
export interface ThemePalette { bg: string; surface: string; accent: string; accent2: string; fg: string }
const PALETTE_TOKENS: Record<keyof ThemePalette, string> = {
  bg: "--c-bg", surface: "--c-surface", accent: "--c-accent", accent2: "--c-accent2", fg: "--c-fg",
};

/** A token's value with `var(--x)` references followed — swatches need a colour, not a name. */
function resolveToken(name: string, map: TokenMap, depth = 0): string {
  const raw = map[name] ?? HEARTH_DEFAULT_TOKENS[name] ?? "";
  const ref = /^var\(\s*(--[a-zA-Z0-9_-]+)\s*(?:,\s*([^)]+))?\)$/.exec(raw.trim());
  if (!ref || depth > 6) return raw;
  const next = resolveToken(ref[1]!, map, depth + 1);
  return next || (ref[2]?.trim() ?? "");
}

const paletteOf = (global: TokenMap): ThemePalette =>
  Object.fromEntries(Object.entries(PALETTE_TOKENS).map(([k, v]) => [k, resolveToken(v, global)])) as unknown as ThemePalette;

/** What `?theme=` / the API calls a theme: Core is `''`. */
interface ThemeSummary {
  key: ThemeKey;
  palette: ThemePalette;
  colourways: Array<{ id: string; name: string; accent: string; accent2: string }>;
  /** The colourway the theme wears now — null when the admin's colours match none. */
  wornColourway: string | null;
  /** The last time anything of this theme was edited: colours, layouts or settings. */
  editedAt: string | null;
}

export const themeService = {
  /** What this package claims to be. The download gate's check, and nothing more —
   *  a package that passes here can still be refused by the full import. */
  validateOnly(fileBuffer: Buffer): ThemeManifestInput {
    return readManifest(fileBuffer).manifest;
  },

  /**
   * Build a `.xttheme` from what is currently PUBLISHED — the site as visitors
   * see it, not a half-finished draft.
   */
  async exportTheme(
    meta: Pick<ThemeManifestInput, "id" | "name" | "version" | "vendor" | "description"
      | "license" | "homepage" | "authorUrl">
      // DECLARED by the exporting admin, never inferred from the tokens: guessing it
      // from `--c-bg` works until a palette is mid-grey, sepia, or sets its background
      // only in custom CSS, and a storefront card that is confidently wrong about this
      // is worse than one that does not say. Absent = the schema's default, `light`.
      & Partial<Pick<ThemeManifestInput, "appearance">>,
    opts: { tokensOnly?: boolean; screenshot?: Buffer; themeKey?: ThemeKey } = {},
  ): Promise<Buffer> {
    // The theme being exported: the one asked for, else the one visitors see.
    const exportKey = opts.themeKey ?? await activeThemeKey();
    /**
     * The preview image, packed like any other asset and named in the manifest.
     *
     * `screenshot` has been in the manifest schema since the format was written and
     * nothing ever produced one — a listing had no picture, which on a marketplace is
     * the difference between a theme someone looks at and one they scroll past. It is
     * an ASSET rather than a URL because it has to travel with the package: a link to
     * the exporting site's uploads is a broken image on the marketplace and everywhere
     * else, exactly as a document's image reference would be.
     *
     * Validated HERE rather than in the route because "what a theme may carry" is this
     * file's rule, and it is the same magic-byte check an imported asset gets — an
     * export is the one end of the format we control, so shipping something an import
     * would refuse is a bug we would only find on someone else's install.
     */
    let screenshotName: string | undefined;
    if (opts.screenshot?.length) {
      if (opts.screenshot.length > THEME_ASSET_LIMITS.maxBytesEach) {
        throw themeError(`The preview image exceeds ${THEME_ASSET_LIMITS.maxBytesEach} bytes`);
      }
      const detected = await fileTypeFromBuffer(opts.screenshot);
      // Images only, and no SVG: a preview is rendered by a marketplace that did not
      // build the package, and SVG is the one image kind that can carry script. Inside
      // a theme's own assets it is admitted under a sandbox CSP this file cannot promise
      // anyone else has.
      const ok = detected && ["image/png", "image/jpeg", "image/webp", "image/avif"].includes(detected.mime);
      if (!ok) throw themeError("The preview image must be a PNG, JPEG, WebP or AVIF");
      screenshotName = `screenshot.${detected.ext}`;
    }

    // A theme's colourways are part of the THEME, not of the export form: exporting
    // an installed theme again must not drop the sets its Theme style tab offers.
    const source = exportKey
      ? await prisma.theme.findUnique({ where: { id: exportKey }, select: { manifest: true } })
      : null;
    const colourways = (source?.manifest as { colourways?: unknown } | null)?.colourways;

    const manifest: ThemeManifestInput = themeManifestSchema.parse({
      ...(Array.isArray(colourways) ? { colourways } : {}),
      ...meta,
      minXentiumVersion: XENTIUM_VERSION,
      schemaVersion:    LAYOUT_SCHEMA_VERSION,
      packageVersion:   THEME_PACKAGE_VERSION,
      ...(screenshotName ? { screenshot: `${THEME_PATHS.assets}${screenshotName}` } : {}),
    });

    const [layouts, tokens, customCss, frame] = await Promise.all([
      layoutService.getPublishedFor(exportKey),
      // EFFECTIVE, not just the admin layer: an export is "the site as visitors see it",
      // and on a site with a theme installed most of the look lives in the theme layer.
      // Exporting the admin layer alone would produce a package that is only the diff.
      appearanceService.getEffectiveTokens(exportKey),
      // EFFECTIVE, for the same reason the tokens above are: an export is "the site as
      // visitors see it", and on a site running a theme most of the stylesheet is the
      // theme's. Exporting the admin layer alone would drop it silently.
      (async () => {
        const [admin, theme] = await Promise.all([
          appearanceService.getCustomCss(exportKey),
          appearanceService.getThemeCustomCss(exportKey),
        ]);
        // Theme layer first, admin second — the same order the site serves them in, so
        // an export of a customised theme keeps the customisation winning.
        return [theme, admin].filter((c) => c.trim()).join("\n\n");
      })(),
      layoutService.getPublishedFrame(exportKey),
    ]);

    const zip = new AdmZip();

    // ── Assets ────────────────────────────────────────────────────────────
    // Every upload path a document references is copied INTO the package and the
    // reference rewritten to `assets/<file>`. Without this an exported theme points
    // at `uploads/pages/<id>/hero.jpg` on the machine it came from, which is a
    // broken image everywhere else — the reference travels, the file does not.
    const assetNames = new Map<string, string>();   // upload path → name in the zip
    const used = new Set<string>();
    // Reserved BEFORE the documents are walked, so a page image that happens to be
    // called `screenshot.png` is renamed around it rather than overwriting the preview.
    // The collision is silent otherwise: `zip.addFile` twice under one name leaves
    // whichever won, and the manifest would point at a page's hero image.
    if (screenshotName) {
      used.add(screenshotName);
      zip.addFile(`${THEME_PATHS.assets}${screenshotName}`, opts.screenshot!);
    }
    // Registered templates, so a theme exported from a site running the forum carries
    // the forum's pages too. On a site without that plugin the file is skipped at
    // import — the same "unknown thing is skipped, not fatal" rule as a block.
    // A TOKENS-ONLY package: the palette and nothing else — what `.xtstyle` was for,
    // now expressed in the one format. Skipping the layouts also skips the assets,
    // since the only assets an export collects are the ones layouts reference.
    const exportable = opts.tokensOnly
      ? []
      : templateKeys().filter((key) => layouts.templates[key]);
    for (const key of exportable) {
      for (const ref of collectAssetRefs(layouts.templates[key]!)) {
        if (assetNames.has(ref)) continue;
        const buf = await readUpload(ref);
        if (!buf) continue;   // a dangling reference is left as-is, not fatal
        // Flat namespace inside the package, so collisions between two directories
        // holding `hero.jpg` have to be resolved rather than silently overwrite.
        const base = path.basename(ref).replace(/[^\w.-]/g, "_");
        let name = base;
        for (let i = 2; used.has(name); i++) name = `${i}-${base}`;
        used.add(name);
        assetNames.set(ref, name);
        zip.addFile(`${THEME_PATHS.assets}${name}`, buf);
      }
    }

    // ── Layouts ───────────────────────────────────────────────────────────
    // Every template, including untouched ones. A theme that carried only the
    // edited templates would silently inherit whatever the target site had.
    //
    // TEMPLATE DEFAULTS ONLY — per-page variants are deliberately excluded. A
    // variant is keyed by a page slug, and slugs are this site's content, not the
    // theme's: importing them elsewhere would either miss (a page that does not
    // exist) or hijack a same-named page the theme author never saw.
    for (const key of exportable) {
      const doc = structuredClone(layouts.templates[key]!);
      rewriteAssetRefs(doc, (ref) => {
        const name = assetNames.get(ref);
        return name ? `${THEME_PATHS.assets}${name}` : undefined;
      });
      zip.addFile(`${THEME_PATHS.layouts}${key}.json`, Buffer.from(JSON.stringify(doc, null, 2), "utf8"));
    }

    // ── Site frame ────────────────────────────────────────────────────────
    // Always written with the layouts, even at full width: an export is the site as
    // visitors see it, and "full width" is a choice the theme makes too. Its body
    // background image travels like a section background does.
    if (!opts.tokensOnly) {
      const packed = structuredClone(frame);
      const ref = packed.background.image;
      if (isPortableAssetRef(ref)) {
        let name = assetNames.get(ref);
        if (!name) {
          const buf = await readUpload(ref);
          if (buf) {
            const base = path.basename(ref).replace(/[^\w.-]/g, "_");
            name = base;
            for (let i = 2; used.has(name); i++) name = `${i}-${base}`;
            used.add(name);
            assetNames.set(ref, name);
            zip.addFile(`${THEME_PATHS.assets}${name}`, buf);
          }
        }
        if (name) packed.background.image = `${THEME_PATHS.assets}${name}`;
      }
      zip.addFile(THEME_PATHS.frame, Buffer.from(JSON.stringify(packed, null, 2), "utf8"));
    }

    // ── Tokens ────────────────────────────────────────────────────────────
    // `tokens.json` is the lossless one: the FULL scoped set, including the region
    // scopes (ADR-0003) that the CSS file cannot express. The CSS stays so a `.xttheme`
    // remains a strict `.xtstyle` superset, and an importer prefers the JSON when both
    // are present. ONE of each now — the pre-collapse pair only ever existed to answer
    // `prefers-color-scheme`, and nothing asks.
    zip.addFile(THEME_PATHS.tokens, Buffer.from(JSON.stringify(tokens, null, 2), "utf8"));
    zip.addFile(THEME_PATHS.css, Buffer.from(renderTokens(tokens.global ?? {}), "utf8"));

    // ── Custom CSS ────────────────────────────────────────────────────────
    // The escape hatch for a look the tokens cannot express. Stored raw and scoped by
    // the IMPORTING site at build time, exactly as the console's own CSS is.
    //
    // Its `url()`s get the same treatment a document's asset references do: the file is
    // copied into the package and the reference rewritten package-relative. Without it
    // an exported stylesheet points at `/uploads/themes/<the SOURCE site's id>/…`, which
    // is a broken image everywhere else — and which the importer now refuses outright as
    // a file the package does not carry.
    const packCss = async (css: string): Promise<string> => {
      if (!css.trim()) return css;
      for (const ref of collectCssUploadRefs(css)) {
        if (assetNames.has(ref)) continue;
        const buf = await readUpload(ref);
        if (!buf) continue;   // dangling, left as authored — not fatal, same as a document
        const base = path.basename(ref).replace(/[^\w.-]/g, "_");
        let name = base;
        for (let i = 2; used.has(name); i++) name = `${i}-${base}`;
        used.add(name);
        assetNames.set(ref, name);
        zip.addFile(`${THEME_PATHS.assets}${name}`, buf);
      }
      return toPackageCssUrls(css, (upload) => {
        const name = assetNames.get(upload);
        return name ? `${THEME_PATHS.assets}${name}` : undefined;
      });
    };

    const packedCustom = await packCss(customCss);
    if (packedCustom.trim()) {
      zip.addFile(THEME_PATHS.custom, Buffer.from(packedCustom, "utf8"));
    }

    zip.addFile(THEME_PATHS.manifest, Buffer.from(JSON.stringify(manifest, null, 2), "utf8"));
    return zip.toBuffer();
  },

  /**
   * Validate a package and stage it as the draft. Nothing goes live here.
   *
   * Validation is all-or-nothing: a package with one broken layout applies none
   * of itself, so an admin never ends up with half a theme and no clean way back.
   *
   * Accepts a `.xtstyle` too — see `adoptStylePack`. One ingestion path for both,
   * which is the point of having merged them.
   */
  /**
   * Undo the last theme import — the whole of it, in one action.
   *
   * The counterpart to the rollback point taken in `importTheme`, and the thing that
   * makes installing a theme a decision an admin can walk back. Restores the staged
   * layout scopes and the appearance theme layers exactly as they were, then drops
   * the undo point: it describes a state that no longer exists once it has been
   * applied, and offering it twice would put the site back to before an import that
   * has already been undone.
   *
   * ⚠ What it does NOT do is delete the theme's uploaded ASSETS
   * (`uploads/themes/<id>/`). Nothing else references them once the documents are
   * restored, and the purge job already reclaims unreferenced uploads — whereas
   * deleting them here would race a re-import of the same theme and break the
   * documents it had just written. Files are cheap; a broken layout is not.
   */
  async discardImportedTheme(userId: string): Promise<{ restored: boolean; replaced: string | null }> {
    const rollback = await appearanceService.getThemeRollback();
    if (!rollback) return { restored: false, replaced: null };

    // An UPDATE replaced a theme's package and released its untouched layouts: put
    // both back exactly as they were.
    if (rollback.update) {
      const { themeId, payload, manifest, layouts } = rollback.update;
      const exists = await prisma.theme.findUnique({ where: { id: themeId }, select: { id: true } });
      if (exists) {
        await prisma.theme.update({
          where: { id: themeId },
          data:  { payload: payload as object, manifest: manifest as object },
        });
        bustThemeCss(themeId);
        bustThemeLayouts(themeId);
        await layoutService.restoreTheme(layouts, userId, themeId);
        await appearanceService.recompileCustomCss(themeId);
      }
    }
    // A colourway made live: that theme's colours as they were.
    if (rollback.tokens) {
      const { key, ...snapshot } = rollback.tokens;
      const exists = !key || await prisma.theme.findUnique({ where: { id: key }, select: { id: true } });
      if (exists) {
        await appearanceService.restoreTokens(snapshot, userId, key);
        bustThemeCss(key);
      }
    }
    // Then the theme that was live before — Core when it has since been removed.
    const back = rollback.previous
      && await prisma.theme.findUnique({ where: { id: rollback.previous }, select: { id: true } })
      ? rollback.previous : CORE_THEME;
    await this.setActive(back);
    await appearanceService.clearThemeRollback();

    return { restored: true, replaced: rollback.replaced };
  },

  /** Is there a theme import that can still be walked back? */
  async getRollbackState(): Promise<{ available: boolean; replaced: string | null; at: string | null; update: boolean }> {
    const rollback = await appearanceService.getThemeRollback();
    return {
      available: !!rollback,
      replaced:  rollback?.replaced ?? null,
      at:        rollback?.at ?? null,
      // Undoing an UPDATE puts the old package's layouts back over that theme's pages,
      // which can lose edits made since; a switch or a colourway loses nothing.
      update:    !!rollback?.update,
    };
  },

  async importTheme(fileBuffer: Buffer, userId: string): Promise<ImportReport> {
    const { zip, manifest } = readManifest(fileBuffer);
    assertCompatible(manifest);

    // ── Parse everything BEFORE writing anything ──────────────────────────
    const documents: Partial<Record<string, LayoutDocument>> = {};
    const unknownBlocks = new Set<string>();
    const unknownTemplates: string[] = [];

    for (const key of templateKeys()) {
      const entry = zip.getEntry(`${THEME_PATHS.layouts}${key}.json`);
      if (!entry) continue; // a theme may ship only some templates

      const text = readText(entry, `${THEME_PATHS.layouts}${key}.json`);
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw themeError(`layouts/${key}.json is not valid JSON`);
      }

      const parsed = layoutDocumentSchema.safeParse(json);
      if (!parsed.success) {
        throw themeError(`layouts/${key}.json is not a valid layout: ${issueList(parsed.error)}`);
      }
      if (parsed.data.templateKey !== key) {
        throw themeError(`layouts/${key}.json declares template "${parsed.data.templateKey}"`);
      }
      const declared = new Set(regionsFor(key));
      const bad = Object.keys(parsed.data.regions).filter((r) => !declared.has(r));
      if (bad.length) throw themeError(`layouts/${key}.json uses unknown region(s): ${bad.join(", ")}`);

      // The same structural and required-block rules `saveDraft` enforces, run
      // HERE so a package that breaks one is rejected before anything is written.
      // Discovering it during staging would leave earlier templates applied and
      // later ones not, which is exactly the half-applied theme this pass exists
      // to prevent.
      const treeProblems = validateBlockTree(parsed.data.regions, {
        requiredTypes: requiredBlocksFor(key),
      });
      if (treeProblems.length) {
        throw themeError(`layouts/${key}.json has an invalid block tree: ${treeProblems.join(" ")}`);
      }
      const missing = missingRequiredBlocks(key, parsed.data);
      if (missing.length) {
        throw themeError(`layouts/${key}.json is missing required block(s): ${missing.join(", ")}`);
      }

      // Unknown block types are NOT fatal — the renderer skips them and keeps
      // them in the document. Report them so the admin knows what will be
      // missing and which plugin would restore it. Walked at every depth, since a
      // plugin block can sit inside a section or a column.
      for (const type of blockTypesIn(parsed.data)) {
        if (!KNOWN_BLOCKS.has(type)) unknownBlocks.add(type);
      }
      documents[key] = parsed.data;
    }

    /**
     * Layouts the package ships for templates this install does not have.
     *
     * A theme exported from a site running the forum carries `layouts/forum.index.json`;
     * a site without the forum has nothing to validate it against — no declared regions,
     * no required blocks — so it is skipped rather than stored. Reported, not silent:
     * "some of this theme did not apply" is exactly what an admin needs to know, and
     * the fix (enable the plugin, re-import) is theirs to make.
     *
     * Driven off the ARCHIVE rather than the registry, which is the only way to see a
     * template nobody registered.
     */
    for (const entry of zip.getEntries()) {
      const name = entry.entryName;
      if (entry.isDirectory) continue;
      if (!name.startsWith(THEME_PATHS.layouts) || !name.endsWith(".json")) continue;
      const key = name.slice(THEME_PATHS.layouts.length, -".json".length);
      // A nested path under layouts/ is not a template file; ignore it rather than
      // reporting a "template" whose key contains a slash.
      if (!key || key.includes("/")) continue;
      if (!(key in documents)) unknownTemplates.push(key);
    }

    // ── Site frame ────────────────────────────────────────────────────────
    // Optional: a package from before frames existed has none, and wears full width.
    let frame: SiteFrame | null = null;
    const frameEntry = zip.getEntry(THEME_PATHS.frame);
    if (frameEntry) {
      let json: unknown;
      try {
        json = JSON.parse(readText(frameEntry, THEME_PATHS.frame));
      } catch {
        throw themeError(`${THEME_PATHS.frame} is not valid JSON`);
      }
      const parsed = siteFrameSchema.safeParse(json);
      if (!parsed.success) {
        throw themeError(`${THEME_PATHS.frame} is invalid: ${issueList(parsed.error)}`);
      }
      frame = parsed.data;
    }

    // Files a pre-collapse package carries that a one-look site cannot use. Collected,
    // not thrown — an old theme still installs, it just installs as one palette.
    const ignoredFiles: string[] = [];

    const readCss = (p: string) => {
      const entry = zip.getEntry(p);
      return entry ? readText(entry, p) : "";
    };

    // ── Tokens ────────────────────────────────────────────────────────────
    // `tokens.json` wins when present: it is the only file that can express the region
    // scopes. The CSS file remains the fallback, which is what a hand-written `.xtstyle`
    // ships and all this format could read before.
    //
    // A pre-collapse package is read through the same door: its `tokens.json` is a
    // `{light, dark}` pair and its styles are two files, and in both cases the LIGHT
    // half is the one a one-look site keeps.
    let tokens: ScopedTokenSet | null = null;
    const tokensEntry = zip.getEntry(THEME_PATHS.tokens);
    if (tokensEntry) {
      const text = readText(tokensEntry, THEME_PATHS.tokens);
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw themeError(`${THEME_PATHS.tokens} is not valid JSON`);
      }
      // `light`/`dark` are not scope names, so finding one at the top level identifies
      // the older shape unambiguously.
      let candidate: unknown = json;
      if (json && typeof json === "object" && !Array.isArray(json)
          && ("light" in json || "dark" in json)) {
        const pair = json as { light?: unknown; dark?: unknown };
        candidate = pair.light ?? {};
        if (pair.dark && Object.keys(pair.dark as object).length > 0) {
          ignoredFiles.push(`${THEME_PATHS.tokens} (dark)`);
        }
      }
      const parsed = scopedTokenSetSchema.safeParse(candidate);
      if (!parsed.success) {
        throw themeError(`${THEME_PATHS.tokens} is invalid: ${issueList(parsed.error)}`);
      }
      tokens = parsed.data;
    } else {
      const cssPath = zip.getEntry(THEME_PATHS.css) ? THEME_PATHS.css
        : zip.getEntry(THEME_PATHS_LEGACY.cssLight) ? THEME_PATHS_LEGACY.cssLight
        : null;
      if (zip.getEntry(THEME_PATHS_LEGACY.cssDark)) ignoredFiles.push(THEME_PATHS_LEGACY.cssDark);
      if (cssPath) {
        const css = readText(zip.getEntry(cssPath)!, cssPath);
        assertTokenCss(css, cssPath);
        tokens = { global: parseTokens(css) };
      }
    }

    // ── Custom CSS ────────────────────────────────────────────────────────
    // Not `:root`-restricted — this is the escape hatch, and it is scoped by the
    // importing site the same way the console's own CSS is. Parsed here so a syntax
    // error is caught in this pass instead of by `saveCustomCss` mid-write.
    const customCss = zip.getEntry(THEME_PATHS.custom)
      ? readCss(THEME_PATHS.custom)
      : readCss(THEME_PATHS_LEGACY.customLight);
    if (readCss(THEME_PATHS_LEGACY.customDark).trim()) {
      ignoredFiles.push(THEME_PATHS_LEGACY.customDark);
    }
    const hasCustomCss = !!customCss.trim();

    const assets = await stageAssets(zip);

    /**
     * A stranger's stylesheet, checked before a single byte is written.
     *
     * It runs here rather than after the assets are saved because a package that must
     * be refused has to be refused while refusing it is still free — the same
     * all-or-nothing rule the layouts and tokens follow. That is also why it takes the
     * package's asset NAMES: the paths they will be stored at do not exist yet.
     */
    const packAssets = new Set(assets.map((a) => a.packName));
    assertThemeCssSafe(customCss, THEME_PATHS.custom, packAssets);

    if (Object.keys(documents).length === 0 && !tokens && !hasCustomCss && !frame) {
      throw themeError("Package contains no layouts and no styles");
    }

    // ── Stage ─────────────────────────────────────────────────────────────
    // Assets first: the documents reference where they land, so the rewrite below
    // needs the stored paths. Each theme gets a directory keyed by its manifest id, so
    // re-importing an update overwrites its own files and never another theme's.
    const assetPaths = new Map<string, string>();
    for (const asset of assets) {
      assetPaths.set(asset.packName, await storage.save(
        path.join("themes", manifest.id), asset.safe, asset.data,
      ));
    }

    /**
     * The applicable form of this theme, with every asset reference already pointing
     * at where the files actually landed on THIS install.
     *
     * Built before anything is applied, and stored in the library, because it is what
     * lets the theme be activated again later without the `.xttheme` it came from.
     * Storing the raw package instead would mean re-unpacking (and re-writing assets)
     * on every switch, and would leave the stored copy disagreeing with the files on
     * disk the moment either changed.
     */
    const shot = manifest.screenshot ? assetPaths.get(manifest.screenshot) : undefined;
    const installedManifest = { ...manifest, ...(shot ? { screenshot: shot } : {}) };

    const rewriteCss = (css: string) => rewriteThemeCssUrls(css, (ref) => assetPaths.get(ref));
    for (const doc of Object.values(documents)) {
      if (doc) rewriteAssetRefs(doc, (ref) => assetPaths.get(ref));
    }
    if (frame && isPortableAssetRef(frame.background.image)) {
      frame.background.image = assetPaths.get(frame.background.image) ?? frame.background.image;
    }

    // A package built before the composed header and footer installs in the
    // current shape, the same carry-over every stored site got.
    const composed = composeDocuments(documents as Record<string, unknown>);
    const payload: ThemePayload = {
      documents: (composed ?? documents) as Record<string, LayoutDocument>,
      tokens:    tokens ?? null,
      customCss: hasCustomCss ? rewriteCss(customCss) : null,
      frame,
    };

    /*
     * INSTALL is not SWITCH. A new theme lands in the library beside the active one
     * and the site does not change. Reinstalling one that is already here is an
     * UPDATE of that theme: its own layouts the admin left as shipped follow the new
     * version, the ones they changed are kept — decided against the OLD package, so it
     * runs before the row is replaced.
     */
    const existing = await prisma.theme.findUnique({
      where: { id: manifest.id }, select: { payload: true, manifest: true, active: true },
    });
    let kept: string[] = [];
    if (existing) {
      const worn = await appearanceService.getInstalledTheme();
      await appearanceService.saveThemeRollback({
        previous: await activeThemeKey(),
        replaced: worn ? String(worn.name ?? worn.id ?? "") : null,
        at:       new Date().toISOString(),
        update: {
          themeId:  manifest.id,
          payload:  existing.payload,
          manifest: existing.manifest,
          layouts:  await layoutService.snapshotTheme(manifest.id),
        },
      });
      kept = (await layoutService.releaseUntouched(manifest.id)).kept;
    }

    await this.saveInstalledTheme(installedManifest, payload, userId, { activate: !!existing?.active });
    // The theme's stylesheet is part of its package, compiled with the admin's own.
    await appearanceService.recompileCustomCss(manifest.id);
    // An update changes what the theme looks like for anyone seeing it; a brand-new
    // theme is seen by no one yet, so open tabs have nothing to refetch.
    if (existing) await appearanceService.bumpStyleVersion();

    const active = await appearanceService.getInstalledTheme();
    const shipped = Object.keys(documents);
    return {
      manifest,
      unknownTemplates,
      assetsImported: assets.length,
      unknownBlocks: [...unknownBlocks],
      ignoredFiles,
      activated: !!existing?.active,
      current: !existing?.active && active
        ? { id: String(active.id ?? ""), name: String(active.name ?? active.id ?? ""), version: String(active.version ?? "") }
        : null,
      templates: shipped.filter((k) => !kept.includes(k)),
      kept,
      replaced: existing ? { id: manifest.id, name: String(existing.manifest && (existing.manifest as Record<string, unknown>).name || manifest.name), version: String((existing.manifest as Record<string, unknown>)?.version ?? "") } : null,
      tokensApplied: !!tokens,
      customCssApplied: hasCustomCss,
    };
  },

  /**
   * Make one theme the site's — or Core, with `''`. Nothing is copied: every theme
   * already carries its own layouts and appearance, so switching is choosing which
   * one visitors get, and switching back restores it exactly.
   */
  async setActive(key: ThemeKey): Promise<void> {
    if (key) {
      const row = await prisma.theme.findUnique({ where: { id: key }, select: { manifest: true } });
      if (!row) return;
      await prisma.$transaction([
        prisma.theme.updateMany({ where: { active: true }, data: { active: false } }),
        prisma.theme.update({ where: { id: key }, data: { active: true, activatedAt: new Date() } }),
      ]);
      await appearanceService.setInstalledTheme(row.manifest as Record<string, unknown>);
    } else {
      await prisma.theme.updateMany({ where: { active: true }, data: { active: false } });
      await appearanceService.setInstalledTheme(null);
    }
    await appearanceService.bumpStyleVersion();
  },

  /** Add or update a library row — and, by default, make it the active one. Exactly
   *  one row may be active, which is why the clear and the set share a transaction.
   *  `activate: false` installs beside the active theme without touching it. */
  async saveInstalledTheme(
    manifest: Record<string, unknown>,
    payload: ThemePayload,
    userId: string,
    { activate = true }: { activate?: boolean } = {},
  ): Promise<void> {
    const id = String(manifest.id ?? "");
    const row = {
      name:    String(manifest.name ?? id),
      version: String(manifest.version ?? "0.0.0"),
      vendor:  String(manifest.vendor ?? ""),
      manifest:    manifest as object,
      payload:     payload as unknown as object,
      active:      activate,
    };
    await prisma.$transaction([
      ...(activate ? [prisma.theme.updateMany({ where: { active: true }, data: { active: false } })] : []),
      // Reinstalling the same id replaces the payload, so anything built from the
      // old one has to go — the caches are keyed by id alone and would otherwise
      // outlive the version they were built from.
      prisma.theme.upsert({
        where:  { id },
        update: row,
        create: { id, ...row, installedById: userId },
      }),
    ]);
    bustThemeCss(id);
    bustThemeLayouts(id);
    // The active theme's manifest is what the ACP names; an update renames it.
    if (activate) await appearanceService.setInstalledTheme(manifest);
  },

  /** Everything installed here, newest first, with the active one flagged. */
  /**
   * What a VISITOR may know about the installed themes: a name and an id.
   *
   * Deliberately not `listThemes`: that carries the vendor, the manifest, install
   * timestamps and who installed it — an admin's inventory, and none of a reader's
   * business. This feeds the public switcher, so it says only what is needed to
   * offer a choice and to show which one is the site's own.
   */
  async listThemesForVisitors(): Promise<{
    id: string; name: string; version: string; active: boolean;
    description: string | null; screenshot: string | null;
    colourways: VisitorColourway[]; wornColourway: string | null;
  }[]> {
    const rows = await prisma.theme.findMany({
      orderBy: [{ active: "desc" }, { name: "asc" }],
      // The manifest comes too, but only three of its fields are passed on: a reader
      // choosing a theme is shown what it is CALLED, what it LOOKS like and what it
      // says about itself. The vendor, the compatibility range and the rest stay in
      // the admin's library.
      select: { id: true, name: true, version: true, active: true, manifest: true },
    });
    return Promise.all(rows.map(async ({ manifest, ...row }) => {
      const m = (manifest ?? {}) as Record<string, unknown>;
      const colourways = await appearanceService.getColourways(row.id);
      /**
       * The colourway the theme wears with no pick from the visitor — the shipped
       * one, or whichever the admin chose for it. Null when the admin's edits match
       * none of them. The chooser marks it, and picking it CLEARS the visitor's
       * choice rather than storing it, so they go on following the site.
       */
      let wornColourway: string | null = null;
      if (colourways.length) {
        const global = (await appearanceService.getEffectiveTokens(row.id)).global ?? {};
        wornColourway = colourways.find((c) => wears(c.tokens, global))?.id ?? null;
      }
      return {
        ...row,
        description: typeof m.description === "string" ? m.description : null,
        // Where the image actually LANDED — import rewrites the package-relative
        // path to this install's uploads. A theme with none is normal, and the
        // chooser draws a placeholder rather than a broken image.
        screenshot:  typeof m.screenshot === "string" ? m.screenshot : null,
        // Three colours each, enough to draw a swatch — not the whole token map.
        colourways: colourways.map((c) => ({
          id: c.id, name: c.name,
          swatch: [c.tokens["--c-bg"], c.tokens["--c-accent"], c.tokens["--c-accent2"]]
            .filter((v): v is string => typeof v === "string"),
        })),
        wornColourway,
      };
    }));
  },

  /**
   * One theme's applicable payload — its tokens, its documents, its stylesheet.
   *
   * The row already holds everything an activation would replay, which is what lets
   * a viewer wear a theme without it being installed over the site's own.
   * ⚠ Returns null for a theme that is not installed, and the callers treat that as
   * "no such choice" rather than an error: a cookie can name a theme that has since
   * been uninstalled, and a visitor holding a stale one must simply see the site.
   */
  async getThemePayload(id: string): Promise<{
    tokens?: unknown; documents?: Record<string, unknown>; customCss?: unknown;
  } | null> {
    const row = await prisma.theme.findUnique({ where: { id }, select: { payload: true } });
    if (!row) return null;
    return (row.payload ?? {}) as {
      tokens?: unknown; documents?: Record<string, unknown>; customCss?: unknown;
    };
  },

  /**
   * One theme as the Themes page draws it: its colours, its colourways and which it
   * wears, and when it was last edited. For Core too (`''`).
   */
  async summarize(key: ThemeKey): Promise<ThemeSummary> {
    const global = (await appearanceService.getEffectiveTokens(key)).global ?? {};
    const colourways = await appearanceService.getColourways(key);
    const suffix = key ? `@${key}` : null;
    const [history, layout, setting] = await Promise.all([
      prisma.styleHistory.findFirst({ where: { themeKey: key }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      prisma.layout.findFirst({ where: { themeKey: key }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
      prisma.setting.findFirst({
        // An installed theme's edits are the settings suffixed with its id. Core's are
        // unsuffixed — and so are site-wide keys a SWITCH writes (which theme is live,
        // the undo point), so Core counts only its colours, custom CSS and fonts.
        where: suffix
          ? { key: { endsWith: suffix } }
          : {
              OR: ["appearance.tokens", "appearance.custom_css", "appearance.font."].map((p) => ({ key: { startsWith: p } })),
              NOT: { key: { contains: "@" } },
            },
        orderBy: { updatedAt: "desc" }, select: { updatedAt: true },
      }),
    ]);
    const times = [history?.createdAt, layout?.updatedAt, setting?.updatedAt].filter((d): d is Date => !!d);
    return {
      key,
      palette: paletteOf(global),
      colourways: colourways.map((c) => {
        const worn = { ...global, ...c.tokens };
        return { id: c.id, name: c.name, accent: resolveToken("--c-accent", worn), accent2: resolveToken("--c-accent2", worn) };
      }),
      wornColourway: colourways.find((c) => wears(c.tokens, global))?.id ?? null,
      editedAt: times.length ? new Date(Math.max(...times.map((d) => d.getTime()))).toISOString() : null,
    };
  },

  /** A theme by its name and, when it wears one, its colourway: "Aurora · Mint". */
  async labelOf(key: ThemeKey, fallbackName?: string | null): Promise<string> {
    const row = key ? await prisma.theme.findUnique({ where: { id: key }, select: { name: true } }) : null;
    const name = row?.name ?? fallbackName ?? "Core";
    const { colourways, wornColourway } = await this.summarize(key);
    const cw = colourways.find((c) => c.id === wornColourway);
    return cw ? `${name} · ${cw.name}` : name;
  },

  /**
   * Make one of a theme's colourways the one it wears — LIVE, like a theme switch, and
   * undoable the same way. Writes only the tokens the colourway sets: a token equal to
   * what the theme ships clears the admin's override instead of storing a copy.
   */
  async applyColourway(key: ThemeKey, colourwayId: string, userId: string) {
    const cw = (await appearanceService.getColourways(key)).find((c) => c.id === colourwayId);
    if (!cw) {
      throw new XentiumError({ code: XEC.API_NOT_FOUND, httpStatus: 404, message: `This theme has no colourway "${colourwayId}".` });
    }
    const shipped = (await appearanceService.getThemeTokens(key)).global ?? {};
    const patch = Object.fromEntries(Object.entries(cw.tokens).map(([k, v]) => [k, shipped[k] === v ? null : v]));
    return appearanceService.patchLiveScope("global", patch, userId, `Colourway: ${cw.name}`, key);
  },

  /** Make a colourway of the LIVE theme live. One level of undo, like a switch. */
  async wearColourway(colourwayId: string, userId: string) {
    const key = await activeThemeKey();
    const replaced = await this.labelOf(key);
    const before = await this.applyColourway(key, colourwayId, userId);
    await appearanceService.saveThemeRollback({
      previous: key, replaced, at: new Date().toISOString(), tokens: { key, ...before },
    });
    return this.summarize(key);
  },

  async listThemes() {
    const rows = await prisma.theme.findMany({
      orderBy: [{ active: "desc" }, { installedAt: "desc" }],
      // ⚠ NOT `payload`. It carries every layout document of every installed theme
      // and this feeds a list; the ACP needs the manifest and nothing more.
      select: {
        id: true, name: true, version: true, vendor: true, manifest: true,
        active: true, installedAt: true, activatedAt: true,
      },
    });
    return rows.map((r) => ({
      ...r,
      installedAt: r.installedAt.toISOString(),
      activatedAt: r.activatedAt?.toISOString() ?? null,
      screenshot:  (r.manifest as Record<string, unknown> | null)?.screenshot ?? null,
    }));
  },

  /**
   * Switch to a theme already in the library — or to Core, with `''`.
   *
   * LIVE and one decision, with one level of undo: the theme that was live before.
   */
  async activateTheme(id: ThemeKey, userId: string, colourway?: string) {
    const row = id ? await prisma.theme.findUnique({ where: { id } }) : null;
    if (id && !row) {
      throw new XentiumError({
        code: XEC.API_NOT_FOUND, httpStatus: 404,
        message: `No theme "${id}" is installed here.`,
      });
    }
    const previous = await activeThemeKey();
    const worn = await appearanceService.getInstalledTheme();
    const replaced = await this.labelOf(previous, worn ? String(worn.name ?? worn.id ?? "") : null);
    // Switching straight into one of the theme's colourways: its colours change too,
    // so undo has to put those back as well as the theme.
    const current = colourway ? (await this.summarize(id)).wornColourway : null;
    const before = colourway && colourway !== current ? await this.applyColourway(id, colourway, userId) : null;
    if (previous !== id || before) {
      await appearanceService.saveThemeRollback({
        previous,
        replaced,
        at:       new Date().toISOString(),
        ...(before ? { tokens: { key: id, ...before } } : {}),
      });
    }
    await this.setActive(id);
    // The theme's own pages are what now shows — every theme carries its own edits, so
    // nothing of the previous theme's is kept or replaced.
    const shipped = Object.keys(((row?.payload ?? {}) as { documents?: Record<string, unknown> }).documents ?? {});
    return {
      id, name: row?.name ?? "Core", version: row?.version ?? "",
      applied: shipped, kept: [] as string[],
      replaced: worn ? { id: String(worn.id ?? ""), name: String(worn.name ?? ""), version: String(worn.version ?? "") } : null,
    };
  },

  /**
   * Remove a theme from the library.
   *
   * ⚠ Refuses the ACTIVE one. Deleting the row would leave the site wearing a theme
   * with no record of where it came from, no baseline for "Revert to theme", and no
   * way back — the exact state the library exists to prevent. Switch first.
   *
   * Assets go too: nothing else references `uploads/themes/<id>/` once the row is
   * gone, and leaving them means an admin who uninstalls a theme has no way to
   * reclaim the space.
   */
  async uninstallTheme(id: string): Promise<void> {
    const row = await prisma.theme.findUnique({ where: { id }, select: { active: true } });
    if (!row) return;
    // Removing the live theme falls back to Core — the site is never without one.
    if (row.active) await this.setActive(CORE_THEME);
    // Its own edits go with it: they were made for this theme and nothing else.
    await layoutService.forgetTheme(id);
    await appearanceService.forgetTheme(id);
    const rollback = await appearanceService.getThemeRollback();
    if (rollback?.update?.themeId === id || rollback?.previous === id) await appearanceService.clearThemeRollback();
    await prisma.theme.delete({ where: { id } });
    bustThemeCss(id);
    bustThemeLayouts(id);
    await rm(path.join(env.UPLOAD_DIR, "themes", id), { recursive: true, force: true }).catch(() => {});
  },
};

/** A theme in the form that can be APPLIED: asset references already rewritten to
 *  this install's upload paths. Stored in the library so a switch needs no package. */
export interface ThemePayload {
  documents: Record<string, LayoutDocument>;
  tokens:    ScopedTokenSet | null;
  customCss: string | null;
  /** Absent on payloads stored before frames existed — read as "ships none". */
  frame?:    SiteFrame | null;
}
