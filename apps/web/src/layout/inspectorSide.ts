/**
 * Which side of the canvas the floating inspector sits on.
 *
 * The inspector overlays the preview rather than taking a grid column, so the canvas
 * keeps its full width and — the reason it is an overlay and not a collapsing rail —
 * never REFLOWS when a block is selected. A rail that appears and disappears changes
 * the stage width, which changes the Fit scale, which visibly re-scales the whole page
 * on every click. Nothing about the canvas moves here; only the panel does.
 *
 * The cost of overlaying is that the panel can cover the very block being edited —
 * home's right rail sits exactly where the panel wants to be. So it moves out of the
 * way, and this decides when.
 */

/** A selected block's horizontal extent, in the PREVIEW frame's own coordinates. */
export interface BlockBounds {
  left: number;
  right: number;
}

export interface SideInput {
  /** The block's extent, or null while nothing is selected. */
  bounds: BlockBounds | null;
  /** Width of the visible canvas, in editor pixels. */
  stageWidth: number;
  /** How much of the canvas the panel covers. */
  panelWidth: number;
  /** The Fit scale the frame is drawn at — bounds are in unscaled frame pixels. */
  scale: number;
  /**
   * How far the stage is scrolled sideways.
   *
   * ⚠ At 100% a frame wider than the pane overflows and the stage scrolls, so where
   * a block IS on screen is not where it is in the frame. Without this the panel
   * reasons about a position the admin cannot see. Read once, when the selection's
   * bounds arrive — the side is decided when a block is selected, not continuously
   * as someone pans.
   */
  scrollLeft: number;
  /** Where the panel is now, so an unforced decision can stay put. */
  current: Side;
}

export type Side = "left" | "right";

/**
 * How much of the block must be hidden before the panel gets out of the way.
 *
 * ⚠ A threshold, not "any overlap at all". The panel would otherwise flip on every
 * selection that grazes its edge, and a panel that jumps sides while an admin is
 * reading it is worse than one covering a strip of something they can scroll to.
 */
const COVERED_ENOUGH = 0.5;

/** How much of `bounds` the panel hides, as a fraction of the block's own width. */
function coveredFraction(
  bounds: BlockBounds, stageWidth: number, panelWidth: number, scale: number,
  scrollLeft: number, side: Side,
): number {
  // Bounds arrive in the frame's own pixels; the panel is measured in the editor's,
  // against a stage that may be scrolled under it.
  const left = bounds.left * scale - scrollLeft;
  const right = bounds.right * scale - scrollLeft;
  const width = right - left;
  if (width <= 0) return 0;

  const panelStart = side === "right" ? stageWidth - panelWidth : 0;
  const panelEnd = side === "right" ? stageWidth : panelWidth;

  const overlap = Math.min(right, panelEnd) - Math.max(left, panelStart);
  return overlap <= 0 ? 0 : Math.min(1, overlap / width);
}

/**
 * The side to draw the inspector on.
 *
 * Right by default — it is where the settings for a thing conventionally live, and
 * where this editor's rail was. It moves left only when staying would hide most of
 * the selected block AND moving actually helps: a block wider than the gap the panel
 * leaves is covered on both sides, and flipping would be motion for nothing.
 */
export function inspectorSideFor(input: SideInput): Side {
  const { bounds, stageWidth, panelWidth, scale, scrollLeft, current } = input;
  // No bounds means the selection has not reported a box — either it has only just
  // changed, or the block DRAWS NOTHING (an empty feed, a widget with no rows), which
  // has no position to get out of the way of. Staying put is the only honest answer;
  // deciding from the last block's rectangle would move the panel for a shape that is
  // not on screen.
  if (!bounds || stageWidth <= 0) return current;

  const here = coveredFraction(bounds, stageWidth, panelWidth, scale, scrollLeft, current);
  if (here < COVERED_ENOUGH) return current;

  const other: Side = current === "right" ? "left" : "right";
  const there = coveredFraction(bounds, stageWidth, panelWidth, scale, scrollLeft, other);
  return there < here ? other : current;
}
