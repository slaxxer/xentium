/**
 * Variant scopes in the served stylesheet (ADR-0005 style variants).
 *
 * Two things are worth pinning here, and the second is a bug this feature exposed:
 *
 *  1. A variant bucket has to reach the page under the variant's own class — that is
 *     the entire mechanism by which "this panel is accent" becomes colours, so it
 *     cannot be left to the generic scope path untested.
 *  2. An UNKNOWN scope must emit nothing. `selectorFor` used to fall back to the
 *     document root for a scope it did not recognise, which silently promoted the
 *     bucket to a global override: a `.xttheme` naming a scope from a newer build
 *     would have recoloured the whole site rather than one variant.
 *
 * The settings reader and the SSE publisher are mocked because none of that is about
 * the database — `buildCSS` is a pure function of the tokens it is handed plus three
 * font settings.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScopedTokenSet } from "@xentium/contracts";

// `buildCSS` folds in the admin custom CSS, which is compiled once and cached in a
// setting — hence the one prisma call this needs.
vi.mock("../../infrastructure/db.js", () => ({
  prisma: {
    setting: { upsert: async () => ({}) },
    // `saveDraftTokens` writes the three draft settings in one transaction. The values
    // are asserted through what `saveDraftScope` RETURNS, which is the same object it
    // persists, so the transaction only has to not throw.
    $transaction: async () => [],
  },
}));
vi.mock("./appearance.sse.js", () => ({ publishStyleVersion: vi.fn(), addSseClient: vi.fn() }));

const settings = new Map<string, unknown>();
vi.mock("../../shared/utils/settings.js", () => ({
  getFreshSetting: async (key: string, fallback: unknown) =>
    (settings.has(key) ? settings.get(key) : fallback),
  getSetting: async (key: string, fallback: unknown) =>
    (settings.has(key) ? settings.get(key) : fallback),
  bustSettingsCache: () => {},
}));

const { appearanceService } = await import("./appearance.service.js");

const tokens = (scoped: Record<string, Record<string, string>>): ScopedTokenSet => scoped;

/** What each theme ships, by key — `themeBaseline` reads the library row in production. */
const baselines = new Map<string, Record<string, Record<string, string>>>();
vi.mock("../themes/themeKey.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../themes/themeKey.js")>()),
  themeBaseline: async (key: string) => ({
    documents: {}, tokens: baselines.get(key) ?? {}, customCss: "", frame: null,
  }),
}));

beforeEach(() => { settings.clear(); baselines.clear(); });

describe("variant scopes reach the page", () => {
  it("emits a variant bucket under its own class, below the document root", async () => {
    const css = await appearanceService.buildCSS(
      tokens({ "variant.accent": { "--surface-bg": "#ff0000" } }), { key: "" },
    );
    expect(css).toContain(":root .xt-v--accent");
    expect(css).toContain("--surface-bg: #ff0000;");
  });

  it("emits no `[data-theme]` prefix — a site has one look, so there is one root", async () => {
    const css = await appearanceService.buildCSS(
      tokens({ "variant.muted": { "--c-fg": "#eeeeee" } }), { key: "" },
    );
    expect(css).toContain(":root .xt-v--muted");
    expect(css).not.toContain("data-theme");
  });

  it("keeps global first, so a variant can override it", async () => {
    const css = await appearanceService.buildCSS(
      tokens({ "variant.accent": { "--c-fg": "#111111" }, global: { "--c-fg": "#222222" } }), { key: "" },
    );
    expect(css.indexOf("#222222")).toBeLessThan(css.indexOf("#111111"));
  });

  it("emits every variant this build defines", async () => {
    const css = await appearanceService.buildCSS(tokens({
      "variant.surface": { "--surface-bg": "#000001" },
      "variant.muted":   { "--surface-bg": "#000002" },
      "variant.accent":  { "--surface-bg": "#000003" },
      "variant.plain":   { "--surface-bg": "#000004" },
    }), { key: "" });
    for (const v of ["surface", "muted", "accent", "plain"]) {
      expect(css).toContain(`.xt-v--${v}`);
    }
  });

  it("drops a scope it does not know, instead of leaking it to the document root", async () => {
    const css = await appearanceService.buildCSS(
      tokens({ "variant.neon": { "--c-bg": "#ff00ff" } }), { key: "" },
    );
    // Neither under a selector nor — the actual bug — as a global override.
    expect(css).not.toContain("#ff00ff");
  });

  it("still emits the global bucket when a neighbouring scope is unknown", async () => {
    const css = await appearanceService.buildCSS(tokens({
      global: { "--c-bg": "#abcdef" },
      "region.fromTheFuture": { "--c-bg": "#ff00ff" },
    }), { key: "" });
    expect(css).toContain("#abcdef");
    expect(css).not.toContain("#ff00ff");
  });
});

