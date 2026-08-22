/**
 * `.nvtheme` export / import.
 *
 * The thing worth testing is the ROUND TRIP: a package built on one install has to
 * produce the same look on another, and the only part of a layout document that does
 * not travel by itself is an image. An asset reference is a path into `uploads/`, which
 * means nothing on the machine that receives it — so export copies the bytes in and
 * rewrites the reference, and import unpacks them and rewrites it again. Assert both
 * halves, or a theme silently arrives with broken images.
 *
 * The two services are mocked because none of the above is about the database, and
 * `UPLOAD_DIR` is repointed at a temp directory BEFORE the storage provider is imported
 * (it resolves its base once, at module load).
 */
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LAYOUTS,
  THEME_ASSET_LIMITS,
  deregisterTemplatesFor,
  registerTemplate,
  THEME_PATHS,
  type BlockNode,
  type LayoutDocument,
  type CoreTemplateKey,
  type TemplateKey,
} from "@nodevo/contracts";

const UPLOAD_DIR = fsSync.mkdtempSync(path.join(os.tmpdir(), "nv-theme-"));
process.env.UPLOAD_DIR = UPLOAD_DIR;
afterAll(async () => { await fs.rm(UPLOAD_DIR, { recursive: true, force: true }); });

// ── Stand-ins for the two stores ─────────────────────────────────────────────

type Scoped = Record<string, Record<string, string>>;

const published = { templates: {} as Record<TemplateKey, LayoutDocument>, variants: {} };
const savedDrafts = new Map<string, LayoutDocument>();
/** The inheritance layer: what the installed theme ships, per template. */
const themeLayer = new Map<TemplateKey, LayoutDocument>();
/** Which templates the admin has moved away from their baseline. */
const customised = new Set<TemplateKey>();

const appearance = {
  effective: { light: {} as Scoped, dark: {} as Scoped },
  customCss: { light: "", dark: "" },
  installed: null as Record<string, unknown> | null,
  savedThemeTokens: null as unknown,
  savedCustomCss: null as unknown,
  savedInstalled: null as Record<string, unknown> | null,
};

vi.mock("../layouts/layout.service.js", () => ({
  layoutService: {
    getPublishedAll: async () => published,
    saveDraft: async (
      sel: { templateKey: TemplateKey; variant: string }, doc: LayoutDocument,
    ) => { savedDrafts.set(`${sel.templateKey}|${sel.variant}`, doc); return doc; },
    saveThemeLayer: async (key: TemplateKey, doc: LayoutDocument) => { themeLayer.set(key, doc); },
    getThemeLayer: async () => Object.fromEntries(themeLayer),
    getOwnership: async () => Object.fromEntries(
      (Object.keys(DEFAULT_LAYOUTS) as TemplateKey[]).map((k) => [
        k, { customised: customised.has(k), hasTheme: themeLayer.has(k) },
      ]),
    ),
  },
}));

vi.mock("../appearance/appearance.service.js", () => ({
  appearanceService: {
    getEffectiveTokens: async () => appearance.effective,
    getCustomCss:       async () => appearance.customCss,
    getInstalledTheme:  async () => appearance.installed,
    saveThemeTokens:    async (t: unknown) => { appearance.savedThemeTokens = t; },
    saveCustomCss:      async (c: unknown) => { appearance.savedCustomCss = c; },
    setInstalledTheme:  async (m: Record<string, unknown>) => { appearance.savedInstalled = m; },
  },
}));

const { themeService } = await import("./theme.service.js");

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** A real 1×1 PNG: the point is that `file-type` sniffs it, so it must be genuine. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const META = { id: "round-trip", name: "Round trip", version: "1.0.0", vendor: "Tester" };

/** A home layout whose hero points at an uploaded image. */
function homeWithHero(image: string): LayoutDocument {
  const doc = structuredClone(DEFAULT_LAYOUTS.home) as LayoutDocument;
  const find = (nodes: BlockNode[]): BlockNode | undefined => {
    for (const n of nodes) {
      if (n.type === "guestHero") return n;
      const hit = n.children && find(n.children);
      if (hit) return hit;
    }
    return undefined;
  };
  const hero = find(Object.values(doc.regions).flat());
  if (!hero) throw new Error("the shipped home default no longer has a guestHero");
  hero.props = { ...hero.props, backgroundImage: image };
  return doc;
}

