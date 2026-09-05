/**
 * A page's own bands fold into its body.
 *
 * The regions are gone — a page is a body and a rail — and an undeclared region is
 * KEPT and skipped by design, so without this a site that had put a block above its
 * body would keep it in the document and simply stop rendering it. Silent, and
 * indistinguishable from the block having been deleted.
 */
import { describe, expect, it } from "vitest";
import type { BlockNode, LayoutDocument } from "@nodevo/contracts";
import { migratePageBands } from "./pageBandMigration.js";

const block = (id: string): BlockNode => ({ id, type: "heading", props: { text: id, level: 2 } });

const doc = (regions: Record<string, BlockNode[]>): LayoutDocument =>
  ({ templateKey: "home", schemaVersion: 1, regions } as LayoutDocument);

const types = (d: LayoutDocument | null, region: string) =>
  (d?.regions as Record<string, BlockNode[] | undefined>)[region]?.map((b) => b.id);

describe("folding the bands in", () => {
  /** ⚠ ORDER is the whole point. Appending both would move an intro under the body. */
  it("puts the band above the body FIRST and the one below it LAST", () => {
    const next = migratePageBands(doc({
      header: [block("above")],
      main:   [block("body")],
      footer: [block("below")],
    }))!;
    expect(types(next, "main")).toEqual(["above", "body", "below"]);
  });

  it("leaves the rail alone", () => {
    const next = migratePageBands(doc({
      header: [block("above")], main: [block("body")], aside: [block("rail")],
    }))!;
    expect(types(next, "aside")).toEqual(["rail"]);
  });

  it("removes the region keys, so the document matches the template's set", () => {
    const next = migratePageBands(doc({ header: [block("above")], main: [] }))!;
    expect(Object.keys(next.regions)).not.toContain("header");
    expect(Object.keys(next.regions)).not.toContain("footer");
  });

  it("carries a whole subtree, not just top-level blocks", () => {
    const section: BlockNode = {
      id: "sec", type: "section", props: { width: "full" },
      children: [block("inside")],
    };
    const next = migratePageBands(doc({ header: [section], main: [] }))!;
    expect(types(next, "main")).toEqual(["sec"]);
    expect((next.regions.main![0]!.children ?? []).map((c) => c.id)).toEqual(["inside"]);
  });

  it("works for a page that had a band and no body blocks at all", () => {
    const next = migratePageBands(doc({ header: [block("above")] }))!;
    expect(types(next, "main")).toEqual(["above"]);
  });
});

describe("leaving alone what needs nothing", () => {
  /**
   * ⚠ An EMPTY band is still dropped, keys and all. "Is this customised?" is a
   * `JSON.stringify` against the code default, and a stray empty region would answer
   * yes for ever — so a theme update would decline to touch a page nobody had
   * arranged.
   */
  it("drops empty band keys rather than leaving them in the document", () => {
    const next = migratePageBands(doc({ header: [], main: [block("body")], footer: [] }))!;
    expect(Object.keys(next.regions).sort()).toEqual(["main"]);
    expect(types(next, "main")).toEqual(["body"]);
  });

  it("does nothing at all to a document that never had the keys", () => {
    expect(migratePageBands(doc({ main: [block("body")], aside: [] }))).toBeNull();
  });
});

describe("the empty leftovers of an earlier move", () => {
  /**
   * ⚠ ONE stray empty key makes an untouched page read as CUSTOMISED for ever, because
   * that question is a `JSON.stringify` against the code default — and a theme update
   * then declines to touch the page. The region consolidation left exactly this behind
   * on `article.detail`.
   */
  it("drops an empty region the template no longer declares", () => {
    const next = migratePageBands({
      templateKey: "article.detail", schemaVersion: 1,
      regions: { main: [block("body")], beforeBody: [], afterBody: [] },
    } as unknown as LayoutDocument)!;
    expect(Object.keys(next.regions).sort()).toEqual(["main"]);
  });

  it("KEEPS an undeclared region that still holds blocks", () => {
    // A plugin whose template is not registered right now still owns that work:
    // disabling a plugin must never delete an admin's layout.
    const next = migratePageBands({
      templateKey: "article.detail", schemaVersion: 1,
      regions: { main: [], beforeBody: [block("kept")], header: [block("above")] },
    } as unknown as LayoutDocument)!;
    expect(Object.keys(next.regions).sort()).toEqual(["beforeBody", "main"]);
    expect(types(next, "main")).toEqual(["above"]);
  });
});