// ── Patching one scope of the draft ─────────────────────────────────────────
// The Layout Editor's variant panel is a SECOND writer of the appearance draft. Both
// surfaces doing read-modify-write on the whole token set would lose whichever edit
// landed first, so the patch is applied server-side, to one bucket.

describe("saveDraftScope", () => {
  const DRAFT = "appearance.tokens.draft";

  it("adds a token without touching the rest of the draft", async () => {
    settings.set(DRAFT, { global: { "--c-bg": "#111111" }, navbar: { "--nav-bg": "#222222" } });

    const next = await appearanceService.saveDraftScope(
      "variant.accent", { "--surface-bg": "#ff0000" }, "user-1", "",
    );

    expect(next["variant.accent"]).toEqual({ "--surface-bg": "#ff0000" });
    expect(next.global).toEqual({ "--c-bg": "#111111" });
    expect(next.navbar).toEqual({ "--nav-bg": "#222222" });
  });

  it("clears one token with null, keeping its neighbours", async () => {
    settings.set(DRAFT, { "variant.accent": { "--surface-bg": "#ff0000", "--c-fg": "#ffffff" } });
    const next = await appearanceService.saveDraftScope(
      "variant.accent", { "--surface-bg": null }, "user-1", "",
    );
    expect(next["variant.accent"]).toEqual({ "--c-fg": "#ffffff" });
  });

  it("DELETES an emptied bucket rather than storing `{}`", async () => {
    // Storage is sparse and "pending" is a stringify comparison, so a leftover empty
    // bucket would leave the draft looking changed forever.
    settings.set(DRAFT, { "variant.plain": { "--surface-bg": "#ff0000" } });
    const next = await appearanceService.saveDraftScope(
      "variant.plain", { "--surface-bg": null }, "user-1", "",
    );
    expect("variant.plain" in next).toBe(false);
  });

  it("starts from the LIVE tokens when no draft exists yet", async () => {
    // Otherwise recolouring one variant would silently discard every published token.
    settings.set("appearance.tokens", { global: { "--c-accent": "#abcdef" } });
    const next = await appearanceService.saveDraftScope(
      "variant.accent", { "--surface-bg": "#ff0000" }, "user-1", "",
    );
    expect(next.global).toEqual({ "--c-accent": "#abcdef" });
    expect(next["variant.accent"]).toEqual({ "--surface-bg": "#ff0000" });
  });

  it("reads a PRE-COLLAPSE draft, so an upgraded site keeps its staged edits", async () => {
    // The old shape was a `{light, dark}` pair of settings. The light half is the one a
    // one-look site keeps, and it has to be readable or an in-flight draft vanishes on
    // the deploy that collapsed the storage.
    settings.set("appearance.tokens.draft.light", { global: { "--c-accent": "#legacy" } });
    const next = await appearanceService.saveDraftScope(
      "variant.accent", { "--surface-bg": "#ff0000" }, "user-1", "",
    );
    expect(next.global).toEqual({ "--c-accent": "#legacy" });
  });
});

