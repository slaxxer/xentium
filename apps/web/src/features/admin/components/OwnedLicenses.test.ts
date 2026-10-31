/**
 * A licence row wears the product's own icon (the one picked for its store
 * listing) when this site can draw it, and the kind's generic icon when it can't:
 * never an empty tile.
 */
import { describe, expect, it } from "vitest";
import { faBullhorn, faPalette, faPuzzlePiece } from "@fortawesome/free-solid-svg-icons";
import { registerBundledIcons } from "../../../lib/iconCatalogue";
import { productGlyph, type OwnedLicense } from "./OwnedLicenses";

const product = (p: Partial<OwnedLicense["product"]>): OwnedLicense["product"] => ({
  id: "x", kind: "plugin", name: "X", vendor: "V", summary: null, latestVersion: "1.0.0", ...p,
});

describe("a licence row's icon", () => {
  it("is the listing's icon when the site has it", () => {
    registerBundledIcons([faBullhorn]);
    expect(productGlyph(product({ icon: "bullhorn" }))).toBe(faBullhorn);
  });

  it("falls back to the kind's icon for an unknown name, an old Material name or none", () => {
    expect(productGlyph(product({ icon: "no-such-icon" }))).toBe(faPuzzlePiece);
    expect(productGlyph(product({ icon: "auto_awesome" }))).toBe(faPuzzlePiece);
    expect(productGlyph(product({}))).toBe(faPuzzlePiece);
    expect(productGlyph(product({ kind: "theme", icon: null }))).toBe(faPalette);
  });
});
