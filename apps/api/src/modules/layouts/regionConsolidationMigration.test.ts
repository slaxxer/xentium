/**
 * Carrying stored layouts onto the four-landmark region set.
 *
 * The failure this prevents is the worst kind: an unknown region is KEPT and skipped
 * by design, so without the carry-over a site that had saved a layout would still
 * hold every navbar block in its document and simply stop rendering them. No error,
 * no missing row — just a site with no navigation.
 *
 * The pure move functions are tested directly; the database walk around them is three
 * lines of `findMany`/`update`.
 */
import { describe, it, expect } from "vitest";
import type { LayoutDocument } from "@nodevo/contracts";
import { __test } from "./regionConsolidationMigration.js";

const { migrateChromeHeader, migrateByMove } = __test;

const n = (id: string, type: string) => ({ id, type, props: {} });

describe("chrome.header", () => {
  const old = {
    templateKey: "chrome.header", schemaVersion: 1,
    regions: {
      left:   [n("h-logo", "logo"), n("h-nav", "navLinks")],
      center: [n("h-search", "search")],
      right:  [n("h-user", "userMenu")],
    },
  } as unknown as LayoutDocument;

  it("folds the three zones into one navbar block, in reading order", () => {
    const next = migrateChromeHeader(old)!;
    expect(Object.keys(next.regions)).toEqual(["header"]);
    const navbar = next.regions.header![0]!;
    expect(navbar.type).toBe("navbar");
    expect(navbar.children!.map((c) => c.id)).toEqual(["h-logo", "h-nav", "h-search", "h-user"]);
  });

  /** The start of the row is the ABSENT case, never stored — the same rule
   *  `variant` and `visibility` follow, and what keeps two equal layouts equal. */
  it("stamps align for centre and right, and leaves left unmarked", () => {
    const children = migrateChromeHeader(old)!.regions.header![0]!.children!;
    expect(children.find((c) => c.id === "h-logo")!.align).toBeUndefined();
    expect(children.find((c) => c.id === "h-search")!.align).toBe("center");
    expect(children.find((c) => c.id === "h-user")!.align).toBe("right");
  });

  it("keeps everything else about a block — id, props, children, visibility", () => {
    const rich = {
      templateKey: "chrome.header", schemaVersion: 1,
      regions: { left: [{
        id: "keep", type: "logo", props: { showWordmark: false },
        visibility: { audience: "members" as const, groups: [] },
        variant: "accent" as const, className: "brand",
      }] },
    } as unknown as LayoutDocument;
    const moved = migrateChromeHeader(rich)!.regions.header![0]!.children![0]!;
    expect(moved).toMatchObject({
      id: "keep", props: { showWordmark: false },
      visibility: { audience: "members" }, variant: "accent", className: "brand",
    });
  });

  /**
   * ⚠ A masthead an admin had already built in a band must keep its position
   * RELATIVE to the nav strip. That ordering was the entire reason the bands existed;
   * dropping it would silently move someone's header below their navigation.
   */
  it("keeps a band's masthead on the side of the navbar it was on", () => {
    const above = migrateChromeHeader({
      templateKey: "chrome.header", schemaVersion: 1,
      regions: { bandAbove: [n("mast", "section")], left: [n("h-logo", "logo")] },
    } as unknown as LayoutDocument)!;
    expect(above.regions.header!.map((b) => b.type)).toEqual(["section", "navbar"]);

    const below = migrateChromeHeader({
      templateKey: "chrome.header", schemaVersion: 1,
      regions: { bandBelow: [n("mast", "section")], left: [n("h-logo", "logo")] },
    } as unknown as LayoutDocument)!;
    expect(below.regions.header!.map((b) => b.type)).toEqual(["navbar", "section"]);
  });

  it("leaves a document already on the new shape alone", () => {
    expect(migrateChromeHeader({
      templateKey: "chrome.header", schemaVersion: 1,
      regions: { header: [n("h-navbar", "navbar")] },
    } as unknown as LayoutDocument)).toBeNull();
  });
});

describe("chrome.footer and article.detail", () => {
  it("folds the footer's three slots into one region, in order", () => {
    const next = migrateByMove("chrome.footer", {
      templateKey: "chrome.footer", schemaVersion: 1,
      regions: { top: [n("a", "x")], main: [n("b", "x")], bottom: [n("c", "x")] },
    } as unknown as LayoutDocument)!;
    expect(Object.keys(next.regions)).toEqual(["footer"]);
    expect(next.regions.footer!.map((b) => b.id)).toEqual(["a", "b", "c"]);
  });

  /**
   * ⚠ Reading order, not concatenation. `beforeBody` came BEFORE the article —
   * appending the retired regions to the end of `main` would move an admin's intro
   * block below the thing it introduces.
   */
  it("puts beforeBody ahead of main and afterBody behind it", () => {
    const next = migrateByMove("article.detail", {
      templateKey: "article.detail", schemaVersion: 1,
      regions: {
        beforeBody: [n("intro", "x")],
        main:       [n("article", "articleDetail")],
        afterBody:  [n("outro", "x")],
        aside:      [n("side", "x")],
      },
    } as unknown as LayoutDocument)!;
    expect(next.regions.main!.map((b) => b.id)).toEqual(["intro", "article", "outro"]);
    // Untouched regions survive exactly as they were.
    expect(next.regions.aside!.map((b) => b.id)).toEqual(["side"]);
    expect(next.regions.beforeBody).toBeUndefined();
  });

  it("leaves a document with nothing to carry alone", () => {
    expect(migrateByMove("article.detail", {
      templateKey: "article.detail", schemaVersion: 1,
      regions: { main: [n("article", "articleDetail")] },
    } as unknown as LayoutDocument)).toBeNull();
    expect(migrateByMove("home", {
      templateKey: "home", schemaVersion: 1, regions: { main: [] },
    } as unknown as LayoutDocument)).toBeNull();
  });
});