beforeEach(async () => {
  for (const key of Object.keys(DEFAULT_LAYOUTS) as CoreTemplateKey[]) {
    published.templates[key] = structuredClone(DEFAULT_LAYOUTS[key]) as LayoutDocument;
  }
  savedDrafts.clear();
  themeLayer.clear();
  customised.clear();
  appearance.effective = { light: { global: {} }, dark: { global: {} } };
  appearance.customCss = { light: "", dark: "" };
  appearance.installed = null;
  appearance.savedThemeTokens = null;
  appearance.savedCustomCss = null;
  appearance.savedInstalled = null;
  await fs.rm(path.join(UPLOAD_DIR, "themes"), { recursive: true, force: true });
});

const write = async (rel: string, data: Buffer) => {
  await fs.mkdir(path.join(UPLOAD_DIR, path.dirname(rel)), { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, rel), data);
};

const heroImageOf = (doc: LayoutDocument): string | undefined => {
  const walk = (nodes: BlockNode[]): string | undefined => {
    for (const n of nodes) {
      if (n.type === "guestHero") return (n.props as { backgroundImage?: string }).backgroundImage;
      const hit = n.children && walk(n.children);
      if (hit !== undefined) return hit;
    }
    return undefined;
  };
  return walk(Object.values(doc.regions).flat());
};

// ── Export ───────────────────────────────────────────────────────────────────

describe("export", () => {
  it("copies a referenced image into the package and rewrites the reference", async () => {
    await write("pages/hero.png", PNG);
    published.templates.home = homeWithHero("pages/hero.png");

    const zip = new AdmZip(await themeService.exportTheme(META));
    expect(zip.getEntry(`${THEME_PATHS.assets}hero.png`)?.getData()).toEqual(PNG);

    const doc = JSON.parse(zip.getEntry(`${THEME_PATHS.layouts}home.json`)!.getData().toString());
    // The reference now names the package, not this machine's uploads directory.
    expect(heroImageOf(doc)).toBe("assets/hero.png");
  });

  it("leaves an absolute URL alone — a theme may point at a CDN", async () => {
    published.templates.home = homeWithHero("https://cdn.example.com/a.png");
    const zip = new AdmZip(await themeService.exportTheme(META));
    const doc = JSON.parse(zip.getEntry(`${THEME_PATHS.layouts}home.json`)!.getData().toString());
    expect(heroImageOf(doc)).toBe("https://cdn.example.com/a.png");
    expect(zip.getEntries().filter((e) => e.entryName.startsWith("assets/"))).toHaveLength(0);
  });

  it("keeps a reference whose file is gone, rather than failing the export", async () => {
    published.templates.home = homeWithHero("pages/missing.png");
    const zip = new AdmZip(await themeService.exportTheme(META));
    const doc = JSON.parse(zip.getEntry(`${THEME_PATHS.layouts}home.json`)!.getData().toString());
    expect(heroImageOf(doc)).toBe("pages/missing.png");
  });

  it("refuses to read outside the uploads directory", async () => {
    published.templates.home = homeWithHero("../../../etc/passwd");
    const zip = new AdmZip(await themeService.exportTheme(META));
    expect(zip.getEntries().filter((e) => e.entryName.startsWith("assets/"))).toHaveLength(0);
  });

  it("carries the scoped tokens the CSS files cannot express", async () => {
    appearance.effective = {
      light: { global: { "--c-bg": "#fff" }, "chrome.header": { "--c-bg": "#111" } },
      dark:  { global: { "--c-bg": "#000" } },
    };
    const zip = new AdmZip(await themeService.exportTheme(META));

    const tokens = JSON.parse(zip.getEntry(THEME_PATHS.tokens)!.getData().toString());
    expect(tokens.light["chrome.header"]["--c-bg"]).toBe("#111");
    // `:root` CSS can only hold the global scope; it stays for `.nvstyle` readers.
    const css = zip.getEntry(THEME_PATHS.cssLight)!.getData().toString();
    expect(css).toContain("--c-bg: #fff;");
    expect(css).not.toContain("#111");
  });

  it("carries custom CSS, and omits the files when there is none", async () => {
    const zip1 = new AdmZip(await themeService.exportTheme(META));
    expect(zip1.getEntry(THEME_PATHS.customLight)).toBeNull();

    appearance.customCss = { light: ".x { color: red; }", dark: "" };
    const zip2 = new AdmZip(await themeService.exportTheme(META));
    expect(zip2.getEntry(THEME_PATHS.customLight)!.getData().toString()).toBe(".x { color: red; }");
    expect(zip2.getEntry(THEME_PATHS.customDark)).toBeNull();
  });

  it("records the distribution metadata a listing needs", async () => {
    const zip = new AdmZip(await themeService.exportTheme({
      ...META, license: "MIT", homepage: "https://example.com", authorUrl: "https://example.com/me",
    }));
    const manifest = JSON.parse(zip.getEntry(THEME_PATHS.manifest)!.getData().toString());
    expect(manifest).toMatchObject({ license: "MIT", homepage: "https://example.com", packageVersion: 1 });
  });
});

