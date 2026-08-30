/**
 * `.nvtheme` export / import (ADR-0005, step 5).
 *
 * A theme is DATA: layout documents plus token overrides plus assets. There is no
 * executable code in the package, so importing one cannot run anything — review
 * is reading JSON and a `:root`-only stylesheet. Code extension goes through
 * plugins, which is a separate, trusted path.
 *
 * The package is a strict superset of `.nvstyle`: same `styles/light.css` and
 * `styles/dark.css` under the same `:root`-only rule, plus a `layouts/` folder.
 * A `.nvstyle` is simply a theme with no layouts — and since 2026-08-15 that is not
 * just a resemblance: `.nvstyle` was ABSORBED, its separate upload endpoint and its
 * parallel `:root` validator deleted, and this importer takes both shapes
 * (`adoptStylePack`). Export with `tokensOnly` to produce the palette-only kind.
 *
 * An import lands in the DRAFT, never live. A theme changes every page at once,
 * which is precisely the change an admin should preview before committing —
 * publishing stays a separate, deliberate act.
 */
import AdmZip from "adm-zip";
import fs from "node:fs/promises";
import path from "node:path";
import { fileTypeFromBuffer } from "file-type";
import {
  DEFAULT_VARIANT,
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
  scopedTokenSetSchema,
  type ThemeManifest,
  layoutDocumentSchema,
  missingRequiredBlocks,
  requiredBlocksFor,
  regionsFor,
  validateBlockTree,
  type LayoutDocument,
} from "@nodevo/contracts";
import { env } from "../../config/env.js";
import { storage } from "../../infrastructure/storage/LocalStorageProvider.js";
import { NodevoError } from "../../shared/errors/NodevoError.js";
import { NEC } from "../../shared/errors/nec.js";
import { NODEVO_VERSION, compareBaseVersions } from "../../config/version.js";
import { appearanceService, type ScopedTokenSet, type TokenMap } from "../appearance/appearance.service.js";
import { layoutService } from "../layouts/layout.service.js";
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
 * Its OWN code, not the generic `API_VALIDATION`: the web client resolves a NEC code to
 * a localized string when one exists, and `NEC-API-4001` has one — "Please check your
 * input and try again." — which replaced messages like "layouts/home.json declares
 * template \"profile\"" with something an admin cannot act on. A package is rejected for
 * a specific, nameable reason, and that reason is the whole value of the response.
 */
const themeError = (message: string) =>
  new NodevoError({ code: NEC.CORE_THEME_INVALID, httpStatus: 422, message });

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

/** `:root`-only custom properties, the same rule `.nvstyle` enforces. */
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
 * Let a `.nvstyle` in through the theme importer.
 *
 * The two formats were never siblings: `.nvstyle` is `manifest.json` +
 * `styles/light.css` + `styles/dark.css`, which is a strict SUBSET of what a theme
 * carries — the docblock at the top of this file has claimed as much since the format
 * was written. What actually differed was the manifest: a theme requires `id`,
 * `vendor`, `version` and `minNodevoVersion`; a style pack required only `name`. So
 * the superset claim was true of the files and false of the paperwork, and a `.nvstyle`
 * would have been rejected here.
 *
 * The missing fields are filled in, and ONLY for a package that is unmistakably a style
 * pack: no `layouts/`, no `tokens.json`, and a stylesheet present. A real theme with a
 * malformed manifest still gets the strict error it deserves, rather than being quietly
 * given an invented id.
 *
 * `id` is derived from the name so two different packs do not collide on one row, and
 * `minNodevoVersion` is THIS version because a style pack never declared compatibility
 * and refusing it on a field it could not have set would be nonsense.
 */
function adoptStylePack(raw: unknown, zip: AdmZip): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const m = raw as Record<string, unknown>;

  // Already a theme manifest — nothing to adopt.
  if (m.id && m.vendor && m.version && m.minNodevoVersion) return raw;

  const hasThemeParts = zip.getEntries().some((e) =>
    e.entryName.startsWith(THEME_PATHS.layouts) || e.entryName === THEME_PATHS.tokens);
  const hasStyles = !!zip.getEntry(THEME_PATHS.cssLight) || !!zip.getEntry(THEME_PATHS.cssDark);
  if (hasThemeParts || !hasStyles) return raw;

  const name = typeof m.name === "string" && m.name.trim() ? m.name.trim() : "Imported style";
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  return {
    ...m,
    name,
    id:      m.id      ?? (slug || "imported-style"),
    vendor:  m.vendor  ?? "community",
    version: m.version ?? "1.0.0",
    minNodevoVersion: m.minNodevoVersion ?? NODEVO_VERSION,
  };
}

