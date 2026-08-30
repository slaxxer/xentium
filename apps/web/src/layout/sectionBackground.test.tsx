/**
 * The `section` background — an image, a gradient of up to three colours, or both —
 * plus its height and content column.
 *
 * @vitest-environment jsdom
 *
 * Two things are worth pinning. The COMPOSITION order, because CSS paints the first
 * layer on top and getting it backwards hides the image behind the gradient with no
 * error anywhere. And the SCHEMA's refusals, because a document is untrusted input
 * twice over: an admin types a colour, and a purchased `.nvtheme` ships others.
 */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { blockPropSchemas, assetPropsOf, regionsFor, DEFAULT_LAYOUTS, parseLayoutDocument } from "@nodevo/contracts";
import { sectionBackground } from "./blocks/coreBlocks";
import { LayoutRegion } from "./LayoutRenderer";

describe("composing the background", () => {
  it("is undefined when neither half is set, so an untouched section emits no style", () => {
    expect(sectionBackground({})).toBeUndefined();
    expect(sectionBackground({ backgroundImage: "", backgroundGradient: [] })).toBeUndefined();
  });

  it("resolves an upload path to a URL the browser can fetch", () => {
    expect(sectionBackground({ backgroundImage: "layouts/a.jpg" }))
      .toBe('url("/uploads/layouts/a.jpg")');
  });

  it("leaves an absolute URL alone — a section may point at a CDN", () => {
    expect(sectionBackground({ backgroundImage: "https://cdn.example.com/a.jpg" }))
      .toBe('url("https://cdn.example.com/a.jpg")');
  });

  it("paints a flat fill from ONE colour", () => {
    // `linear-gradient` needs two stops; a single colour is a legitimate choice and
    // must not silently produce nothing.
    expect(sectionBackground({ backgroundGradient: ["#123456"] }))
      .toBe("linear-gradient(180deg, #123456, #123456)");
  });

  it("carries up to three stops and the chosen angle", () => {
    expect(sectionBackground({ backgroundGradient: ["#111", "#222", "#333"], backgroundAngle: 90 }))
      .toBe("linear-gradient(90deg, #111, #222, #333)");
  });

  it("defaults to top-to-bottom when no angle was chosen", () => {
    expect(sectionBackground({ backgroundGradient: ["#111", "#222"] }))
      .toContain("180deg");
  });

  /** ⚠ CSS paints the FIRST layer on top. Reversed, every uploaded masthead would sit
   *  behind its own gradient and look like the upload had failed. */
  it("puts the image OVER the gradient when both are set", () => {
    const css = sectionBackground({
      backgroundImage: "layouts/a.jpg", backgroundGradient: ["#111", "#222"],
    })!;
    expect(css.indexOf("url(")).toBeLessThan(css.indexOf("linear-gradient("));
  });

  it("ignores blank stops rather than emitting an empty colour", () => {
    expect(sectionBackground({ backgroundGradient: ["#111", "  ", "#333"] }))
      .toBe("linear-gradient(180deg, #111, #333)");
  });
});

describe("what the schema admits", () => {
  const parse = (v: unknown) => blockPropSchemas.section.safeParse({ backgroundGradient: v });

  it("accepts hex, rgb(), hsl() and a token reference", () => {
    // `var(--token)` is the form a THEME should use: it follows the site's palette
    // and both light and dark, which a picked hex cannot.
    expect(parse(["#fff", "rgba(0,0,0,.5)", "hsl(210 40% 20%)"]).success).toBe(true);
    expect(parse(["var(--c-accent)"]).success).toBe(true);
  });

  /** The reason the regex is strict: these values are composed into a
   *  `linear-gradient(...)`, and a package must not be able to smuggle a second
   *  declaration or an off-site fetch into it. */
  it("REFUSES anything that is not a colour", () => {
    expect(parse(["red; } body { display: none"]).success).toBe(false);
    expect(parse(["url(https://tracker.example/x.png)"]).success).toBe(false);
    expect(parse(["expression(alert(1))"]).success).toBe(false);
  });

  it("REFUSES a fourth stop, so a document cannot exceed what the editor offers", () => {
    expect(parse(["#111", "#222", "#333"]).success).toBe(true);
    expect(parse(["#111", "#222", "#333", "#444"]).success).toBe(false);
  });

  it("bounds the angle to a real rotation", () => {
    expect(blockPropSchemas.section.safeParse({ backgroundAngle: 361 }).success).toBe(false);
    expect(blockPropSchemas.section.safeParse({ backgroundAngle: -1 }).success).toBe(false);
  });

  /**
   * ⚠ The flag is what makes the image TRAVEL — the exporter copies the file into
   * the package and rewrites the reference, the importer unpacks it and rewrites it
   * again. Fold this into a nested object and it silently stops being collected, and
   * every theme's masthead arrives as a path into the exporting machine's disk.
   */
  it("declares the image as an ASSET, so it travels inside a .nvtheme", () => {
    expect(assetPropsOf("section")).toContain("backgroundImage");
  });
});