// ── Import ───────────────────────────────────────────────────────────────────

/** Build a package by hand — the shape a third party would ship. */
function pack(files: Record<string, string | Buffer>, manifest?: Record<string, unknown>): Buffer {
  const zip = new AdmZip();
  zip.addFile(THEME_PATHS.manifest, Buffer.from(JSON.stringify({
    ...META, minNodevoVersion: "1.0", ...manifest,
  })));
  for (const [name, body] of Object.entries(files)) {
    zip.addFile(name, typeof body === "string" ? Buffer.from(body) : body);
  }
  return zip.toBuffer();
}

describe("import", () => {
  it("round-trips an image: unpacks it and repoints the document at it", async () => {
    await write("pages/hero.png", PNG);
    published.templates.home = homeWithHero("pages/hero.png");
    const exported = await themeService.exportTheme(META);

    const report = await themeService.importTheme(exported, "user-1");
    expect(report.assetsImported).toBe(1);

    const stored = path.join(UPLOAD_DIR, "themes", META.id, "hero.png");
    expect(await fs.readFile(stored)).toEqual(PNG);

    const staged = savedDrafts.get("home|")!;
    // Not `assets/hero.png` any more, and not the exporting site's path either.
    expect(heroImageOf(staged)).toBe(`themes/${META.id}/hero.png`);
  });

  it("prefers tokens.json over the :root stylesheets", async () => {
    const buf = pack({
      [THEME_PATHS.tokens]: JSON.stringify({ light: { global: { "--c-bg": "#json" } }, dark: {} }),
      [THEME_PATHS.cssLight]: ":root { --c-bg: #css; }",
    });
    await themeService.importTheme(buf, "user-1");
    expect(appearance.savedThemeTokens).toMatchObject({ light: { global: { "--c-bg": "#json" } } });
  });

  it("falls back to the stylesheets when there is no tokens.json", async () => {
    await themeService.importTheme(pack({ [THEME_PATHS.cssLight]: ":root { --c-bg: #css; }" }), "user-1");
    expect(appearance.savedThemeTokens).toMatchObject({ light: { global: { "--c-bg": "#css" } } });
  });

  it("rejects a token value that could close the CSS block early", async () => {
    const buf = pack({
      [THEME_PATHS.tokens]: JSON.stringify({ light: { global: { "--x": "red } body { display:none" } }, dark: {} }),
    });
    await expect(themeService.importTheme(buf, "user-1")).rejects.toThrow(/tokens\.json is invalid/);
  });

  it("applies custom CSS live and says so", async () => {
    const report = await themeService.importTheme(
      pack({ [THEME_PATHS.customLight]: ".x { color: red; }" }), "user-1",
    );
    expect(report.customCssApplied).toBe(true);
    expect(appearance.savedCustomCss).toEqual({ light: ".x { color: red; }", dark: "" });
  });

  it("rejects custom CSS that does not parse, before anything is written", async () => {
    const buf = pack({
      [THEME_PATHS.customLight]: ".x { color: red;",
      [THEME_PATHS.tokens]: JSON.stringify({ light: { global: { "--c-bg": "#fff" } }, dark: {} }),
    });
    await expect(themeService.importTheme(buf, "user-1")).rejects.toThrow(/syntax error/);
    expect(appearance.savedThemeTokens).toBeNull();
  });

  it("refuses an asset that is not an image or a font, whatever it is called", async () => {
    const buf = pack({ [`${THEME_PATHS.assets}evil.png`]: "#!/bin/sh\nrm -rf /\n" });
    await expect(themeService.importTheme(buf, "user-1")).rejects.toThrow(/not an allowed image or font/);
  });

  it("cannot be made to write outside the uploads directory", async () => {
    // Two shapes of the same attack. `assets/../../escaped.png` never even reads as an
    // asset — adm-zip normalises it to `escaped.png`, which fails the `assets/` prefix —
    // and a legitimately nested name is flattened to its basename on the way in.
    const buf = pack({
      [`${THEME_PATHS.assets}../../escaped.png`]: PNG,
      [`${THEME_PATHS.assets}deep/dir/hero.png`]: PNG,
      // Assets alone are not a theme, so the package carries a token file too.
      [THEME_PATHS.tokens]: JSON.stringify({ light: { global: { "--c-bg": "#fff" } }, dark: {} }),
    });
    const report = await themeService.importTheme(buf, "user-1");

    expect(report.assetsImported).toBe(1);
    expect(fsSync.existsSync(path.join(UPLOAD_DIR, "themes", META.id, "hero.png"))).toBe(true);
    expect(fsSync.existsSync(path.resolve(UPLOAD_DIR, "..", "..", "escaped.png"))).toBe(false);
    expect(fsSync.existsSync(path.join(UPLOAD_DIR, "themes", META.id, "deep"))).toBe(false);
  });

  it("refuses a package with more assets than the limit", async () => {
    const files: Record<string, Buffer> = {};
    for (let i = 0; i <= THEME_ASSET_LIMITS.maxFiles; i++) files[`${THEME_PATHS.assets}a${i}.png`] = PNG;
    await expect(themeService.importTheme(pack(files), "user-1")).rejects.toThrow(/the limit is/);
  });

  it("refuses two assets that would be stored under one name", async () => {
    const buf = pack({
      [`${THEME_PATHS.assets}hero.png`]: PNG,
      [`${THEME_PATHS.assets}sub/hero.png`]: PNG,
    });
    await expect(themeService.importTheme(buf, "user-1")).rejects.toThrow(/would be stored as/);
  });

  it("writes no asset when a layout in the same package is invalid", async () => {
    const broken = { ...structuredClone(DEFAULT_LAYOUTS.home), regions: { nope: [] } };
    const buf = pack({
      [`${THEME_PATHS.assets}hero.png`]: PNG,
      [`${THEME_PATHS.layouts}home.json`]: JSON.stringify(broken),
    });
    await expect(themeService.importTheme(buf, "user-1")).rejects.toThrow(/home\.json/);
    expect(savedDrafts.size).toBe(0);
    expect(fsSync.existsSync(path.join(UPLOAD_DIR, "themes", META.id))).toBe(false);
  });

  it("refuses an entry whose declared size is implausible, without decompressing it", async () => {
    // A 20 MB run of one byte compresses to a few KB — the classic bomb shape.
    const buf = pack({ [`${THEME_PATHS.layouts}home.json`]: Buffer.alloc(20_000_000, 0x20) });
    await expect(themeService.importTheme(buf, "user-1")).rejects.toThrow(/implausibly large/);
  });
});

