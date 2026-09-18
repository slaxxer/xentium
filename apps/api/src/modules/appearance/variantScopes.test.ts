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

beforeEach(() => settings.clear());

describe("variant scopes reach the page", () => {
  it("emits a variant bucket under its own class, below the document root", async () => {
    const css = await appearanceService.buildCSS(
      tokens({ "variant.accent": { "--surface-bg": "#ff0000" } }),
    );
    expect(css).toContain(":root .xt-v--accent");
    expect(css).toContain("--surface-bg: #ff0000;");
  });

  it("emits no `[data-theme]` prefix — a site has one look, so there is one root", async () => {
    const css = await appearanceService.buildCSS(
      tokens({ "variant.muted": { "--c-fg": "#eeeeee" } }),
    );
    expect(css).toContain(":root .xt-v--muted");
    expect(css).not.toContain("data-theme");
  });

  it("keeps global first, so a variant can override it", async () => {
    const css = await appearanceService.buildCSS(
      tokens({ "variant.accent": { "--c-fg": "#111111" }, global: { "--c-fg": "#222222" } }),
    );
    expect(css.indexOf("#222222")).toBeLessThan(css.indexOf("#111111"));
  });

  it("emits every variant this build defines", async () => {
    const css = await appearanceService.buildCSS(tokens({
      "variant.surface": { "--surface-bg": "#000001" },
      "variant.muted":   { "--surface-bg": "#000002" },
      "variant.accent":  { "--surface-bg": "#000003" },
      "variant.plain":   { "--surface-bg": "#000004" },
    }));
    for (const v of ["surface", "muted", "accent", "plain"]) {
      expect(css).toContain(`.xt-v--${v}`);
    }
  });

  it("drops a scope it does not know, instead of leaking it to the document root", async () => {
    const css = await appearanceService.buildCSS(
      tokens({ "variant.neon": { "--c-bg": "#ff00ff" } }),
    );
    // Neither under a selector nor — the actual bug — as a global override.
    expect(css).not.toContain("#ff00ff");
  });

  it("still emits the global bucket when a neighbouring scope is unknown", async () => {
    const css = await appearanceService.buildCSS(tokens({
      global: { "--c-bg": "#abcdef" },
      "region.fromTheFuture": { "--c-bg": "#ff00ff" },
    }));
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
      "variant.accent", { "--surface-bg": "#ff0000" }, "user-1",
    );

    expect(next["variant.accent"]).toEqual({ "--surface-bg": "#ff0000" });
    expect(next.global).toEqual({ "--c-bg": "#111111" });
    expect(next.navbar).toEqual({ "--nav-bg": "#222222" });
  });

  it("clears one token with null, keeping its neighbours", async () => {
    settings.set(DRAFT, { "variant.accent": { "--surface-bg": "#ff0000", "--c-fg": "#ffffff" } });
    const next = await appearanceService.saveDraftScope(
      "variant.accent", { "--surface-bg": null }, "user-1",
    );
    expect(next["variant.accent"]).toEqual({ "--c-fg": "#ffffff" });
  });

  it("DELETES an emptied bucket rather than storing `{}`", async () => {
    // Storage is sparse and "pending" is a stringify comparison, so a leftover empty
    // bucket would leave the draft looking changed forever.
    settings.set(DRAFT, { "variant.plain": { "--surface-bg": "#ff0000" } });
    const next = await appearanceService.saveDraftScope(
      "variant.plain", { "--surface-bg": null }, "user-1",
    );
    expect("variant.plain" in next).toBe(false);
  });

  it("starts from the LIVE tokens when no draft exists yet", async () => {
    // Otherwise recolouring one variant would silently discard every published token.
    settings.set("appearance.tokens", { global: { "--c-accent": "#abcdef" } });
    const next = await appearanceService.saveDraftScope(
      "variant.accent", { "--surface-bg": "#ff0000" }, "user-1",
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
      "variant.accent", { "--surface-bg": "#ff0000" }, "user-1",
    );
    expect(next.global).toEqual({ "--c-accent": "#legacy" });
  });
});

// ── Token inheritance ───────────────────────────────────────────────────────
// An imported theme's tokens go in their own layer, UNDER the admin's. That separation
// is the whole feature: per-token, an update replaces the theme's value and leaves every
// value the admin set alone.

