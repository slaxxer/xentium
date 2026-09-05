/**
 * A hand-built masthead becomes the `header` block.
 *
 * The header used to be something an admin assembled — a full-width `section` with a
 * height and a gradient, a `logo` inside it — and is one block now. Without the
 * carry-over the new block would only ever reach sites that had never touched their
 * header, and everyone else would keep a section doing the header's job with none of
 * the header's settings on it.
 *
 * The risk this file guards is the opposite one: converting a band that is NOT the
 * masthead, and silently dropping what it holds.
 */
import { describe, expect, it } from "vitest";
import type { BlockNode, LayoutDocument } from "@nodevo/contracts";
import { migrateHeaderBand } from "./headerBandMigration.js";

const doc = (header: BlockNode[]): LayoutDocument =>
  ({ templateKey: "chrome.header", schemaVersion: 1, regions: { header } } as LayoutDocument);

const navbar = (): BlockNode => ({ id: "h-navbar", type: "navbar", props: {}, children: [] });

const masthead = (props: Record<string, unknown> = {}, children: BlockNode[] = []): BlockNode => ({
  id: "mast", type: "section", children,
  props: {
    width: "full", padding: "md", minHeight: 250,
    backgroundGradient: ["#2b1055", "#7597de"], backgroundAngle: 90,
    backgroundImage: "", ...props,
  },
});

const logo = (showWordmark = true): BlockNode =>
  ({ id: "mast-logo", type: "logo", props: { showWordmark } });

describe("carrying a masthead over", () => {
  it("converts the section into the header block, in place", () => {
    const next = migrateHeaderBand(doc([masthead(), navbar()]))!;
    expect(next.regions.header!.map((b) => b.type)).toEqual(["header", "navbar"]);
  });

  it("keeps the look value for value", () => {
    const band = migrateHeaderBand(doc([masthead(), navbar()]))!.regions.header![0]!;
    expect(band.props).toMatchObject({
      height: 250,
      backgroundGradient: ["#2b1055", "#7597de"],
      backgroundAngle: 90,
    });
  });

  it("turns a logo CHILD into the logo SETTING, wordmark and all", () => {
    const band = migrateHeaderBand(doc([masthead({}, [logo(false)]), navbar()]))!.regions.header![0]!;
    expect(band.props).toMatchObject({ showLogo: true, showWordmark: false });
    expect(band.children ?? []).toHaveLength(0);
  });

  it("says so when the band never had one", () => {
    const band = migrateHeaderBand(doc([masthead(), navbar()]))!.regions.header![0]!;
    expect(band.props.showLogo).toBe(false);
  });

  /**
   * ⚠ The id is the SHIPPED one. "Has the admin customised this?" is a
   * `JSON.stringify` against the code default, so a converted header that kept its
   * own id would read as customised for ever — and a theme update would then decline
   * to touch a header nobody had actually arranged.
   */
  it("adopts the shipped id, so an untouched header still matches the default", () => {
    expect(migrateHeaderBand(doc([masthead(), navbar()]))!.regions.header![0]!.id).toBe("h-band");
  });

  it("converts a masthead that sits UNDER the navbar too", () => {
    const next = migrateHeaderBand(doc([navbar(), masthead()]))!;
    expect(next.regions.header!.map((b) => b.type)).toEqual(["navbar", "header"]);
  });
});

describe("leaving alone what is not a masthead", () => {
  it("ignores a section that holds anything but the logo", () => {
    // Converting it would delete the heading: the header block has no children.
    const withHeading = masthead({}, [{ id: "h", type: "heading", props: { text: "Hi", level: 2 } }]);
    expect(migrateHeaderBand(doc([withHeading, navbar()]))).toBeNull();
  });

  it("ignores a centred section — a band that does not span is content", () => {
    expect(migrateHeaderBand(doc([masthead({ width: "normal" }), navbar()]))).toBeNull();
  });

  it("ignores a bare full-width section with no height and no background", () => {
    const bare = masthead({ minHeight: 0, backgroundGradient: [], backgroundImage: "" });
    expect(migrateHeaderBand(doc([bare, navbar()]))).toBeNull();
  });

  it("does nothing to a header that already has the block", () => {
    const already = { id: "h-band", type: "header", props: { height: 250 } } as BlockNode;
    expect(migrateHeaderBand(doc([already, navbar()]))).toBeNull();
    // …including one where the admin has ALSO built a second band by hand, which is
    // legal and deliberate.
    expect(migrateHeaderBand(doc([already, masthead(), navbar()]))).toBeNull();
  });

  it("does nothing to a header with no blocks at all", () => {
    expect(migrateHeaderBand(doc([]))).toBeNull();
  });
});