// ── Token inheritance, per theme ───────────────────────────────────────────
// Each theme's package sits UNDER the admin's edits to that theme, per token. Each
// theme's edits are its own: editing one never reaches another, and Core keeps the
// historical unsuffixed keys.

describe("per-theme token layers", () => {
  const T = "redline";
  const LIVE_T = `appearance.tokens@${T}`;

  it("serves the theme's value where the admin set nothing", async () => {
    baselines.set(T, { global: { "--c-accent": "#theme0" } });
    const eff = await appearanceService.getEffectiveTokens(T);
    expect(eff.global!["--c-accent"]).toBe("#theme0");
  });

  it("lets the ADMIN win, per token, keeping the theme's neighbours", async () => {
    baselines.set(T, { global: { "--c-accent": "#theme0", "--c-bg": "#theme1" } });
    settings.set(LIVE_T, { global: { "--c-accent": "#admin0" } });
    const eff = await appearanceService.getEffectiveTokens(T);
    expect(eff.global).toEqual({ "--c-accent": "#admin0", "--c-bg": "#theme1" });
  });

  it("merges per SCOPE, so a variant the theme defines survives an unrelated edit", async () => {
    baselines.set(T, { global: { "--c-bg": "#theme1" }, "variant.accent": { "--surface-bg": "#theme2" } });
    settings.set(LIVE_T, { global: { "--c-bg": "#admin1" } });
    const eff = await appearanceService.getEffectiveTokens(T);
    expect(eff.global!["--c-bg"]).toBe("#admin1");
    expect(eff["variant.accent"]!["--surface-bg"]).toBe("#theme2");
  });

  it("keeps the admin layer readable on its own — the editor writes back what it reads", async () => {
    baselines.set(T, { global: { "--c-accent": "#theme0" } });
    settings.set(LIVE_T, { global: { "--c-bg": "#admin1" } });
    expect((await appearanceService.getTokenOverrides(T)).global).toEqual({ "--c-bg": "#admin1" });
  });

  it("layers the DRAFT over the theme too, so the staged preview is truthful", async () => {
    baselines.set(T, { global: { "--c-accent": "#theme0", "--c-bg": "#theme1" } });
    settings.set(`appearance.tokens.draft@${T}`, { global: { "--c-accent": "#draft0" } });
    const eff = await appearanceService.getEffectiveDraftTokens(T);
    expect(eff.global).toEqual({ "--c-accent": "#draft0", "--c-bg": "#theme1" });
  });

  it("stays sparse: a token nobody set is absent, not filled from defaults", async () => {
    baselines.set(T, { global: { "--c-accent": "#theme0" } });
    expect("--c-bg" in (await appearanceService.getEffectiveTokens(T)).global!).toBe(false);
  });

  it("keeps each theme's edits to itself", async () => {
    settings.set(LIVE_T, { global: { "--c-accent": "#redline" } });
    settings.set("appearance.tokens", { global: { "--c-accent": "#core" } });
    settings.set("appearance.tokens@meadow", { global: { "--c-accent": "#meadow" } });
    expect((await appearanceService.getEffectiveTokens(T)).global!["--c-accent"]).toBe("#redline");
    expect((await appearanceService.getEffectiveTokens("")).global!["--c-accent"]).toBe("#core");
    expect((await appearanceService.getEffectiveTokens("meadow")).global!["--c-accent"]).toBe("#meadow");
  });

  it("reads Core's pre-collapse keys, and only Core's", async () => {
    settings.set("appearance.tokens.light", { global: { "--c-accent": "#legacy" } });
    expect((await appearanceService.getTokenOverrides("")).global!["--c-accent"]).toBe("#legacy");
    expect((await appearanceService.getTokenOverrides(T)).global).toBeUndefined();
  });

  it("reports pending per theme", async () => {
    settings.set(`appearance.tokens.draft@${T}`, { global: { "--c-accent": "#x" } });
    expect(await appearanceService.getDraftStatus(T)).toEqual({ pending: true });
    expect(await appearanceService.getDraftStatus("")).toEqual({ pending: false });
  });
});
