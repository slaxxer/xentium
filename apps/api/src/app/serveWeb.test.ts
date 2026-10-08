/**
 * The served index.html carries the theme's stylesheet and layout documents, so the first paint is the
 * theme. It used to arrive from a React effect after the bundle mounted, and every
 * load of a themed site flashed the built-in default look first.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import { appearanceService } from "../modules/appearance/appearance.service.js";
import { layoutService } from "../modules/layouts/layout.service.js";
import { injectLayouts, injectThemeCss } from "./serveWeb.js";

const HTML = "<html><head><title>x</title></head><body></body></html>";
const req = (cookie?: string) => ({ headers: cookie ? { cookie } : {} }) as unknown as Request;

afterEach(() => vi.restoreAllMocks());

describe("injectThemeCss", () => {
  it("inlines the live sheet into the head, stamped with its version", async () => {
    vi.spyOn(appearanceService, "getLiveCss").mockResolvedValue(":root{--c-accent:#e22b2b}");
    vi.spyOn(appearanceService, "getStyleVersion").mockResolvedValue(42);
    const out = await injectThemeCss(HTML, req());
    expect(out).toContain('<style id="xentium-custom-tokens" data-style-version="42">:root{--c-accent:#e22b2b}</style>');
    expect(out.indexOf("<style")).toBeLessThan(out.indexOf("</head>"));
  });

  it("serves a visitor's own theme without a version, and falls back when it names nothing", async () => {
    vi.spyOn(appearanceService, "getLiveCss").mockResolvedValue(":root{--live:1}");
    vi.spyOn(appearanceService, "getStyleVersion").mockResolvedValue(7);
    const themed = vi.spyOn(appearanceService, "getThemeCss").mockResolvedValue(":root{--mine:1}");

    const mine = await injectThemeCss(HTML, req("a=1; xt_theme=redline"));
    expect(themed).toHaveBeenCalledWith("redline", null);
    expect(mine).toContain('<style id="xentium-custom-tokens">:root{--mine:1}</style>');

    themed.mockResolvedValue(null);
    expect(await injectThemeCss(HTML, req("xt_theme=gone"))).toContain('data-style-version="7">:root{--live:1}');
  });

  it("passes the visitor's colourway on, and drops one that is not a colourway id", async () => {
    vi.spyOn(appearanceService, "getStyleVersion").mockResolvedValue(7);
    const themed = vi.spyOn(appearanceService, "getThemeCss").mockResolvedValue(":root{--mine:1}");
    const live = vi.spyOn(appearanceService, "getLiveCss").mockResolvedValue(":root{--live:1}");

    await injectThemeCss(HTML, req("xt_theme=vanguard; xt_cw=ember"));
    expect(themed).toHaveBeenCalledWith("vanguard", "ember");

    // On the site's own theme the colourway rides the LIVE sheet, which keeps its version.
    expect(await injectThemeCss(HTML, req("xt_cw=ember"))).toContain('data-style-version="7"');
    expect(live).toHaveBeenCalledWith("ember");

    await injectThemeCss(HTML, req("xt_cw=%3Cx%3E"));
    expect(live).toHaveBeenLastCalledWith(null);
  });

  it("cannot be broken out of, and leaves $-patterns in the CSS alone", async () => {
    vi.spyOn(appearanceService, "getLiveCss").mockResolvedValue('a::after{content:"$&"}</style><script>x</script>');
    vi.spyOn(appearanceService, "getStyleVersion").mockResolvedValue(1);
    const out = await injectThemeCss(HTML, req());
    expect(out).toContain('content:"$&"');
    expect(out).not.toContain("</style><script>");
  });
});

describe("injectLayouts", () => {
  it("inlines the published documents, tagged with the theme they are for", async () => {
    const site = { templates: { home: { note: "</script><b>" } }, variants: {} } as never;
    vi.spyOn(layoutService, "getPublishedAll").mockResolvedValue(site);
    const forTheme = vi.spyOn(layoutService, "getPublishedAllForTheme").mockResolvedValue(site);

    const plain = await injectLayouts(HTML, req());
    expect(plain).toContain('<script id="xentium-layouts" type="application/json" data-theme="">');
    // A string in a document cannot close the element.
    expect(plain).not.toContain("</script><b>");
    const json = plain.slice(plain.indexOf('data-theme="">') + 14, plain.indexOf("</script>"));
    expect(JSON.parse(json)).toEqual({ templates: { home: { note: "</script><b>" } }, variants: {} });

    const themed = await injectLayouts(HTML, req("xt_theme=redline"));
    expect(forTheme).toHaveBeenCalledWith("redline");
    expect(themed).toContain('data-theme="redline"');
  });
});
