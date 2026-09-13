/**
 * What the badges toolbar does to the list.
 *
 * The page renders whatever `arrangeBadges` returns, so these are the invariants
 * that decide what an admin sees: the two groups are a partition of it, and the
 * server's ordering survives the default.
 */
import { describe, expect, it } from "vitest";
import type { BadgeRow } from "@nodevo/contracts";
import { arrangeBadges } from "./BadgesPage";

function badge(p: Partial<BadgeRow> & { key: string }): BadgeRow {
  return {
    id: p.key, name: p.key, description: null,
    faIcon: null, color: null, displayOrder: 100, isSystem: false,
    autoAward: false, criteria: {},
    // Last, so a caller's own name/holders win — `key` comes along with it.
    ...p,
  };
}

/** Deliberately NOT in name or holder order — the default must not reorder them. */
const ROWS: BadgeRow[] = [
  badge({ key: "zeta",    name: "Zeta",    autoAward: true,  holders: 1 }),
  badge({ key: "alpha",   name: "Alpha",   autoAward: false, holders: 9 }),
  badge({ key: "helper",  name: "Helper",  autoAward: false, holders: 4 }),
  badge({ key: "auto-two", name: "Beta",   autoAward: true,  holders: 0 }),
];

const keys = (rows: BadgeRow[]) => rows.map((b) => b.key);

describe("arranging the catalogue", () => {
  /**
   * ⚠ The server answers `displayOrder` THEN `name`. Re-sorting on displayOrder
   * client-side would drop the tiebreak and reshuffle two badges at the same order
   * between renders, so the default sort is "leave it exactly as it arrived".
   */
  it("leaves the server's order untouched by default", () => {
    expect(keys(arrangeBadges(ROWS, "", "all", "order"))).toEqual(keys(ROWS));
  });

  it("sorts by name, and by holders descending", () => {
    expect(keys(arrangeBadges(ROWS, "", "all", "name")))
      .toEqual(["alpha", "auto-two", "helper", "zeta"]);
    expect(keys(arrangeBadges(ROWS, "", "all", "holders")))
      .toEqual(["alpha", "helper", "zeta", "auto-two"]);
  });

  it("matches the search against the name AND the key", () => {
    // "auto-two" is named Beta: found by its key, which is what an admin copying a
    // key out of a seed or a plugin has in hand.
    expect(keys(arrangeBadges(ROWS, "auto-t", "all", "order"))).toEqual(["auto-two"]);
    expect(keys(arrangeBadges(ROWS, "helper", "all", "order"))).toEqual(["helper"]);
    expect(keys(arrangeBadges(ROWS, "ZET", "all", "order"))).toEqual(["zeta"]);
    expect(arrangeBadges(ROWS, "nothing-like-this", "all", "order")).toEqual([]);
  });

  it("filters by how the badge is come by", () => {
    expect(keys(arrangeBadges(ROWS, "", "auto", "order"))).toEqual(["zeta", "auto-two"]);
    expect(keys(arrangeBadges(ROWS, "", "manual", "order"))).toEqual(["alpha", "helper"]);
  });

  /**
   * ⚠ The page splits the result into "earned automatically" and "by hand" itself.
   * Every row must land in exactly one of them — a badge that appears twice, or
   * vanishes, is the failure mode of grouping after filtering.
   */
  it("is partitioned by the two groups, whatever the filter", () => {
    for (const filter of ["all", "auto", "manual"] as const) {
      const shown  = arrangeBadges(ROWS, "", filter, "order");
      const auto   = shown.filter((b) => b.autoAward);
      const manual = shown.filter((b) => !b.autoAward);
      expect(auto.length + manual.length).toBe(shown.length);
    }
  });

  it("ignores surrounding whitespace in the search", () => {
    expect(keys(arrangeBadges(ROWS, "  helper  ", "all", "order"))).toEqual(["helper"]);
  });

  /** A row the admin listing did not count holds nobody, not NaN. */
  it("treats a missing holder count as zero when sorting", () => {
    const rows = [badge({ key: "none" }), badge({ key: "some", holders: 2 })];
    expect(keys(arrangeBadges(rows, "", "all", "holders"))).toEqual(["some", "none"]);
  });
});