function assertCompatible(m: ThemeManifestInput) {
  if (compareBaseVersions(NODEVO_VERSION, m.minNodevoVersion) < 0) {
    throw themeError(`Theme "${m.id}" requires Nodevo ${m.minNodevoVersion}+ (this is ${NODEVO_VERSION})`);
  }
  if (m.maxNodevoVersion && compareBaseVersions(NODEVO_VERSION, m.maxNodevoVersion) > 0) {
    throw themeError(`Theme "${m.id}" supports Nodevo up to ${m.maxNodevoVersion} (this is ${NODEVO_VERSION})`);
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
  tokensApplied: boolean;
  /** Staged in the theme's own CSS layer, under the admin's stylesheet, like everything
   *  else in the package. It used to overwrite the admin's CSS outright, and live. */
  customCssApplied: boolean;
  assetsImported: number;
  /** Non-fatal: blocks the package references that this install cannot render.
   *  They are kept in the document so enabling the plugin later restores them. */
  unknownBlocks: string[];
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
 * really the theme I asked for?" the way it already asks a `.nvplugin` — the
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
    throw themeError("Not a readable .nvtheme archive");
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

export const themeService = {
  /** What this package claims to be. The download gate's check, and nothing more —
   *  a package that passes here can still be refused by the full import. */
  validateOnly(fileBuffer: Buffer): ThemeManifestInput {
    return readManifest(fileBuffer).manifest;
  },

  /**
   * Build a `.nvtheme` from what is currently PUBLISHED — the site as visitors
   * see it, not a half-finished draft.
   */
  async exportTheme(
    meta: Pick<ThemeManifestInput, "id" | "name" | "version" | "vendor" | "description"
      | "license" | "homepage" | "authorUrl">,
    opts: { tokensOnly?: boolean; screenshot?: Buffer } = {},
  ): Promise<Buffer> {
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

    const manifest: ThemeManifestInput = themeManifestSchema.parse({
      ...meta,
      minNodevoVersion: NODEVO_VERSION,
      schemaVersion:    LAYOUT_SCHEMA_VERSION,
      packageVersion:   THEME_PACKAGE_VERSION,
      ...(screenshotName ? { screenshot: `${THEME_PATHS.assets}${screenshotName}` } : {}),
    });

    const [layouts, tokens, customCss] = await Promise.all([
      layoutService.getPublishedAll(),
      // EFFECTIVE, not just the admin layer: an export is "the site as visitors see it",
      // and on a site with a theme installed most of the look lives in the theme layer.
      // Exporting the admin layer alone would produce a package that is only the diff.
      appearanceService.getEffectiveTokens(),
      // EFFECTIVE, for the same reason the tokens above are: an export is "the site as
      // visitors see it", and on a site running a theme most of the stylesheet is the
      // theme's. Exporting the admin layer alone would drop it silently.
      (async () => {
        const [admin, theme] = await Promise.all([
          appearanceService.getCustomCss(),
          appearanceService.getThemeCustomCss(),
        ]);
        return {
          light: [theme.light, admin.light].filter((c) => c.trim()).join("\n\n"),
          dark:  [theme.dark,  admin.dark ].filter((c) => c.trim()).join("\n\n"),
        };
      })(),
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
    // A TOKENS-ONLY package: the palette and nothing else — what `.nvstyle` was for,
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

    // ── Tokens ────────────────────────────────────────────────────────────
    // `tokens.json` is the lossless one: the FULL scoped set, including the region
    // scopes (ADR-0003) that the two CSS files cannot express and that this export
    // silently dropped before. The CSS files stay so a `.nvtheme` remains a strict
    // `.nvstyle` superset, and an importer prefers the JSON when both are present.
    zip.addFile(THEME_PATHS.tokens, Buffer.from(JSON.stringify(tokens, null, 2), "utf8"));
    zip.addFile(THEME_PATHS.cssLight, Buffer.from(renderTokens(tokens.light?.global ?? {}), "utf8"));
    zip.addFile(THEME_PATHS.cssDark,  Buffer.from(renderTokens(tokens.dark?.global  ?? {}), "utf8"));

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

    const packedLight = await packCss(customCss.light);
    const packedDark  = await packCss(customCss.dark);
    if (packedLight.trim()) {
      zip.addFile(THEME_PATHS.customLight, Buffer.from(packedLight, "utf8"));
    }
    if (packedDark.trim()) {
      zip.addFile(THEME_PATHS.customDark, Buffer.from(packedDark, "utf8"));
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
   * Accepts a `.nvstyle` too — see `adoptStylePack`. One ingestion path for both,
   * which is the point of having merged them.
   */
  async importTheme(fileBuffer: Buffer, userId: string): Promise<ImportReport> {
    const { zip, manifest } = readManifest(fileBuffer);
    assertCompatible(manifest);
    const previous = await appearanceService.getInstalledTheme();

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

    // ── Tokens ────────────────────────────────────────────────────────────
    // `tokens.json` wins when present: it is the only file that can express the region
    // scopes. The CSS pair remains the fallback, which is what a hand-written
    // `.nvstyle` ships and all this format could read before.
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
      const parsed = scopedTokenSetSchema.safeParse(json);
      if (!parsed.success) {
        throw themeError(`${THEME_PATHS.tokens} is invalid: ${issueList(parsed.error)}`);
      }
      tokens = parsed.data;
    } else {
      const lightEntry = zip.getEntry(THEME_PATHS.cssLight);
      const darkEntry  = zip.getEntry(THEME_PATHS.cssDark);
      if (lightEntry || darkEntry) {
        const lightCss = lightEntry ? readText(lightEntry, THEME_PATHS.cssLight) : "";
        const darkCss  = darkEntry  ? readText(darkEntry,  THEME_PATHS.cssDark)  : "";
        assertTokenCss(lightCss, THEME_PATHS.cssLight);
        assertTokenCss(darkCss,  THEME_PATHS.cssDark);
        tokens = { light: { global: parseTokens(lightCss) }, dark: { global: parseTokens(darkCss) } };
      }
    }

    // ── Custom CSS ────────────────────────────────────────────────────────
    // Not `:root`-restricted — this is the escape hatch, and it is scoped by the
    // importing site the same way the console's own CSS is. Parsed here so a syntax
    // error is caught in this pass instead of by `saveCustomCss` mid-write.
    const readCss = (p: string) => {
      const entry = zip.getEntry(p);
      return entry ? readText(entry, p) : "";
    };
    const customCss = { light: readCss(THEME_PATHS.customLight), dark: readCss(THEME_PATHS.customDark) };
    const hasCustomCss = !!(customCss.light.trim() || customCss.dark.trim());

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
    assertThemeCssSafe(customCss.light, THEME_PATHS.customLight, packAssets);
    assertThemeCssSafe(customCss.dark,  THEME_PATHS.customDark,  packAssets);

    if (Object.keys(documents).length === 0 && !tokens && !hasCustomCss) {
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
     * Inheritance (the fifth gap). Ownership is read BEFORE anything is written, because
     * writing the new baseline is itself what would make a customised template look
     * untouched.
     */
    const ownership = await layoutService.getOwnership();
    const applied: string[] = [];
    const kept: string[] = [];

    for (const [key, doc] of Object.entries(documents)) {
      if (!doc) continue;
      // A package-relative `assets/hero.jpg` becomes this install's upload path. An
      // absolute URL, or a path this package does not carry, is left untouched — a
      // theme may still point at a CDN.
      rewriteAssetRefs(doc, (ref) => assetPaths.get(ref));

      // The baseline is recorded either way: it is what the NEXT update compares
      // against, and what "Revert to theme" restores.
      await layoutService.saveThemeLayer(key, doc, userId);

      if (ownership[key]?.customised) {
        kept.push(key);
        continue;
      }
      // Template default, never a variant — see the export note above.
      await layoutService.saveDraft({ templateKey: key, variant: DEFAULT_VARIANT }, doc, userId);
      applied.push(key);
    }

    /**
     * Tokens go to the THEME layer, not the admin's draft.
     *
     * That is token-level inheritance: the served stylesheet is the theme merged under
     * the admin's own overrides, so an admin who recoloured one accent keeps exactly that
     * and takes everything else the update brings. Importing into the admin layer — which
     * this used to do — made the first update overwrite every tweak.
     */
    if (tokens) await appearanceService.saveThemeTokens(tokens);

    const replaced = previous
      ? { id: String(previous.id ?? ""), name: String(previous.name ?? ""), version: String(previous.version ?? "") }
      : null;

    /**
     * The stored manifest points at where the preview image actually landed, not at
     * where it sat inside the zip.
     *
     * ⚠ Deliberate asymmetry: in a PACKAGE `screenshot` is package-relative
     * (`assets/screenshot.png`), and in the INSTALLED record it is this install's
     * upload path — the same rewrite a document's image reference gets three
     * paragraphs up, and for the same reason. Anything reading the installed theme is
     * about to render the image, and `assets/screenshot.png` resolves to nothing.
     * A package that names a file it does not carry keeps its value untouched rather
     * than being blanked: it may be pointing at a CDN, which is the one case where the
     * author's own path is still the right one.
     */
    const shot = manifest.screenshot ? assetPaths.get(manifest.screenshot) : undefined;
    const installedManifest = { ...manifest, ...(shot ? { screenshot: shot } : {}) };
    await appearanceService.setInstalledTheme(installedManifest as unknown as Record<string, unknown>);

    /**
     * The stylesheet goes to the THEME layer, staged — the same treatment as the tokens
     * three lines up, and for the same reason.
     *
     * It used to call `saveCustomCss`, which is the ADMIN's stylesheet: importing a
     * theme destroyed whatever CSS the admin had written, with no baseline recorded and
     * nowhere to recover it from. A package carrying only a light stylesheet blanked
     * their dark one too, since both keys were always written together.
     *
     * `url(assets/…)` is rewritten to where the assets actually landed. Nothing did this
     * before, so every image a theme shipped through its stylesheet resolved against
     * `/api/appearance/css` and 404'd.
     */
    if (hasCustomCss) {
      const rewrite = (css: string) => rewriteThemeCssUrls(css, (ref) => assetPaths.get(ref));
      await appearanceService.saveThemeCustomCss({
        light: rewrite(customCss.light),
        dark:  rewrite(customCss.dark),
      });
    }

    return {
      manifest,
      templates: applied,
      unknownTemplates,
      kept,
      replaced,
      tokensApplied: !!tokens,
      customCssApplied: hasCustomCss,
      assetsImported: assets.length,
      unknownBlocks: [...unknownBlocks],
    };
  },
};