// ── Variants ─────────────────────────────────────────────────────────────────
// A style variant is half document (which look a block picked) and half tokens (what
// that look IS). Both halves have to travel, or an imported theme applies looks the
// receiving site has no definition for.

/**
 * A theme exported from a site running a plugin carries that plugin's templates. The
 * question this covers is what happens on a site WITHOUT the plugin — the answer has
 * to be "the rest of the theme applies, and the admin is told what did not", because
 * refusing the whole package would make one plugin a hard dependency of every theme
 * ever exported alongside it.
 */
describe("plugin templates in a package", () => {
  const KEY = "testplug.index";
  const PLUGIN = "nodevo-testplug";
  const DOC = {
    templateKey: KEY,
    schemaVersion: 1,
    regions: { main: [{ id: "p1", type: "heading", props: { text: "Plugin page" } }] },
  };

  afterEach(() => { deregisterTemplatesFor(PLUGIN); });

  it("exports a registered plugin template alongside core's", async () => {
    registerTemplate({
      key: KEY, label: "Test index", pluginId: PLUGIN,
      regions: ["main"], defaultDocument: { templateKey: KEY, regions: {} },
    });
    published.templates[KEY] = DOC as LayoutDocument;

    const zip = new AdmZip(await themeService.exportTheme(META));
    expect(zip.getEntry(`${THEME_PATHS.layouts}${KEY}.json`)).toBeTruthy();
    expect(zip.getEntry(`${THEME_PATHS.layouts}home.json`)).toBeTruthy();
  });

  it("imports it when the plugin is enabled", async () => {
    registerTemplate({
      key: KEY, label: "Test index", pluginId: PLUGIN,
      regions: ["main"], defaultDocument: { templateKey: KEY, regions: {} },
    });
    const report = await themeService.importTheme(
      pack({ [`${THEME_PATHS.layouts}${KEY}.json`]: JSON.stringify(DOC) }), "user-1",
    );
    expect(report.templates).toContain(KEY);
    expect(report.unknownTemplates).toEqual([]);
    expect(savedDrafts.get(`${KEY}|`)).toBeTruthy();
  });

  it("SKIPS it when the plugin is not, applies the rest, and reports it", async () => {
    const report = await themeService.importTheme(pack({
      [`${THEME_PATHS.layouts}${KEY}.json`]: JSON.stringify(DOC),
      [`${THEME_PATHS.layouts}home.json`]:   JSON.stringify(DEFAULT_LAYOUTS.home),
    }), "user-1");

    expect(report.unknownTemplates).toEqual([KEY]);
    expect(report.templates).toContain("home");        // the rest of the theme still lands
    expect(savedDrafts.get(`${KEY}|`)).toBeUndefined(); // nothing stored for the unknown one
    expect(themeLayer.has(KEY)).toBe(false);            // and no baseline either
  });
});