describe("theme token layer", () => {
  const THEME = "appearance.tokens.theme";
  const LIVE  = "appearance.tokens";

  it("serves the theme's value where the admin set nothing", async () => {
    settings.set(THEME, { global: { "--c-accent": "#theme0" } });
    const eff = await appearanceService.getEffectiveTokens();
    expect(eff.global!["--c-accent"]).toBe("#theme0");
  });

  it("lets the ADMIN win, per token, keeping the theme's neighbours", async () => {
    settings.set(THEME, { global: { "--c-accent": "#theme0", "--c-bg": "#theme1" } });
    settings.set(LIVE,  { global: { "--c-accent": "#admin0" } });
    const eff = await appearanceService.getEffectiveTokens();
    expect(eff.global).toEqual({ "--c-accent": "#admin0", "--c-bg": "#theme1" });
  });

  it("merges per SCOPE, so a variant the theme defines survives an unrelated edit", async () => {
    settings.set(THEME, {
      global: { "--c-bg": "#theme1" },
      "variant.accent": { "--surface-bg": "#theme2" },
    });
    settings.set(LIVE, { global: { "--c-bg": "#admin1" } });
    const eff = await appearanceService.getEffectiveTokens();
    expect(eff.global!["--c-bg"]).toBe("#admin1");
    expect(eff["variant.accent"]!["--surface-bg"]).toBe("#theme2");
  });

  it("keeps the admin layer readable on its own — the editor writes back what it reads", async () => {
    // Merging into `getTokens()` would turn every theme value into an admin override on
    // the next save, which silently destroys the inheritance.
    settings.set(THEME, { global: { "--c-accent": "#theme0" } });
    settings.set(LIVE,  { global: { "--c-bg": "#admin1" } });
    const admin = await appearanceService.getTokenOverrides();
    expect(admin.global).toEqual({ "--c-bg": "#admin1" });
  });

  it("reaches the served stylesheet", async () => {
    settings.set(THEME, { global: { "--c-accent": "#abcabc" } });
    const css = await appearanceService.buildCSS(await appearanceService.getEffectiveTokens());
    expect(css).toContain("#abcabc");
  });

  it("layers the DRAFT over the theme too, so the staged preview is truthful", async () => {
    settings.set(THEME, { global: { "--c-accent": "#theme0", "--c-bg": "#theme1" } });
    settings.set("appearance.tokens.draft", { global: { "--c-accent": "#draft0" } });
    const eff = await appearanceService.getEffectiveDraftTokens();
    expect(eff.global).toEqual({ "--c-accent": "#draft0", "--c-bg": "#theme1" });
  });

  it("stays sparse: a token nobody set is absent, not filled from defaults", async () => {
    settings.set(THEME, { global: { "--c-accent": "#theme0" } });
    const eff = await appearanceService.getEffectiveTokens();
    expect("--c-bg" in eff.global!).toBe(false);
  });
});

// ── An imported theme is STAGED ─────────────────────────────────────────────
// An import must change nothing visitors see until publish — the same promise the
// layouts half of an import makes. The theme layer therefore has its own draft, and one
// "publish appearance" promotes both layers.

describe("theme layer staging", () => {
  const THEME = "appearance.tokens.theme";
  const THEME_DRAFT = "appearance.tokens.theme.draft";

  it("does not change the served stylesheet on import", async () => {
    settings.set(THEME_DRAFT, { global: { "--c-accent": "#newtheme" } });
    const live = await appearanceService.getEffectiveTokens();
    expect(live.global?.["--c-accent"]).toBeUndefined();
  });

  it("shows it in the staged preview", async () => {
    settings.set(THEME_DRAFT, { global: { "--c-accent": "#newtheme" } });
    const draft = await appearanceService.getEffectiveDraftTokens();
    expect(draft.global!["--c-accent"]).toBe("#newtheme");
  });

  it("reports PENDING from a theme import alone", async () => {
    // A fresh import touches no admin-layer token, so checking only that layer would say
    // "nothing to publish" and leave the admin unable to apply the theme they imported.
    settings.set(THEME_DRAFT, { global: { "--c-accent": "#newtheme" } });
    expect(await appearanceService.getDraftStatus()).toEqual({ pending: true });
  });

  it("reports nothing pending when the staged theme equals the live one", async () => {
    settings.set(THEME, { global: { "--c-accent": "#same" } });
    settings.set(THEME_DRAFT, { global: { "--c-accent": "#same" } });
    expect(await appearanceService.getDraftStatus()).toEqual({ pending: false });
  });

  it("falls back to the live theme layer when nothing is staged", async () => {
    settings.set(THEME, { global: { "--c-accent": "#published" } });
    const draft = await appearanceService.getThemeDraftTokens();
    expect(draft.global!["--c-accent"]).toBe("#published");
  });
});
