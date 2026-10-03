/**
 * The site's design stops at the admin panel.
 *
 * The ACP was rendering in whatever the site wore: install a theme, or move one
 * slider in the Style Editor, and the admin panel changed colour with it — because
 * the served stylesheet declares the palette on `:root` and writes custom CSS at
 * document scope. The panel is a tool, not part of the site's design, and it now
 * keeps its own look (`body.xt-acp`, apps/web/src/styles/_tokenDefaults.scss).
 *
 * Two halves of that live on this side of the wire and are pinned here:
 *  1. custom CSS is anchored under `body:not(.xt-acp)`, so a rule written for the
 *     site cannot reach the panel;
 *  2. the global token bucket is mirrored onto `.xt-site-tokens`, which is how a
 *     surface INSIDE the ACP (the Layout Editor's variant probe) asks for the site's
 *     colours back — without it the pin would make that surface lie.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScopedTokenSet } from "@xentium/contracts";

vi.mock("../../infrastructure/db.js", () => ({
  prisma: { setting: { upsert: async () => ({}) }, $transaction: async () => [] },
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

const globalTokens = (global: Record<string, string>): ScopedTokenSet => ({ global });

/** Serve `css` as the admin's custom CSS and return the built stylesheet. */
async function withCustomCss(css: string): Promise<string> {
  settings.set("appearance.custom_css", css);
  return appearanceService.buildCSS(globalTokens({}), { key: "" });
}

beforeEach(() => settings.clear());

describe("custom CSS stops at the admin panel", () => {
  it("anchors an ordinary selector under the site body", async () => {
    const css = await withCustomCss("a { color: red }");
    expect(css).toContain(":root body:not(.xt-acp) a");
  });

  it("compounds onto `body` rather than nesting a second one", async () => {
    const css = await withCustomCss("body { background: url(x.png) }");
    expect(css).toContain(":root body:not(.xt-acp) {");
    expect(css).not.toContain("body:not(.xt-acp) body");
  });

  it("keeps a compound and a combinator when it compounds onto body", async () => {
    const css = await withCustomCss("body.home > .feed { gap: 0 }");
    expect(css).toContain("body:not(.xt-acp).home > .feed");
  });

  it("leaves a `:root` rule document-wide — it declares tokens, which the ACP re-declares", async () => {
    // Qualifying a root rule by a class on its CHILD needs `:has()`, and an
    // unsupported selector drops the admin's ENTIRE stylesheet rather than one rule.
    const css = await withCustomCss(":root { --c-accent: #123456 }");
    expect(css).toContain(":root {");
    expect(css).not.toContain(":root body {");
  });
});

describe("the site's palette, mirrored for surfaces that opt back in", () => {
  it("mirrors the global bucket onto .xt-site-tokens", async () => {
    const css = await appearanceService.buildCSS(globalTokens({ "--c-accent": "#ff5c39" }), { key: "" });
    expect(css).toContain(".xt-site-tokens");
    const rule = css.split("\n\n").find((b) => b.includes("--c-accent: #ff5c39;"))!;
    expect(rule).toContain(":root");
    expect(rule).toContain(".xt-site-tokens");
  });

  it("emits no `[data-theme]` selector at all — there is one look", async () => {
    const css = await appearanceService.buildCSS(globalTokens({ "--c-accent": "#ff5c39" }), { key: "" });
    expect(css).not.toContain("data-theme");
  });

  it("does NOT mirror a region scope — its selector already lives on the site", async () => {
    const css = await appearanceService.buildCSS({ navbar: { "--nav-bg": "#000000" } }, { key: "" });
    expect(css).toContain(":root .pub-nav");
    expect(css).not.toContain(".xt-site-tokens .pub-nav");
  });
});
