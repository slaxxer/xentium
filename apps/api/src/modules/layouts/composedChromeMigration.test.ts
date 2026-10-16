import { describe, expect, it } from "vitest";
import type { LayoutDocument } from "@xentium/contracts";
import { composeDocuments, composeFooter, composeHeader, nestAccountMenu } from "./composedChromeMigration.js";

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
    expect(band!.children!.map((c) => c.type)).toEqual(["logo", "userMenu"]);
    const menu = band!.children![1]!;
    expect(menu.children!.map((c) => c.type)).toEqual(["modTool", "notifications", "search"]);
    expect(band!.children![0]!.props).toEqual({ showWordmark: false });
    // Alignment is a navbar concept and does not travel.
    expect([...band!.children!, ...menu.children!].every((c) => c.align === undefined)).toBe(true);
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

describe("splitting the moderation tool out of the bell", () => {
  it("turns the previous shipped headers into today's default exactly", async () => {
    const { DEFAULT_LAYOUTS } = await import("@xentium/contracts");
    // The composed header as it shipped: the icons BESIDE the account menu, not in it.
    const flat = (withModTool: boolean) => {
      const doc = structuredClone(DEFAULT_LAYOUTS["chrome.header"]);
      const band = doc.regions.header![0]!;
      const menu = band.children!.find((c) => c.type === "userMenu")!;
      const icons = menu.children!.filter((c) => withModTool || c.type !== "modTool");
      const search = icons.find((c) => c.type === "search")!;
      delete menu.children;
      band.children = [band.children![0]!, ...icons.filter((c) => c !== search), menu, search];
      return doc;
    };
    expect(composeHeader(flat(false))).toEqual(DEFAULT_LAYOUTS["chrome.header"]);   // v2
    expect(composeHeader(flat(true))).toEqual(DEFAULT_LAYOUTS["chrome.header"]);    // v3
    expect(composeHeader(structuredClone(DEFAULT_LAYOUTS["chrome.header"]))).toBeNull();
  });

  it("puts it just before the bell with the bell's audience, alignment and variant", () => {
    const bell = {
      id: "b", type: "notifications", props: {}, align: "right", variant: "accent",
      visibility: { audience: "groups", groups: ["g1"] },
    };
    const out = composeHeader(header([leaf("l", "logo"), bell, leaf("u", "userMenu")], []))!;
    const kids = out.regions.header![0]!.children!;
    expect(kids.map((c) => c.type)).toEqual(["logo", "userMenu"]);
    const inMenu = kids[1]!.children!;
    expect(inMenu.map((c) => c.type)).toEqual(["modTool", "notifications"]);
    // Inside the account menu alignment means nothing, so only that is dropped.
    expect(inMenu[0]).toEqual({
      id: "b-mod", type: "modTool", props: {}, variant: "accent",
      visibility: { audience: "groups", groups: ["g1"] },
    });
  });

  it("finds a bell left in the navbar, and never reuses an id", () => {
    const out = composeHeader(header([leaf("l", "logo"), leaf("u", "userMenu"), leaf("b-mod", "search")],
      [leaf("b", "notifications", "right")]))!;
    const navbar = out.regions.header![1]!.children!;
    expect(navbar.map((c) => [c.id, c.type])).toEqual([["b-mod2", "modTool"], ["b", "notifications"]]);
  });

  it("leaves a header that already places one, and a header without a bell", () => {
    expect(composeHeader(header([leaf("l", "logo"), leaf("u", "userMenu")], [
      leaf("m", "modTool", "right"), leaf("b", "notifications", "right"),
    ]))).toBeNull();
    expect(composeHeader(header([leaf("l", "logo"), leaf("u", "userMenu")], []))).toBeNull();
  });

  it("is applied to a theme package's header, so an older package installs split", () => {
    const pkg = { "chrome.header": header([leaf("l", "logo"), leaf("h-notif", "notifications"), leaf("u", "userMenu")], []) };
    const out = composeDocuments(pkg)!;
    const band = (out["chrome.header"] as LayoutDocument).regions.header![0]!;
    expect(band.children!.map((c) => c.id)).toEqual(["l", "u"]);
    expect(band.children![1]!.children!.map((c) => c.id)).toEqual(["h-mod", "h-notif"]);
  });
});

describe("nesting the icons in the account menu", () => {
  it("moves every icon beside the menu inside it, in the admin's order, plugin icons too", () => {
    const nodes = [
      leaf("l", "logo"), leaf("m", "modTool"), leaf("b", "notifications"),
      leaf("w", "slot.headerWidget.inbox"), leaf("s", "search"), leaf("a", "adminLink"), leaf("u", "userMenu"),
      leaf("x", "spacer"),
    ];
    expect(nestAccountMenu(nodes as never)).toBe(true);
    expect(nodes.map((n) => n.id)).toEqual(["l", "u", "x"]);
    expect((nodes[1] as unknown as { children: { id: string }[] }).children.map((c) => c.id)).toEqual(["m", "b", "w", "s", "a"]);
  });

  it("works in the navbar too, and leaves a menu that already holds something", () => {
    const navbar = [{ id: "nb", type: "navbar", props: {}, children: [
      leaf("n", "navLinks"), leaf("b", "notifications", "right"), leaf("u", "userMenu", "right"),
    ] }];
    expect(nestAccountMenu(navbar as never)).toBe(true);
    const kids = navbar[0]!.children as { id: string; align?: string; children?: { id: string; align?: string }[] }[];
    expect(kids.map((c) => c.id)).toEqual(["n", "u"]);
    expect(kids[1]!.align).toBe("right");                 // the menu keeps its place
    expect(kids[1]!.children).toEqual([{ id: "b", type: "notifications", props: {} }]);

    const arranged = [leaf("b", "notifications"), { ...leaf("u", "userMenu"), children: [leaf("s", "search")] }];
    expect(nestAccountMenu(arranged as never)).toBe(false);
    expect(arranged.map((n) => n.id)).toEqual(["b", "u"]);
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