describe("style variants", () => {
  it("carries a block's variant and the variant's tokens through a round trip", async () => {
    const home = structuredClone(DEFAULT_LAYOUTS.home) as LayoutDocument;
    home.regions.main![0]!.variant = "accent";
    published.templates.home = home;
    appearance.effective = {
      light: { "variant.accent": { "--surface-bg": "#ff0000" } },
      dark:  { "variant.accent": { "--surface-bg": "#330000" } },
    };

    const report = await themeService.importTheme(await themeService.exportTheme(META), "user-1");

    expect(report.tokensApplied).toBe(true);
    expect(savedDrafts.get("home|")!.regions.main![0]!.variant).toBe("accent");
    expect(appearance.savedThemeTokens).toMatchObject({
      light: { "variant.accent": { "--surface-bg": "#ff0000" } },
      dark:  { "variant.accent": { "--surface-bg": "#330000" } },
    });
  });

  it("refuses a document naming a variant this build does not have", async () => {
    const broken = structuredClone(DEFAULT_LAYOUTS.home) as LayoutDocument;
    (broken.regions.main![0] as { variant?: string }).variant = "neon";
    const buf = pack({ [`${THEME_PATHS.layouts}home.json`]: JSON.stringify(broken) });
    await expect(themeService.importTheme(buf, "user-1")).rejects.toThrow(/home\.json/);
    expect(savedDrafts.size).toBe(0);
  });
});

// ── Inheritance ──────────────────────────────────────────────────────────────
// The failure this exists to prevent: an admin buys a theme, customises a page, takes
// the 1.1 update, and loses the customisation. XenForo and WoltLab both make you choose
// between the update and your work; here the theme is a LAYER underneath.

