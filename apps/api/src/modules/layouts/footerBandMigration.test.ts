/**
 * A stored footer's pieces move INSIDE the `footer` block.
 *
 * The footer's band used to be a hardcoded `<div class="nv-foot">` in `SiteFooter`,
 * with `chrome.footer` holding the four pieces as loose leaves. The band is a block
 * now and `SiteFooter` no longer wraps anything, so a document that still keeps its
 * pieces at region level renders them unpainted — and gives an admin who clicks "the
 * footer" nothing to select, which is the whole reason the block exists.
 *
 * The risks this file guards are the two ways a wrap can go wrong: losing something
 * on the way in, and wrapping a footer that is already wrapped.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAYOUTS, MAX_BLOCK_DEPTH,
  type BlockNode, type LayoutDocument,
} from "@nodevo/contracts";
import { migrateFooterBand } from "./footerBandMigration.js";

const doc = (footer: BlockNode[]): LayoutDocument =>
  ({ templateKey: "chrome.footer", schemaVersion: 1, regions: { footer } } as LayoutDocument);

const piece = (id: string, type: string, props: Record<string, unknown> = {}): BlockNode =>
  ({ id, type, props });

const shipped = (): BlockNode[] => [
  piece("f-online", "whosOnline", { maxNames: 20 }),
  piece("f-legend", "groupLegend"),
  piece("f-stats", "boardStats"),
  piece("f-brand", "branding", { showUptime: true }),
];

describe("carrying a footer over", () => {
  it("wraps the region's children in one band", () => {
    const next = migrateFooterBand(doc(shipped()))!;
    expect(next.regions.footer!.map((b) => b.type)).toEqual(["footer"]);
    expect(next.regions.footer![0]!.children!.map((b) => b.type))
      .toEqual(["whosOnline", "groupLegend", "boardStats", "branding"]);
  });

  it("keeps the look the hardcoded wrapper had", () => {
    // No gradient of its own: the band inherits `--footer-bg` from the Style Editor,
    // which is what the site is already wearing. A migration that changed how a
    // footer LOOKS would be a redesign nobody asked for.
    expect(migrateFooterBand(doc(shipped()))!.regions.footer![0]!.props)
      .toEqual({ showTopBorder: true });
  });

  it("produces the code default exactly, for a footer nobody has touched", () => {
    // ⚠ `props` is a PASSTHROUGH record — parsing does not fill a block's defaults —
    // so "customised?" and "pending publish?" are a stringify against the literal
    // default. A band written with the full prop set draws identically and compares
    // unequal, which marks an untouched footer as customised for ever.
    expect(JSON.stringify(migrateFooterBand(doc(shipped()))!.regions.footer))
      .toBe(JSON.stringify(DEFAULT_LAYOUTS["chrome.footer"].regions.footer));
  });

  it("uses the shipped default's id, so an untouched footer still reads as untouched", () => {
    // "Has the admin customised this?" is a stringify against the code default —
    // a different id here would mark every migrated site as customised for ever.
    expect(migrateFooterBand(doc(shipped()))!.regions.footer![0]!.id).toBe("f-band");
  });

  it("carries a piece's props and its audience across untouched", () => {
    const restricted: BlockNode =
      { ...piece("f-online", "whosOnline", { maxNames: 5 }), visibility: { audience: "members", groups: [] } };
    const band = migrateFooterBand(doc([restricted]))!.regions.footer![0]!;
    expect(band.children![0]).toEqual(restricted);
  });

  it("keeps an admin's own arrangement, order included", () => {
    const custom = [piece("brand", "branding"), piece("stats", "boardStats")];
    expect(migrateFooterBand(doc(custom))!.regions.footer![0]!.children).toEqual(custom);
  });
});

describe("leaving a footer alone", () => {
  it("does nothing to a footer that already has a band", () => {
    expect(migrateFooterBand(doc([
      { ...piece("f-band", "footer"), children: shipped() },
    ]))).toBeNull();
  });

  it("does nothing to an empty footer, or one with no region at all", () => {
    expect(migrateFooterBand(doc([]))).toBeNull();
    expect(migrateFooterBand({ templateKey: "chrome.footer", schemaVersion: 1, regions: {} } as LayoutDocument))
      .toBeNull();
  });

  it("refuses rather than producing a tree the API would reject", () => {
    // Wrapping adds a level. Nothing anyone builds comes near the limit, but a
    // document that WOULD exceed it must be left renderable rather than converted
    // into one that cannot be saved.
    let deep: BlockNode = piece("leaf", "branding");
    for (let i = 0; i < MAX_BLOCK_DEPTH - 1; i++) {
      deep = { ...piece(`s${i}`, "section", { width: "normal" }), children: [deep] };
    }
    expect(migrateFooterBand(doc([deep]))).toBeNull();
  });
});
