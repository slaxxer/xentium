/**
 * Which side the floating inspector takes, and — mostly — when it refuses to move.
 *
 * The panel overlays the canvas, so it can cover the block being edited. Getting out
 * of the way is the whole reason this decision exists; jumping sides for a graze is
 * the way that becomes annoying instead of helpful.
 */
import { describe, expect, it } from "vitest";
import { inspectorSideFor, type SideInput } from "./inspectorSide";

/** A 1200px stage, a 320px panel, drawn at 1:1 unless a case says otherwise. */
const at = (over: Partial<SideInput> = {}): SideInput => ({
  bounds: null,
  stageWidth: 1200,
  panelWidth: 320,
  scale: 1,
  scrollLeft: 0,
  current: "right",
  ...over,
});

describe("the inspector's side", () => {
  it("stays where it is while nothing is selected", () => {
    expect(inspectorSideFor(at({ current: "left" }))).toBe("left");
  });

  it("stays put for a block the panel does not reach", () => {
    // A block in the left half is nowhere near the right-hand panel.
    expect(inspectorSideFor(at({ bounds: { left: 20, right: 400 } }))).toBe("right");
  });

  it("moves out of the way of a block it would mostly cover", () => {
    // 880–1180 sits under the panel's 880–1200.
    expect(inspectorSideFor(at({ bounds: { left: 880, right: 1180 } }))).toBe("left");
  });

  it("does not flip for a graze", () => {
    // Only its last 40px of 400 are under the panel — 10%, and a flip would move a
    // panel the admin is reading for the sake of a sliver they can scroll to.
    expect(inspectorSideFor(at({ bounds: { left: 520, right: 920 } }))).toBe("right");
  });

  it("refuses to flip when the other side is no better", () => {
    // A full-width block is covered wherever the panel goes, so moving buys nothing.
    expect(inspectorSideFor(at({ bounds: { left: 0, right: 1200 } }))).toBe("right");
    expect(inspectorSideFor(at({ bounds: { left: 0, right: 1200 }, current: "left" }))).toBe("left");
  });

  it("comes back to the right for a block on the left", () => {
    expect(inspectorSideFor(at({ bounds: { left: 0, right: 300 }, current: "left" }))).toBe("right");
  });

  it("stays put for a block that draws nothing, rather than using a stale rectangle", () => {
    // An empty feed reports no box at all. The panel has nowhere to move away from,
    // and the previous selection's rect is not an answer about this one.
    expect(inspectorSideFor(at({ bounds: null, current: "left" }))).toBe("left");
  });

  it("counts the scroll, because that is where the block actually is", () => {
    // ⚠ At 100% an overflowing frame scrolls under the panel. A block at 880-1180 is
    // under a right-hand panel unscrolled, and clear of it once scrolled 500px left.
    const bounds = { left: 880, right: 1180 };
    expect(inspectorSideFor(at({ bounds }))).toBe("left");
    expect(inspectorSideFor(at({ bounds, scrollLeft: 500 }))).toBe("right");
  });

  it("measures the block where it is DRAWN, not where the frame thinks it is", () => {
    // ⚠ Bounds are the frame's own pixels; under Fit the frame is scaled into the
    // stage. A block at 1000–1280 of a 1280 frame is at 700–896 of a 1200 stage once
    // scaled — clear of the panel. Comparing unscaled would flip for nothing.
    const bounds = { left: 1000, right: 1280 };
    expect(inspectorSideFor(at({ bounds, scale: 0.7 }))).toBe("right");
    expect(inspectorSideFor(at({ bounds, scale: 1 }))).toBe("left");
  });
});