describe("theme inheritance", () => {
  const pkg = (extra?: Record<string, unknown>) => {
    const zip = new AdmZip();
    zip.addFile(THEME_PATHS.manifest, Buffer.from(JSON.stringify({ ...META, minNodevoVersion: "1.0", ...extra })));
    for (const key of ["home", "members"] as CoreTemplateKey[]) {
      zip.addFile(`${THEME_PATHS.layouts}${key}.json`,
        Buffer.from(JSON.stringify(DEFAULT_LAYOUTS[key])));
    }
    zip.addFile(THEME_PATHS.tokens, Buffer.from(JSON.stringify({
      light: { global: { "--c-accent": "#111111", "--c-bg": "#eeeeee" } }, dark: {},
    })));
    return zip.toBuffer();
  };

  it("records what it ships as the baseline, for every template", async () => {
    const report = await themeService.importTheme(pkg(), "user-1");
    expect([...themeLayer.keys()].sort()).toEqual(["home", "members"]);
    expect(report.templates.sort()).toEqual(["home", "members"]);
    expect(report.kept).toEqual([]);
  });

  it("KEEPS a template the admin customised, and applies the rest", async () => {
    await themeService.importTheme(pkg(), "user-1");   // 1.0
    savedDrafts.clear();
    customised.add("home");                            // the admin edited Home

    const report = await themeService.importTheme(pkg({ version: "1.1.0" }), "user-1");

    expect(report.kept).toEqual(["home"]);
    expect(report.templates).toEqual(["members"]);
    // The customised template's document was NOT touched…
    expect(savedDrafts.has("home|")).toBe(false);
    // …but its baseline moved, so the next update compares against 1.1 and
    // "Revert to theme" offers the new version.
    expect(themeLayer.get("home")).toBeTruthy();
    expect(savedDrafts.has("members|")).toBe(true);
  });

  it("names the version it replaced, so an update can be described", async () => {
    appearance.installed = { id: META.id, name: META.name, version: "1.0.0" };
    const report = await themeService.importTheme(pkg({ version: "2.0.0" }), "user-1");
    expect(report.replaced).toEqual({ id: META.id, name: META.name, version: "1.0.0" });
    expect(appearance.savedInstalled).toMatchObject({ version: "2.0.0" });
  });

  it("puts tokens in the THEME layer, never the admin's draft", async () => {
    // This is token-level inheritance: the admin's own overrides live in a different
    // layer, so they survive an update per TOKEN rather than per file.
    await themeService.importTheme(pkg(), "user-1");
    expect(appearance.savedThemeTokens).toMatchObject({
      light: { global: { "--c-accent": "#111111" } },
    });
  });

  it("still reports nothing kept on a first import of a stock site", async () => {
    const report = await themeService.importTheme(pkg(), "user-1");
    expect(report.kept).toEqual([]);
    expect(report.replaced).toBeNull();
  });
});

/**
 * `.nvstyle` absorbed into `.nvtheme` (2026-08-15).
 *
 * The two were never really two formats: a style pack is `manifest.json` plus a
 * `:root`-only light/dark pair, which is a strict subset of a theme package. What
 * actually differed was the paperwork — a theme manifest requires `id`, `vendor`,
 * `version` and `minNodevoVersion`, and a style pack carried only `name` — so the
 * "strict superset" this file has claimed since it was written was true of the files
 * and false of the manifest. One ingestion path now, which is the point.
 */
describe("importing a legacy .nvstyle", () => {
  /** Exactly what the old `installStylePack` accepted: name only, no theme fields. */
  function stylePack(manifest: Record<string, unknown> = { name: "Ocean" }): Buffer {
    const zip = new AdmZip();
    zip.addFile(THEME_PATHS.manifest, Buffer.from(JSON.stringify(manifest)));
    zip.addFile(THEME_PATHS.cssLight, Buffer.from(":root {\n  --c-accent: #0aa;\n}\n"));
    zip.addFile(THEME_PATHS.cssDark, Buffer.from(":root {\n  --c-accent: #066;\n}\n"));
    return zip.toBuffer();
  }

  it("accepts one and takes its tokens", async () => {
    const report = await themeService.importTheme(stylePack(), "user-1");
    expect(report.manifest.name).toBe("Ocean");
    // The fields it never had are filled in rather than demanded of it.
    expect(report.manifest.id).toBe("ocean");
    expect(report.manifest.vendor).toBe("community");
    expect(report.manifest.version).toBe("1.0.0");
    // A pack carries no pages, so it must not claim to have replaced any.
    expect(report.templates).toEqual([]);
  });

  it("keeps an explicit id or vendor instead of inventing one", async () => {
    const report = await themeService.importTheme(
      stylePack({ name: "Ocean", vendor: "Acme", version: "2.3.0" }), "user-1",
    );
    expect(report.manifest.vendor).toBe("Acme");
    expect(report.manifest.version).toBe("2.3.0");
  });

  it("still refuses a real theme whose manifest is malformed", async () => {
    // The leniency is scoped to packages that are unmistakably style packs. A package
    // shipping layouts is a theme, and a theme with no id is an error, not a guess.
    const zip = new AdmZip();
    zip.addFile(THEME_PATHS.manifest, Buffer.from(JSON.stringify({ name: "Broken" })));
    zip.addFile(THEME_PATHS.cssLight, Buffer.from(":root {}"));
    zip.addFile(`${THEME_PATHS.layouts}home.json`, Buffer.from(JSON.stringify(DEFAULT_LAYOUTS.home)));
    await expect(themeService.importTheme(zip.toBuffer(), "user-1")).rejects.toThrow(/manifest/i);
  });

  it("holds the `:root`-only rule the old importer enforced", async () => {
    const zip = new AdmZip();
    zip.addFile(THEME_PATHS.manifest, Buffer.from(JSON.stringify({ name: "Sneaky" })));
    zip.addFile(THEME_PATHS.cssLight, Buffer.from("body { display: none; }"));
    await expect(themeService.importTheme(zip.toBuffer(), "user-1")).rejects.toThrow(/root/i);
  });
});

