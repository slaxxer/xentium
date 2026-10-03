import { describe, expect, it } from "vitest";
import type { LayoutDocument } from "@xentium/contracts";
import { composeFooter, composeHeader } from "./composedChromeMigration.js";

const header = (headerChildren: unknown[] | undefined, navChildren: unknown[], headerProps = {}): LayoutDocument => ({
  templateKey: "chrome.header", schemaVersion: 1,
  regions: { header: [
    { id: "h-band", type: "header", props: { showLogo: true, showWordmark: false, ...headerProps }, ...(headerChildren ? { children: headerChildren } : {}) },
    { id: "h-navbar", type: "navbar", props: {}, children: navChildren },
  ] },
} as LayoutDocument);

const leaf = (id: string, type: string, align?: string) => ({ id, type, props: {}, ...(align ? { align } : {}) });

describe("composing a stored header", () => {
  it("makes the built-in logo a child and moves the account buttons into the masthead", () => {
    const out = composeHeader(header(undefined, [
      leaf("l", "logo"), leaf("n", "navLinks"), leaf("s", "search", "right"),
      leaf("t", "themeToggle", "right"), leaf("u", "userMenu", "right"), leaf("b", "notifications", "right"),
    ]))!;
    const [band, navbar] = out.regions.header!;
    expect(band!.props.showLogo).toBe(false);
    expect(band!.children!.map((c) => c.type)).toEqual(["logo", "notifications", "userMenu", "search"]);
    expect(band!.children![0]!.props).toEqual({ showWordmark: false });
    // Alignment is a navbar concept and does not travel.
    expect(band!.children!.every((c) => c.align === undefined)).toBe(true);
    expect(navbar!.children!.map((c) => c.type)).toEqual(["logo", "navLinks"]);
  });

  it("leaves a masthead that already holds actions as arranged", () => {
    const out = composeHeader(header([leaf("l", "logo"), leaf("u", "userMenu")], [leaf("s", "search", "right")]));
    expect(out).toBeNull();
  });

  it("does not add a logo the admin had switched off", () => {
    const out = composeHeader(header(undefined, [], { showLogo: false }));
    expect(out).toBeNull();
  });
});

describe("an untouched header", () => {
  it("becomes today's default exactly, so it never reads as customised", async () => {
    const { DEFAULT_LAYOUTS } = await import("@xentium/contracts");
    const old = {
      templateKey: "chrome.header", schemaVersion: 1, regions: { header: [
        { id: "h-band", type: "header", props: { backgroundAngle: 90, height: 250, showLogo: true, showWordmark: true, backgroundGradient: ["#2b1055", "#7597de"] } },
        { id: "h-navbar", type: "navbar", props: {}, children: [
          leaf("h-logo", "logo"), leaf("h-nav", "navLinks"), leaf("h-search", "search", "right"),
          leaf("t", "themeToggle", "right"), leaf("h-widgets", "headerWidgets", "right"),
          leaf("h-notif", "notifications", "right"), leaf("h-admin", "adminLink", "right"), leaf("h-user", "userMenu", "right"),
        ] },
      ] },
    } as LayoutDocument;
    (old.regions.header![1]!.children![0]!.props as Record<string, unknown>).showWordmark = true;
    (old.regions.header![1]!.children![2]!.props as Record<string, unknown>).expanded = false;
    expect(composeHeader(old)).toEqual(DEFAULT_LAYOUTS["chrome.header"]);
  });
});

describe("composing a stored footer", () => {
  const band = (children: unknown[], props = {}) => ({
    templateKey: "chrome.footer", schemaVersion: 1,
    regions: { footer: [{ id: "f", type: "footer", props, children }] },
  } as LayoutDocument);

  it("turns a customised branding block into a footer bar, keeping its choices", () => {
    const out = composeFooter(band([
      leaf("o", "whosOnline"),
      { id: "br", type: "branding", props: { showUptime: true, showThemeChooser: false } },
    ]))!;
    const kids = out.regions.footer![0]!.children!;
    expect(kids.map((c) => c.type)).toEqual(["whosOnline", "footerBar"]);
    expect(kids[1]!.props).toEqual({ showUptime: true, showThemeChooser: false });
  });

  it("turns the links + text pair into one bar, keeping its switches", () => {
    const out = composeFooter(band([
      leaf("o", "whosOnline"),
      { id: "l", type: "footerLinks", props: { showThemeChooser: true } },
      { id: "t", type: "footerText", props: { showUptime: true } },
    ], { showTopBorder: true, linksAlign: "left", textAlign: "right", order: "links" }))!;
    const footer = out.regions.footer![0]!;
    expect(footer.children!.map((c) => c.type)).toEqual(["whosOnline", "footerBar"]);
    expect(footer.children![1]!.props).toEqual({ showUptime: true });
    // The pair's settings left the footer block with them.
    expect(footer.props).toEqual({ showTopBorder: true });
  });

  it("maps an untouched default onto today's default exactly", async () => {
    const { DEFAULT_LAYOUTS } = await import("@xentium/contracts");
    const out = composeFooter(band([
      { id: "f-online", type: "whosOnline", props: { maxNames: 20 } }, leaf("f-legend", "groupLegend"),
      leaf("f-stats", "boardStats"), { id: "f-links", type: "footerLinks", props: { showThemeChooser: true } },
      leaf("f-text", "footerText"),
    ], { showTopBorder: true }))!;
    out.regions.footer![0]!.id = "f-band";
    expect(out.regions.footer).toEqual(DEFAULT_LAYOUTS["chrome.footer"].regions.footer);
  });
});
