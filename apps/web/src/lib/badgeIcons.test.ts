import { describe, it, expect } from "vitest";
import { BADGE_ICON_NAMES } from "@xentium/contracts";
import { BADGE_ICONS, badgeIcon } from "./badgeIcons";

/**
 * ⚠ The reason this file exists. The curated names live in `@xentium/contracts` (the
 * server validates against them) and the icon definitions live in the web app (the
 * server cannot import a React icon pack). Two lists that must agree, in two
 * packages — exactly the shape that drifts silently, because a name added to one
 * and not the other renders as a blank badge rather than an error.
 */
describe("badge glyphs", () => {
  it("draws every name the contract allows", () => {
    const missing = BADGE_ICON_NAMES.filter((n) => !BADGE_ICONS[n]);
    expect(missing).toEqual([]);
  });

  it("maps no name the contract does not allow", () => {
    const extra = Object.keys(BADGE_ICONS).filter(
      (n) => !(BADGE_ICON_NAMES as readonly string[]).includes(n),
    );
    expect(extra).toEqual([]);
  });

  it("every glyph is a real icon definition, not a stray import", () => {
    for (const name of BADGE_ICON_NAMES) {
      expect(BADGE_ICONS[name], name).toHaveProperty("iconName");
    }
  });

  /** A badge with no glyph is normal — an uploaded image is the other half. */
  it("answers null for an absent or unknown name", () => {
    expect(badgeIcon(null)).toBeNull();
    expect(badgeIcon(undefined)).toBeNull();
    expect(badgeIcon("")).toBeNull();
    expect(badgeIcon("faNotAThing")).toBeNull();
  });
});