describe("tokens-only export", () => {
  it("ships the palette and no layouts", async () => {
    const zip = new AdmZip(await themeService.exportTheme(META, { tokensOnly: true }));
    const names = zip.getEntries().map((e) => e.entryName);

    expect(names).toContain(THEME_PATHS.tokens);
    expect(names).toContain(THEME_PATHS.cssLight);
    expect(names).toContain(THEME_PATHS.cssDark);
    expect(names).toContain(THEME_PATHS.manifest);
    expect(names.some((n) => n.startsWith(THEME_PATHS.layouts))).toBe(false);
    // No layouts means nothing references an asset, so none are collected.
    expect(names.some((n) => n.startsWith(THEME_PATHS.assets))).toBe(false);
  });

  it("still carries layouts when the flag is off", async () => {
    const zip = new AdmZip(await themeService.exportTheme(META));
    expect(zip.getEntries().some((e) => e.entryName.startsWith(THEME_PATHS.layouts))).toBe(true);
  });

  it("round-trips: what it exports, it can import", async () => {
    const buf = await themeService.exportTheme(META, { tokensOnly: true });
    const report = await themeService.importTheme(buf, "user-1");
    expect(report.templates).toEqual([]);
  });
});

/**
 * What a rejection actually TELLS an admin.
 *
 * Both of these were found by importing a broken package in a real browser, and
 * neither is visible from the server side: the message the API composes was being
 * thrown away and replaced before it reached the screen, and the part that survived
 * named no file and no field.
 */
/** The error a rejection produced — and a clear failure if it did not reject at all. */
async function rejectionOf(p: Promise<unknown>): Promise<Error> {
  let caught: unknown;
  let resolved = false;
  try { await p; resolved = true; } catch (e) { caught = e; }
  if (resolved) throw new Error("expected the import to be refused, but it succeeded");
  return caught as Error;
}

describe("rejections are actionable", () => {
  const brokenTheme = (): Buffer => {
    const zip = new AdmZip();
    zip.addFile(THEME_PATHS.manifest, Buffer.from(JSON.stringify({ name: "Sneaky" })));
    zip.addFile(THEME_PATHS.cssLight, Buffer.from(":root {}"));
    // A `layouts/` folder makes this a theme, so the strict manifest applies.
    zip.addFile(`${THEME_PATHS.layouts}home.json`, Buffer.from(JSON.stringify(DEFAULT_LAYOUTS.home)));
    return zip.toBuffer();
  };

  it("carries its OWN NEC code, not the generic validation one", async () => {
    // `NEC-API-4001` has a localized string ("Please check your input and try again"),
    // and the web client prefers a localized string over the server's message — so
    // borrowing that code silently replaced every specific reason with a generic one.
    await expect(themeService.importTheme(brokenTheme(), "user-1"))
      .rejects.toMatchObject({ code: "NEC-CORE-8002", httpStatus: 422 });
  });

  it("names the fields that are wrong, not just that something is", async () => {
    // Zod's message for a missing required field is "expected string, received
    // undefined" — repeated once per absent field, which identifies nothing. The
    // PATH is the only part that says what to go and fix.
    const err = await rejectionOf(themeService.importTheme(brokenTheme(), "user-1"));
    expect(err.message).toContain("id:");
    expect(err.message).toContain("vendor:");
    expect(err.message).toContain("version:");
    expect(err.message).toContain("minNodevoVersion:");
  });

  it("names the file when a layout is the problem", async () => {
    const zip = new AdmZip();
    zip.addFile(THEME_PATHS.manifest, Buffer.from(JSON.stringify({ ...META, minNodevoVersion: "1.0" })));
    zip.addFile(`${THEME_PATHS.layouts}home.json`, Buffer.from(JSON.stringify({ templateKey: "home" , regions: { main: [{ id: "x" }] } })));
    const err = await rejectionOf(themeService.importTheme(zip.toBuffer(), "user-1"));
    expect(err.message).toContain("layouts/home.json");
    expect(err.message).toMatch(/main\.0/);   // the offending node, by path
  });
});
