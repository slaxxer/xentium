/**
 * Custom CSS that arrives inside a `.nvtheme`.
 *
 * The console's CSS is written by an admin — the same person who can change anything
 * else about the site — so it is checked for parseability and otherwise left alone. A
 * theme's CSS is not that. Once themes are downloaded from a marketplace it is a
 * stranger's code running on every page of your site, and two things separate it from
 * the console:
 *
 *  - **It may not reach off-site.** `@import` fetches a stylesheet from wherever it
 *    points, and a remote `url()` is a request the browser makes with the visitor's IP
 *    on it — and, through attribute selectors (`input[value^="a"] { background: url(…) }`),
 *    a way to leak what is on the page one character at a time. A theme carries its
 *    assets inside the package, so it never needs either.
 *  - **Its asset references have to be rewritten**, exactly as a layout document's are.
 *    `url(assets/hero.png)` means nothing on the importing site: the stylesheet is served
 *    from `/api/appearance/css`, so a package-relative path resolves against THAT and
 *    404s. This was simply missing — theme CSS was stored raw — so every image a theme
 *    shipped through its stylesheet was broken.
 *
 * What is NOT claimed here: this does not make a stranger's CSS harmless. CSS can still
 * lay a fixed-position element over a button or restyle a control into something it is
 * not. That is a UI-redressing risk, and the answer to it is the draft — a theme's CSS
 * now stages with its tokens and layouts, so an admin sees the site before a visitor
 * does. This module closes the holes that staging cannot: the ones that fire on import
 * or reach another server.
 */
import postcss from "postcss";
import { NodevoError } from "../../shared/errors/NodevoError.js";
import { NEC } from "../../shared/errors/nec.js";

/** Same code as the rest of the theme module: a package refused for a nameable reason. */
const cssError = (message: string) =>
  new NodevoError({ code: NEC.CORE_THEME_INVALID, httpStatus: 422, message });

/** Where an imported theme's files are served from. */
const UPLOADS_PREFIX = "/uploads/";

/**
 * Every `url()` in a declaration value, quoted or not.
 *
 * Deliberately a scan of declaration values rather than a full value parser: `url()`
 * appears in `background`, `src`, `image-set()`, `mask`, `cursor` and anywhere else a
 * property takes an image, and none of those need to be understood — only the
 * references inside them do.
 */
const URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]*))\s*\)/gi;

const urlValue = (m: RegExpMatchArray): string => (m[1] ?? m[2] ?? m[3] ?? "").trim();

/** `map: false` — never let a sourceMappingURL comment make postcss read a file off disk. */
const PARSE_OPTS = { map: false } as const;

function parse(css: string, file: string): postcss.Root {
  try {
    return postcss.parse(css, PARSE_OPTS);
  } catch (err) {
    throw cssError(`${file} has a syntax error: ${err instanceof Error ? err.message : "invalid CSS"}`);
  }
}

/** Walk every `url()` in every declaration, including ones nested in at-rules. */
function eachUrl(root: postcss.Root, fn: (ref: string) => void): void {
  root.walkDecls((decl) => {
    for (const m of decl.value.matchAll(URL_RE)) fn(urlValue(m));
  });
}

const isRemote = (ref: string) => /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(ref);
const isData   = (ref: string) => /^data:/i.test(ref);

/**
 * Refuse everything about a theme's stylesheet that cannot be made safe by staging.
 *
 * Runs in the import's VALIDATION pass, before anything is written — which is why it
 * takes the package's asset names rather than the paths they will be saved to: those do
 * not exist yet, and a package that would fail here must fail before it has written a
 * single file.
 */
export function assertThemeCssSafe(css: string, file: string, packAssets: ReadonlySet<string>): void {
  if (!css.trim()) return;
  const root = parse(css, file);

  root.walkAtRules("import", () => {
    throw cssError(
      `${file} uses @import, which is not allowed in a theme. It fetches a stylesheet ` +
      `from another server at render time; put the rules in this file instead.`,
    );
  });

  eachUrl(root, (ref) => {
    if (!ref || isData(ref)) return;
    if (isRemote(ref)) {
      throw cssError(
        `${file} references ${ref}. A theme may not load files from another server — ` +
        `ship the file in assets/ and reference it as assets/<file>.`,
      );
    }
    // Site-absolute: same origin, so it cannot reach off-site, and it is the only way
    // a theme can legitimately point at a file the site already has.
    if (ref.startsWith("/")) return;
    if (!packAssets.has(ref)) {
      throw cssError(
        `${file} references ${ref}, which the package does not carry. ` +
        `Add it under assets/ or remove the reference.`,
      );
    }
  });
}

/**
 * Package-relative references → where this install actually stored the files.
 *
 * Runs in the WRITE pass, after assets are on disk. It cannot fail: every reference it
 * will meet was already accepted by `assertThemeCssSafe`, and anything it does not have
 * a mapping for is left exactly as authored.
 *
 * `map` yields the stored upload path (`themes/<id>/hero.png`); CSS needs a URL the
 * browser can fetch, so `/uploads/` goes on here. A layout document stores the bare path
 * instead, because its renderer adds the prefix — the two differ for that reason alone.
 */
export function rewriteThemeCssUrls(css: string, map: (ref: string) => string | undefined): string {
  if (!css.trim()) return css;
  return css.replace(URL_RE, (whole, dq?: string, sq?: string, bare?: string) => {
    const ref = (dq ?? sq ?? bare ?? "").trim();
    if (!ref || isData(ref) || isRemote(ref) || ref.startsWith("/")) return whole;
    const stored = map(ref);
    return stored ? `url("${UPLOADS_PREFIX}${stored}")` : whole;
  });
}

/** Every upload path a stylesheet references, for an export to copy into the package. */
export function collectCssUploadRefs(css: string): string[] {
  const out = new Set<string>();
  if (!css.trim()) return [];
  for (const m of css.matchAll(URL_RE)) {
    const ref = urlValue(m);
    if (ref.startsWith(UPLOADS_PREFIX)) out.add(ref.slice(UPLOADS_PREFIX.length));
  }
  return [...out];
}

/**
 * The inverse of `rewriteThemeCssUrls`, for export.
 *
 * Without it, exporting a site that has a theme installed produces a package whose CSS
 * points at `/uploads/themes/<the source site's id>/…` — which is a broken image
 * everywhere else, and which the importer would now refuse outright as a file the
 * package does not carry. The reference travels; the file has to travel with it.
 */
export function toPackageCssUrls(css: string, map: (uploadPath: string) => string | undefined): string {
  if (!css.trim()) return css;
  return css.replace(URL_RE, (whole, dq?: string, sq?: string, bare?: string) => {
    const ref = (dq ?? sq ?? bare ?? "").trim();
    if (!ref.startsWith(UPLOADS_PREFIX)) return whole;
    const packName = map(ref.slice(UPLOADS_PREFIX.length));
    return packName ? `url("${packName}")` : whole;
  });
}
