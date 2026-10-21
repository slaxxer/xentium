import { describe, expect, it } from "vitest";
import { migrateEdgeSeasons } from "./edgeSeasonMigration.js";

const season = { from: "10-01", to: "11-01" };
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fixtures walk loose JSON
type Loose = any;
const doc = (regions: Record<string, unknown[]>) => ({ templateKey: "chrome.header", schemaVersion: 1, regions });

describe("edge season carry-over", () => {
  it("moves a season under ext.fx, in nested blocks too, and touches nothing else", () => {
    const before = doc({
      header: [
        { id: "a", type: "navbar", props: {}, edges: { bottom: { shape: "drips", season, ext: { fx: { glow: true } } } } },
        { id: "s", type: "section", props: {}, children: [
          { id: "b", type: "logo", props: {}, edges: { top: { shape: "wave", season } } },
        ] },
      ],
    });
    const after = migrateEdgeSeasons(before)!;
    const header = (after.regions as Record<string, Loose[]>).header!;
    expect(header[0].edges.bottom).toEqual({ shape: "drips", ext: { fx: { glow: true, season } } });
    expect(header[1].children[0].edges.top).toEqual({ shape: "wave", ext: { fx: { season } } });
    expect(header[1].props).toEqual({});
  });

  it("keeps the plugin's own dates when both are there", () => {
    const own = { from: "12-01", to: "12-31" };
    const after = migrateEdgeSeasons(doc({ header: [
      { id: "a", type: "navbar", props: {}, edges: { top: { shape: "wave", season, ext: { fx: { season: own } } } } },
    ] }))!;
    expect((after.regions as Record<string, Loose[]>).header![0].edges.top).toEqual({ shape: "wave", ext: { fx: { season: own } } });
  });

  it("writes nothing when there is no season", () => {
    expect(migrateEdgeSeasons(doc({ header: [{ id: "a", type: "navbar", props: {}, edges: { top: { shape: "wave" } } }] }))).toBeNull();
    expect(migrateEdgeSeasons(null)).toBeNull();
  });
});