/**
 * The site chrome: four landmarks, and the navbar as a BLOCK inside the header.
 *
 * This replaced a region set that had grown by accretion — three navbar zones, three
 * footer slots, `beforeBody`/`afterBody`, and two bands added for a masthead. The
 * claim worth pinning is that a navbar is IN the header, so ordering a masthead
 * against it is ordering blocks rather than choosing between named slots.
 */
/**
 * Height and the content column — what makes a band read as part of the page rather
 * than as a strip bolted above it.
 */
describe("section height and the content column", () => {
  afterEach(cleanup);

  const renderSection = (props: Record<string, unknown>) => {
    const doc = {
      templateKey: "home", schemaVersion: 1,
      regions: { main: [{
        id: "s1", type: "section",
        props: { width: "normal", padding: "md", ...props },
        children: [],
      }] },
    } as never;
    const { container } = render(<LayoutRegion document={doc} region="main" />);
    return container.querySelector("section.nv-section")!;
  };

  /**
   * The wrapper is UNCONDITIONAL. A DOM shape that changed with the width prop would
   * mean custom CSS written against a full-bleed band stops matching the moment an
   * admin narrows it — the same class of breakage as a combinator crossing a block.
   */
  it("always renders the inner content column, whatever the width", () => {
    for (const width of ["full", "wide", "normal", "narrow"]) {
      cleanup();
      expect(renderSection({ width }).querySelector(".nv-section__inner")).not.toBeNull();
    }
  });

  it("takes a minimum height and marks itself tall, so its content is centred", () => {
    const el = renderSection({ minHeight: 250 });
    expect(el.classList.contains("nv-section--tall")).toBe(true);
    expect((el as HTMLElement).style.minHeight).toBe("250px");
  });

  /** 0 is "as tall as its content" — it must emit no height and no class, or every
   *  untouched section on the site would become a flex container. */
  it("emits nothing at all for the default height", () => {
    const el = renderSection({ minHeight: 0 });
    expect(el.classList.contains("nv-section--tall")).toBe(false);
    expect((el as HTMLElement).style.minHeight).toBe("");
  });

  it("bounds the height rather than accepting any number a document carries", () => {
    expect(blockPropSchemas.section.safeParse({ minHeight: 250 }).success).toBe(true);
    expect(blockPropSchemas.section.safeParse({ minHeight: -1 }).success).toBe(false);
    expect(blockPropSchemas.section.safeParse({ minHeight: 5000 }).success).toBe(false);
  });
});

describe("the site chrome", () => {
  it("gives the header and the footer one region each, named for the landmark", () => {
    expect(regionsFor("chrome.header")).toEqual(["header"]);
    expect(regionsFor("chrome.footer")).toEqual(["footer"]);
  });

  it("gives every page the same four landmarks, in order", () => {
    for (const key of ["home", "article.index", "article.detail", "page.detail", "profile", "members"] as const) {
      expect(regionsFor(key)).toEqual(["header", "main", "aside", "footer"]);
    }
  });

  it("ships the navbar as a block in the header, with the same items as before", () => {
    const doc = parseLayoutDocument("chrome.header", DEFAULT_LAYOUTS["chrome.header"]).document;
    const [navbar, ...rest] = doc.regions.header!;
    expect(rest).toHaveLength(0);
    expect(navbar!.type).toBe("navbar");
    expect(navbar!.children!.map((c) => c.type)).toEqual([
      "logo", "navLinks", "search", "themeToggle", "headerWidgets",
      "notifications", "adminLink", "userMenu",
    ]);
  });

  /**
   * `align` replaces the old `left`/`center`/`right` regions. The START of the row is
   * the ABSENT case — never stored, for the same reason `variant` and `visibility`
   * are not: two equal layouts must compare equal, and draft-vs-live is a stringify.
   */
  it("stores align only where it is not the start of the row", () => {
    const doc = parseLayoutDocument("chrome.header", DEFAULT_LAYOUTS["chrome.header"]).document;
    const children = doc.regions.header![0]!.children!;
    expect(children.find((c) => c.type === "logo")!.align).toBeUndefined();
    expect(children.find((c) => c.type === "userMenu")!.align).toBe("right");
  });

  /** A masthead is a `section` in the header, above or below the navbar — which is
   *  the ordering the two `band*` regions used to express with two named slots. */
  it("takes a masthead section beside the navbar, either side of it", () => {
    const masthead = {
      id: "mast", type: "section",
      props: { width: "full", padding: "md", minHeight: 250 },
      children: [],
    };
    const base = DEFAULT_LAYOUTS["chrome.header"];
    for (const regions of [
      { header: [masthead, ...base.regions.header!] },
      { header: [...base.regions.header!, masthead] },
    ]) {
      const parsed = parseLayoutDocument("chrome.header", { ...base, regions });
      expect(parsed.usedDefault).toBe(false);
      expect(parsed.document.regions.header).toHaveLength(2);
    }
  });
});
