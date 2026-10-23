/**
 * Editor ⇄ preview bridge (ADR-0005).
 *
 * The preview is a real route in an iframe, so it is a separate document with its
 * own JS context. This module runs INSIDE that document and talks to the editor
 * over `postMessage`:
 *
 *   preview → editor   nv:select      an admin clicked a block
 *                      nv:move        an admin dragged a block to a new position
 *                      nv:insert      an admin dropped a NEW block from the library
 *                      nv:insertAfter an admin pressed the `+` under a block
 *                      nv:nudge       the chip's up/down
 *                      nv:iconPick    an admin clicked ONE icon, while icon mode is on
 *                      nv:inlineEdit  an admin typed new text into a block on the page
 *   editor  → preview  nv:iconMode    turn icon picking on or off
 *                      nv:highlight   the tree selection changed (with its breadcrumb)
 *                      nv:dragNew     a library tile is being dragged — its type
 *                      nv:insertMark  where the next library pick lands, or nothing
 *                      nv:tokens      staged variant tokens, so a colour edit is
 *                                     visible before it is published
 *                      nv:changes     which blocks publishing would change, and
 *                                     whether to mark them
 *
 * Why an overlay instead of styling the block: each block is wrapped in a
 * `display: contents` element so the preview's layout is identical to the live
 * page. Such a wrapper has no box of its own, so it cannot show an outline —
 * instead the bridge measures the block's first real element and draws a
 * separate, absolutely positioned frame over it. Nothing about the page's own
 * styling is touched, which is the point: the preview must not lie.
 *
 * Dragging a block happens entirely within this document (both source and target
 * are here), so it uses ordinary HTML5 drag events. Only the RESULT crosses the
 * frame boundary, as a single `nv:move` message — the editor owns the document
 * and remains the single source of truth.
 *
 * A NEW block is dragged from the editor's library, outside this document. The
 * browser delivers that drag's events in here all the same (same origin), but a
 * drag's data cannot be read until it is dropped — so the editor announces the
 * block's type with `nv:dragNew` when the drag starts, and this document resolves
 * the landing spot with exactly the rules a move uses. The drop comes back as
 * `nv:insert`.
 *
 * ## Where a drop lands (ADR-0012)
 *
 * Every place the dragged block could go is worked out when the drag STARTS and
 * drawn as a faint line (or, for an empty column, a dashed box); the one nearest the
 * pointer is drawn solid, and that is where the drop lands. One answer per pixel,
 * and the admin sees all of them before letting go.
 *
 * It replaced "the nearest container under the pointer", which could not place a
 * block as a container's sibling and turned the same pixel into "inside this
 * column", "after this column" or "after the row" depending on a few pixels of
 * padding — the reason dragging felt unreliable.
 *
 * A section (or a `columns` row) only ever goes between sections: the top of a
 * region, or the list it already sits in. Blocks go wherever a list accepts them.
 */

import type { AudienceView, LayoutDocument, TemplateKey } from "@xentium/contracts";
import { acceptsChild } from "./blockRegistry";
import { shortcutFor } from "./editorShortcuts";
import { setLivePreviewDocument, setPreviewAudience } from "./useLayout";
import { setLivePreviewFrame } from "./siteFrame";
import { setPreviewDate, setPreviewHour } from "./edgeArt";

/**
 * ⚠ Icon mode HIJACKS the click, so it is off by default and the editor turns it on
 * explicitly. Clicking an icon otherwise has to keep selecting its block — that is
 * how an admin reaches the block a navbar icon belongs to.
 */
let iconMode = false;

const OVERLAY_ID = "xt-preview-overlay";
const TOKENS_ID = "xt-preview-tokens";
const LABEL_ID = "xt-preview-label";
const LINE_ID = "xt-preview-dropline";
const ZONE_ID = "xt-preview-dropzone";
const PLUS_ID = "xt-preview-plus";
const MARK_ID = "xt-preview-insertmark";
const SPOTS_ID = "xt-preview-spots";
const CHANGES_ID = "xt-preview-changes";

/** Types that are SECTIONS to the editor: they only ever go between sections. */
const SECTION_TYPES = new Set(["section", "columns"]);

/** Farther than this from every spot, a drop goes nowhere. */
const SPOT_REACH = 180;

/**
 * One place a drag can land, in PAGE coordinates (so scrolling does not move it).
 * `kind` is how it is drawn: a line across a list, a line down between items laid
 * out side by side, or the box of an empty list.
 */
export interface DropSpot {
  region: string;
  parentId: string | null;
  index: number;
  beforeId: string | null;
  afterId: string | null;
  kind: "line" | "across" | "box";
  x: number; y: number; w: number; h: number;
  /** The list's own box, for the zone outline and the "pointer is inside" bias. */
  parent: { x: number; y: number; w: number; h: number };
}

/**
 * Every spot a block of `type` could be dropped at, in the open document.
 *
 * Exported for its tests. `dragged` is the block being moved (null for a new one):
 * nothing can land inside it, and the two spots either side of it are skipped because
 * dropping there would be no move at all.
 */
export function collectDropSpots(
  type: string,
  dragged: HTMLElement | null,
  template: string | null,
): DropSpot[] {
  const sx = window.scrollX, sy = window.scrollY;
  const sectionLevel = SECTION_TYPES.has(type);
  const parents = [
    ...document.querySelectorAll<HTMLElement>("[data-xt-region]:not([data-xt-block])"),
    ...allWrappers().filter((el) => el.dataset.xtContainer),
  ].filter((el) => !template || el.dataset.xtTemplate === template);

  const out: DropSpot[] = [];
  for (const el of parents) {
    const parentId = el.dataset.xtBlock ?? null;
    const region = el.dataset.xtRegion;
    if (!region) continue;
    if (dragged && (dragged === el || dragged.contains(el))) continue;
    if (!acceptsChild(el.dataset.xtType ?? null, type)) continue;
    // A section stays a section: between sections, or where it already is.
    if (sectionLevel && parentId !== null && dragged?.dataset.xtParent !== parentId) continue;

    const own = parentId ? boxOf(el) : el.getBoundingClientRect();
    if (!own || (own.width === 0 && own.height === 0)) continue;
    const parent = { x: own.left + sx, y: own.top + sy, w: own.width, h: own.height };

    const all = childrenOf(parentId, region);
    const kids = all
      .map((w) => ({ w, r: boxOf(w) }))
      .filter((k): k is { w: HTMLElement; r: DOMRect } => !!k.r);

    if (kids.length === 0) {
      if (all.some((w) => w === dragged)) continue; // its only child is the one moving
      out.push({ region, parentId, index: all.length, beforeId: null, afterId: null, kind: "box", ...parent, parent });
      continue;
    }

    // Side by side (a navbar, a row of tracks) or stacked: read from the first two.
    const across = kids.length > 1 && kids[1]!.r.left >= kids[0]!.r.right - 2
      && Math.abs(kids[1]!.r.top - kids[0]!.r.top) < kids[0]!.r.height;

    for (let i = 0; i <= kids.length; i++) {
      const prev = kids[i - 1];
      const next = kids[i];
      if (dragged && (prev?.w === dragged || next?.w === dragged)) continue;
      const index = next ? all.indexOf(next.w) : all.length;
      const ids = { beforeId: next?.w.dataset.xtBlock ?? null, afterId: prev?.w.dataset.xtBlock ?? null };
      if (across) {
        const top = Math.min(...kids.map((k) => k.r.top));
        const bottom = Math.max(...kids.map((k) => k.r.bottom));
        const x = prev && next ? (prev.r.right + next.r.left) / 2 : prev ? prev.r.right + 3 : next!.r.left - 3;
        out.push({ region, parentId, index, ...ids, kind: "across", x: x + sx, y: top + sy, w: 0, h: bottom - top, parent });
      } else {
        const y = prev && next ? (prev.r.bottom + next.r.top) / 2 : prev ? prev.r.bottom + 3 : next!.r.top - 3;
        out.push({ region, parentId, index, ...ids, kind: "line", x: own.left + sx, y: y + sy, w: own.width, h: 0, parent });
      }
    }
  }
  return out;
}

/** How far the pointer (page coordinates) is from a spot; lower wins. */
export function spotDistance(s: DropSpot, px: number, py: number): number {
  const outside = (v: number, lo: number, hi: number) => (v < lo ? lo - v : v > hi ? v - hi : 0);
  const inParent = px >= s.parent.x && px <= s.parent.x + s.parent.w && py >= s.parent.y && py <= s.parent.y + s.parent.h;
  // A list the pointer is inside beats an equally near one it is not: hovering a
  // column's last block aims at that column, not at the gap under the whole row.
  const bias = inParent ? 0 : 24;
  if (s.kind === "box") return outside(px, s.x, s.x + s.w) + outside(py, s.y, s.y + s.h) + bias;
  if (s.kind === "across") return Math.abs(px - s.x) + outside(py, s.y, s.y + s.h) * 1.5 + bias;
  return Math.abs(py - s.y) + outside(px, s.x, s.x + s.w) * 1.5 + bias;
}

export function nearestSpot(spots: DropSpot[], px: number, py: number): DropSpot | null {
  let best: DropSpot | null = null;
  let bestD = SPOT_REACH;
  for (const s of spots) {
    const d = spotDistance(s, px, py);
    if (d < bestD) { best = s; bestD = d; }
  }
  return best;
}

/** The chip's glyphs. Constant SVG, so setting them as markup injects nothing. */
const GLYPH = {
  up:   '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
  duplicate: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/></svg>',
  remove: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
} as const;

type Msg =
  /**
   * `templateKey` names the document the block belongs to. A page's preview also
   * renders the site header and footer, and those are as much part of the page as
   * its body — clicking one of their blocks opens THAT document in the editor
   * instead of addressing an id the open one does not contain.
   */
  | { source: "xt-preview"; type: "select"; id: string; templateKey?: string }
  | {
      source: "xt-preview";
      type: "move";
      id: string;
      region: string;
      /** Container the block should land in, or null for the region itself. */
      parentId: string | null;
      index: number;
      /**
       * The neighbours the drop sits between. The editor places by THESE when it has
       * them: the page may not draw every block in a list (another audience's, one
       * that rendered nothing), so a count of what is on screen is not an index into
       * the document.
       */
      beforeId?: string | null;
      afterId?: string | null;
    }
  /** A keystroke this document swallowed that belongs to the editor around it. */
  | { source: "xt-preview"; type: "shortcut"; action: "undo" | "redo" }
  /**
   * Where the SELECTED block sits, so the floating inspector can move out of its way.
   *
   * In this frame's own pixels — the editor knows the scale it draws the frame at and
   * the panel's width, and neither is knowable from in here.
   */
  | { source: "xt-preview"; type: "bounds"; id: string; left: number; right: number }
  /**
   * The selected block's own actions, taken from the chip on the page.
   *
   * The tree has carried these all along; the canvas has not, so acting on a block
   * you can SEE meant finding its row first. Both end in the same editor call.
   */
  | { source: "xt-preview"; type: "duplicate"; id: string }
  | { source: "xt-preview"; type: "remove"; id: string }
  /** The chip's up/down: one step within the block's own list. */
  | { source: "xt-preview"; type: "nudge"; id: string; delta: number }
  /** A library block was dropped here: what, and where, in the editor's terms. */
  | {
      source: "xt-preview";
      type: "insert";
      blockType: string;
      region: string;
      parentId: string | null;
      index: number;
      beforeId?: string | null;
      afterId?: string | null;
      /** A ready-made section from the library, rather than one block. */
      preset?: string;
    }
  /** Text typed straight onto the page, for one prop of one block. */
  | { source: "xt-preview"; type: "inlineEdit"; id: string; prop: string; value: string }
  /** The `+` under a block: the next library pick goes straight after it. */
  | { source: "xt-preview"; type: "insertAfter"; id: string }
  /**
   * This document's bridge is listening.
   *
   * ⚠ The editor pushes state on the iframe's `load` event, which fires BEFORE the
   * React app inside has mounted and attached this listener — so everything sent
   * then is dropped. The document survives only because it is re-pushed whenever it
   * changes; anything pushed once, like icon mode, was simply lost. Announcing
   * readiness is what makes the hand-off reliable for all of it.
   */
  | { source: "xt-preview"; type: "ready" }
  /** An empty region was clicked — open the add-block picker for it. */
  | { source: "xt-preview"; type: "addTo"; region: string; templateKey?: string }
  /**
   * An ICON was clicked, while icon mode is on.
   *
   * `slot` is `"<icon-name>#<n>"` within `id` — the nth icon of that name that block
   * drew. That is what makes ONE icon addressable rather than every icon of that
   * name, and it is stored on the block so it publishes with the layout draft.
   */
  | { source: "xt-preview"; type: "iconPick"; id: string; slot: string; templateKey?: string };

const post = (msg: Msg) => window.parent?.postMessage(msg, window.location.origin);

/** The block's first real element — the `display: contents` wrapper has no box. */
function boxOf(wrapper: Element): DOMRect | null {
  const el = wrapper.querySelector(":scope > *");
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return rect.width === 0 && rect.height === 0 ? null : rect;
}

/** Every block wrapper, in document order — which is also tree order. */
const allWrappers = (): HTMLElement[] =>
  [...document.querySelectorAll("[data-xt-block]")] as HTMLElement[];

// `childrenOf` is exported for its tests, which run it against DOM the real renderer
// produced. Nesting broke it once — `:scope >` silently finds an empty sibling list
// the moment anything is nested — so it is worth pinning down directly.

/** Looked up by scanning rather than by selector: a block id comes from a stored
 *  document, so it is not guaranteed to be safe to interpolate into one. */
const wrapperById = (id: string): HTMLElement | null =>
  allWrappers().find((el) => el.dataset.xtBlock === id) ?? null;

/**
 * A drop parent's direct children.
 *
 * Parentage is read from `data-xt-parent`, which the renderer stamps, because a
 * container's real element sits between its wrapper and its children's wrappers —
 * so `:scope > [data-xt-block]` matches nothing once anything is nested.
 */
export const childrenOf = (parentId: string | null, region: string): HTMLElement[] =>
  allWrappers().filter((el) =>
    parentId == null
      ? el.dataset.xtParent === "" && el.dataset.xtRegion === region
      : el.dataset.xtParent === parentId,
  );

function ensure(id: string, className: string): HTMLElement {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("div");
    el.id = id;
    el.className = className;
    document.body.appendChild(el);
  }
  return el;
}

const REOPEN_KEY = "xt-preview-reopen";

/**
 * Open again the dropdown whose trigger was clicked just before this preview loaded
 * (see the click handler). Waits for the block to render; gives up after a few
 * seconds, and ignores a note older than that — it belongs to a click, not a visit.
 */
function reopenTrigger(): () => void {
  // ⚠ The note is removed only once it is used or stale, never on read: in dev,
  // StrictMode installs the bridge twice and the first install's cleanup would
  // otherwise take the note with it.
  const forget = () => { try { sessionStorage.removeItem(REOPEN_KEY); } catch { /* ignore */ } };
  let note: { id?: string; index?: number; at?: number } | null = null;
  try { note = JSON.parse(sessionStorage.getItem(REOPEN_KEY) ?? "null"); } catch { /* nothing to reopen */ }
  if (!note?.id || typeof note.index !== "number") return () => {};
  const { id, index, at = 0 } = note;
  const timer = window.setInterval(() => {
    if (Date.now() - at > 5000) { forget(); window.clearInterval(timer); return; }
    const w = document.querySelector(`[data-xt-block="${CSS.escape(id)}"]`);
    const btn = w?.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")[index];
    if (btn) {
      forget();
      window.clearInterval(timer);
      if (btn.getAttribute("aria-expanded") === "false") btn.click();
    }
  }, 150);
  return () => window.clearInterval(timer);
}

export function installPreviewBridge(): () => void {
  const overlay = ensure(OVERLAY_ID, "xt-preview-overlay");
  const label = ensure(LABEL_ID, "xt-preview-label");
  const line = ensure(LINE_ID, "xt-preview-dropline");
  const zone = ensure(ZONE_ID, "xt-preview-dropzone");
  const mark = ensure(MARK_ID, "xt-preview-insertmark");
  const spotLayer = ensure(SPOTS_ID, "xt-preview-spots");
  const changeLayer = ensure(CHANGES_ID, "xt-preview-changes");
  const plus = (() => {
    let el = document.getElementById(PLUS_ID) as HTMLButtonElement | null;
    if (!el) {
      el = document.createElement("button");
      el.id = PLUS_ID;
      el.type = "button";
      el.className = "xt-preview-plus";
      el.textContent = "+";
      document.body.appendChild(el);
    }
    return el;
  })();

  let hovered: HTMLElement | null = null;
  let selectedId: string | null = null;
  /**
   * What the chip says and offers for the SELECTED block.
   *
   * Sent by the editor with the highlight, because neither fact is knowable in here:
   * the label lives in the block registry's `editorMeta`, and whether a block may be
   * removed is a rule about the TEMPLATE (`REQUIRED_BLOCKS`) that this document has
   * never been told. A chip offering a delete the editor would refuse is worse than
   * no chip.
   */
  let selectedLabel: string | null = null;
  let selectedRemovable = false;
  /**
   * What to CALL each audience, sent by the editor.
   *
   * This document is the site, and the words are in the ACP bundle, which the site
   * has no reason to load. Sending three strings beats making the preview pull an
   * admin namespace, and beats printing the raw key at an admin in five languages.
   */
  let audienceLabels: Record<string, string> = {};
  /** The selection whose bounds the editor already has. */
  let reportedFor: string | null = null;
  let dragId: string | null = null;
  let drop: DropSpot | null = null;
  /** Every place the current drag can land, worked out once when it starts. */
  let spots: DropSpot[] = [];
  /** The library block being dragged in from the editor, announced by `nv:dragNew`. */
  let newType: string | null = null;
  /** …and the ready-made section it is, when it is one. */
  let newPreset: string | null = null;
  /** Blocks publishing would change, and whether the editor wants them marked. */
  let changedIds: string[] = [];
  let showChanges = false;
  /** The block whose text is being typed on the page, while it is. */
  let inline: { el: HTMLElement; box: HTMLElement; id: string; prop: string; original: string } | null = null;
  /** The open document's template key, from the pushed document. */
  let openTemplate: string | null = null;
  /** The selected block's ancestors then itself, and whether it can move up/down. */
  let crumbs: { id: string; label: string }[] = [];
  let canUp = false;
  let canDown = false;
  /** Words for the chip and the `+`, in the admin's language (sent with `labels`). */
  let chipLabels: Record<string, string> = {};
  /** Where the next library pick lands, as the editor last said. */
  let insertMark: { afterId?: string | null; beforeId?: string | null; parentId?: string | null; region?: string } | null = null;
  /** The block the `+` currently belongs to. */
  let plusFor: string | null = null;

  const wrapperFrom = (target: EventTarget | null): HTMLElement | null =>
    (target as Element | null)?.closest?.("[data-xt-block]") as HTMLElement | null;

  function frame(wrapper: HTMLElement | null, selected: boolean) {
    if (!wrapper) { overlay.style.display = "none"; label.style.display = "none"; return; }
    const rect = boxOf(wrapper);
    if (!rect) { overlay.style.display = "none"; label.style.display = "none"; return; }
    overlay.style.display = "block";
    overlay.classList.toggle("is-selected", selected);
    Object.assign(overlay.style, {
      top:    `${rect.top + window.scrollY}px`,
      left:   `${rect.left + window.scrollX}px`,
      width:  `${rect.width}px`,
      height: `${rect.height}px`,
    });
    drawLabel(wrapper, selected);
    Object.assign(label.style, {
      top:  `${rect.top + window.scrollY}px`,
      left: `${rect.left + window.scrollX}px`,
    });
  }

  /**
   * The chip above a block: what it is, and — once selected — what can be done to it.
   *
   * Two different chips on purpose. HOVER says what a thing IS, in the vocabulary a
   * `.xttheme` and `docs/plugin-blocks.md` use, so pointing at the page answers "what
   * block is that". SELECTED says what it is CALLED and carries its actions, because
   * by then the question has been answered and the next one is what to do with it.
   *
   * ⚠ The chip is the one part of the overlay that takes pointer events, and only
   * when selected. Everything else here is `pointer-events: none` so it can never
   * intercept a click meant for the page underneath.
   */
  function drawLabel(wrapper: HTMLElement, selected: boolean) {
    // ⚠ `inline-flex`, not `block`. The stylesheet lays the chip out as a row, but an
    // inline style beats a class: setting `block` here stacked the name and its two
    // action buttons vertically, and the rule that was supposed to prevent it looked
    // correct in the file.
    label.style.display = "inline-flex";
    label.classList.toggle("is-selected", selected);
    label.replaceChildren();

    if (!selected) {
      label.style.pointerEvents = "none";
      const type = document.createElement("span");
      type.textContent = wrapper.dataset.xtType ?? "block";
      label.append(type);
      // Says the block is conditional at the place the condition is invisible: the
      // preview deliberately still draws a restricted block, so nothing else on the
      // page distinguishes it from one everybody sees.
      // ⚠ `data-xt-restricted` — the renderer's own name for it, and it carries the
      // audience as its value. There is no `data-xt-audience`.
      const audience = wrapper.dataset.xtRestricted;
      if (audience) {
        const note = document.createElement("span");
        note.className = "xt-preview-label__note";
        note.textContent = ` · ${audienceLabels[audience] ?? audience}`;
        label.append(note);
      }
      return;
    }

    label.style.pointerEvents = "auto";
    const id = wrapper.dataset.xtBlock;

    // The breadcrumb: the parents, then the block. A parent is otherwise nearly
    // impossible to click — every point inside it belongs to one of its children.
    const trail = crumbs.length && crumbs[crumbs.length - 1]!.id === id
      ? crumbs
      : [{ id: id ?? "", label: selectedLabel ?? wrapper.dataset.xtType ?? "block" }];
    trail.slice(-3).forEach((c, i, arr) => {
      if (i > 0) {
        const sep = document.createElement("span");
        sep.className = "xt-preview-label__sep";
        sep.textContent = "›";
        label.append(sep);
      }
      if (i === arr.length - 1) {
        const name = document.createElement("span");
        name.className = "xt-preview-label__name";
        name.textContent = c.label;
        label.append(name);
        return;
      }
      const b = document.createElement("button");
      b.type = "button";
      b.className = "xt-preview-label__crumb";
      b.textContent = c.label;
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        selectedId = c.id;
        post({ source: "xt-preview", type: "select", id: c.id, templateKey: openTemplate ?? undefined });
        redraw();
      });
      label.append(b);
    });

    if (!id) return;

    const action = (kind: "up" | "down" | "duplicate" | "remove", onClick: () => void, enabled = true) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "xt-preview-label__act";
      b.innerHTML = GLYPH[kind];
      const name = chipLabels[kind] ?? kind;
      b.title = name;
      b.setAttribute("aria-label", name);
      b.disabled = !enabled;
      b.addEventListener("click", (e) => {
        // The chip sits ON the block; without this the click would also select it.
        e.preventDefault();
        e.stopPropagation();
        onClick();
      });
      return b;
    };

    const gap = document.createElement("span");
    gap.className = "xt-preview-label__gap";
    label.append(gap);
    label.append(action("up", () => post({ source: "xt-preview", type: "nudge", id, delta: -1 }), canUp));
    label.append(action("down", () => post({ source: "xt-preview", type: "nudge", id, delta: 1 }), canDown));
    label.append(action("duplicate", () => post({ source: "xt-preview", type: "duplicate", id })));
    // Required blocks are moved, never removed — the editor refuses it, so the chip
    // must not offer it.
    if (selectedRemovable) label.append(action("remove", () => post({ source: "xt-preview", type: "remove", id })));
  }

  const redraw = () => {
    const target = hovered ?? (selectedId ? wrapperById(selectedId) : null);
    frame(target, !hovered && !!selectedId);
    drawPlus();
    drawMark();
    drawChanges();
    reportBounds();
  };

  /**
   * "Changed" marks: an outline and a tag on every block publishing would change.
   *
   * Drawn like the selection frame, over the page and never on it, so a marked page
   * is laid out exactly like an unmarked one.
   */
  function drawChanges() {
    changeLayer.replaceChildren();
    if (!showChanges) return;
    for (const id of changedIds) {
      const w = wrapperById(id);
      const r = w && w.dataset.xtTemplate === openTemplate ? boxOf(w) : null;
      if (!r) continue;
      const box = document.createElement("div");
      box.className = "xt-preview-changed";
      Object.assign(box.style, {
        top: `${r.top + window.scrollY}px`, left: `${r.left + window.scrollX}px`,
        width: `${r.width}px`, height: `${r.height}px`,
      });
      const tag = document.createElement("span");
      tag.textContent = chipLabels.changed ?? "Changed";
      box.append(tag);
      changeLayer.append(box);
    }
  }

  /** The faint lines and boxes of every spot the current drag can land on. */
  function drawSpots() {
    spotLayer.replaceChildren();
    for (const sp of spots) {
      const el = document.createElement("div");
      el.className = `xt-preview-spot xt-preview-spot--${sp.kind}${sp === drop ? " is-on" : ""}`;
      Object.assign(el.style, {
        top: `${sp.kind === "line" ? sp.y - 1 : sp.y}px`,
        left: `${sp.kind === "across" ? sp.x - 1 : sp.x}px`,
        width: sp.kind === "across" ? "3px" : `${sp.w}px`,
        height: sp.kind === "line" ? "3px" : `${sp.h}px`,
      });
      if (sp.kind === "box") el.textContent = chipLabels.dropHere ?? "";
      spotLayer.append(el);
    }
  }

  /** Work out where the current drag can land; called once per drag (and on scroll). */
  function refreshSpots() {
    const dragged = dragId ? wrapperById(dragId) : null;
    const type = dragId ? dragged?.dataset.xtType ?? "" : newType ?? "";
    spots = type ? collectDropSpots(type, dragged, openTemplate) : [];
    drop = null;
    drawSpots();
  }

  /**
   * The `+` under the hovered block: "put the next block right here".
   *
   * Only for the open document's blocks (`data-xt-drag`), and never during a drag —
   * the drop line is already saying where things go. Pressing it marks the spot and
   * the editor opens its library aimed at it.
   */
  function drawPlus() {
    const w = hovered;
    const rect = w && w.dataset.xtDrag && !dragId && !newType ? boxOf(w) : null;
    if (!rect || !w) { plus.style.display = "none"; plusFor = null; return; }
    plusFor = w.dataset.xtBlock ?? null;
    plus.style.display = "grid";
    plus.title = chipLabels.insert ?? "+";
    plus.setAttribute("aria-label", chipLabels.insert ?? "+");
    Object.assign(plus.style, {
      top:  `${rect.bottom + window.scrollY - 11}px`,
      left: `${rect.left + window.scrollX + rect.width / 2 - 11}px`,
    });
  }

  /**
   * The marked spot, as a line, until the next pick lands or the editor clears it.
   * Anchored to a neighbouring block when there is one, else to the container or
   * region it goes into.
   */
  function drawMark() {
    if (!insertMark) { mark.style.display = "none"; return; }
    const { afterId, beforeId, parentId, region } = insertMark;
    let top: number | null = null;
    let r: DOMRect | null = null;
    const after = afterId ? wrapperById(afterId) : null;
    const before = beforeId ? wrapperById(beforeId) : null;
    if (after && (r = boxOf(after))) top = r.bottom + 4;
    else if (before && (r = boxOf(before))) top = r.top - 4;
    else {
      const host = parentId
        ? wrapperById(parentId)
        : allWrappers().find((el) => el.dataset.xtRegion === region && el.dataset.xtTemplate === openTemplate)?.closest("[data-xt-region]:not([data-xt-block])") as HTMLElement | null;
      r = host ? (boxOf(host) ?? host.getBoundingClientRect()) : null;
      if (r) top = r.top + r.height / 2;
    }
    if (top == null || !r) { mark.style.display = "none"; return; }
    mark.style.display = "block";
    Object.assign(mark.style, {
      top:   `${top + window.scrollY - 1}px`,
      left:  `${r.left + window.scrollX}px`,
      width: `${r.width}px`,
    });
  }

  /** The container a drop will land in, outlined, so "inside" and "beside" differ visibly. */
  function drawZone(el: HTMLElement | null) {
    const r = el ? (boxOf(el) ?? el.getBoundingClientRect()) : null;
    if (!r || r.width === 0) { zone.style.display = "none"; return; }
    zone.style.display = "block";
    Object.assign(zone.style, {
      top:    `${r.top + window.scrollY}px`,
      left:   `${r.left + window.scrollX}px`,
      width:  `${r.width}px`,
      height: `${r.height}px`,
    });
  }

  /**
   * Tell the editor where the selection is.
   *
   * ⚠ The SELECTION only, never the hover. The inspector shows the selected block, so
   * moving the panel as the pointer sweeps the page would be motion answering nothing
   * — and would make the panel unreachable, since crossing the page to get to it is a
   * hover of everything in between.
   */
  function reportBounds() {
    if (!selectedId) { reportedFor = null; return; }
    const wrapper = wrapperById(selectedId);
    const rect = wrapper && boxOf(wrapper);
    if (!rect) return;
    // Once per selection: `redraw` also runs on every hover, and a message per
    // mousemove would be a postMessage storm for an answer that has not changed.
    if (reportedFor === selectedId) return;
    reportedFor = selectedId;
    post({
      source: "xt-preview", type: "bounds", id: selectedId,
      left: rect.left + window.scrollX, right: rect.right + window.scrollX,
    });
  }

  // ── hover ────────────────────────────────────────────────────────────────
  const onOver = (e: MouseEvent) => {
    // Moving onto the `+` must not count as leaving the block it belongs to.
    if (e.target === plus) return;
    const w = wrapperFrom(e.target);
    if (w === hovered) return;
    hovered = w;
    // Draggable only where a drag can land: moving a block rewrites the tree the
    // editor is holding, and the header's blocks live in another document until the
    // admin opens it (one click on the block does exactly that).
    if (w?.dataset.xtDrag) w.setAttribute("draggable", "true");
    redraw();
  };
  const onLeave = () => { hovered = null; redraw(); };

  // ── click to select ──────────────────────────────────────────────────────
  const onClick = (e: MouseEvent) => {
    // An empty region's placeholder has no block to select — clicking it means
    // "put something here", which is the only thing it could mean.
    const empty = (e.target as Element | null)?.closest?.("[data-xt-empty]") as HTMLElement | null;
    if (empty?.dataset.xtEmpty) {
      e.preventDefault();
      e.stopPropagation();
      post({
        source: "xt-preview", type: "addTo", region: empty.dataset.xtEmpty,
        templateKey: empty.dataset.xtTemplate || undefined,
      });
      return;
    }

    // ⚠ Before the block walk: an icon sits INSIDE a block, so resolving the block
    // first would always win and icon mode would never fire.
    if (iconMode) {
      const ic = (e.target as Element | null)?.closest?.("[data-xt-icon]") as HTMLElement | null;
      const marker = ic?.dataset.xtIcon;
      if (marker) {
        const [blockId, slot] = marker.split("::");
        if (blockId && slot) {
          e.preventDefault();
          e.stopPropagation();
          const owner = ic.closest("[data-xt-block]") as HTMLElement | null;
          post({
            source: "xt-preview", type: "iconPick", id: blockId, slot,
            templateKey: owner?.dataset.xtTemplate || undefined,
          });
          return;
        }
      }
    }

    const w = wrapperFrom(e.target);
    if (!w?.dataset.xtBlock) return;
    // A dropdown's trigger (the bell, the shield, the avatar, a plugin's header
    // button) selects its block AND opens the dropdown, so the admin sees what they
    // are styling. Everything else — and anything inside an open dropdown — must not
    // follow a link or submit something in the preview.
    const target = e.target as Element | null;
    const trigger = !!target?.closest?.("button[aria-expanded]") && !target.closest(".xt-pop");
    if (!trigger) {
      e.preventDefault();
      e.stopPropagation();
    } else if (e.isTrusted) {
      // Selecting a header block from a page switches the editor to the header's
      // document, which reloads this preview and closes the dropdown just opened.
      // Remember the trigger so the reloaded preview opens it again (reopenTrigger).
      const btn = target!.closest("button[aria-expanded]")!;
      const index = [...w.querySelectorAll("button[aria-expanded]")].indexOf(btn);
      try {
        sessionStorage.setItem(REOPEN_KEY, JSON.stringify({ id: w.dataset.xtBlock, index, at: Date.now() }));
      } catch { /* storage off: the second click opens it */ }
    }
    selectedId = w.dataset.xtBlock;
    // The block's own document travels with the id. Clicking the masthead band or a
    // navbar item is how an admin edits the HEADER — the editor opens that document
    // and selects the block, rather than looking for an id it does not have.
    post({
      source: "xt-preview", type: "select", id: selectedId,
      templateKey: w.dataset.xtTemplate || undefined,
    });
    redraw();
  };

  const onPlus = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (plusFor) post({ source: "xt-preview", type: "insertAfter", id: plusFor });
  };

  // ── drag within the preview, and in from the library ─────────────────────
  const onDragStart = (e: DragEvent) => {
    if (inline) { e.preventDefault(); return; }
    const w = wrapperFrom(e.target);
    if (!w?.dataset.xtBlock) return;
    dragId = w.dataset.xtBlock;
    e.dataTransfer?.setData("text/plain", dragId);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    document.documentElement.classList.add("xt-dragging");
    plus.style.display = "none";
    // After the browser has taken its drag image, so the faded block is not what it shows.
    requestAnimationFrame(() => { w.classList.add("xt-drag-source"); refreshSpots(); });
  };

  const onDragOver = (e: DragEvent) => {
    if (!dragId && !newType) return;
    // Near the top or bottom edge the page scrolls itself, so a block can be taken
    // to a spot below the fold — a drag cannot use the wheel.
    const EDGE = 48;
    if (e.clientY < EDGE) window.scrollBy(0, -Math.ceil((EDGE - e.clientY) / 3));
    else if (e.clientY > window.innerHeight - EDGE) window.scrollBy(0, Math.ceil((e.clientY - window.innerHeight + EDGE) / 3));
    if (newType && spots.length === 0) refreshSpots();

    const best = nearestSpot(spots, e.clientX + window.scrollX, e.clientY + window.scrollY);
    if (best !== drop) {
      drop = best;
      drawSpots();
      if (best) {
        line.style.display = "none";
        Object.assign(zone.style, {
          display: best.parentId ? "block" : "none",
          top: `${best.parent.y}px`, left: `${best.parent.x}px`,
          width: `${best.parent.w}px`, height: `${best.parent.h}px`,
        });
      } else {
        drawZone(null);
      }
    }
    if (!drop) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = dragId ? "move" : "copy";
    document.documentElement.classList.add("xt-dragging");
  };

  const onDrop = (e: DragEvent) => {
    if (!drop || (!dragId && !newType)) return;
    e.preventDefault();
    const at = {
      region: drop.region, parentId: drop.parentId, index: drop.index,
      beforeId: drop.beforeId, afterId: drop.afterId,
    };
    if (dragId) {
      post({ source: "xt-preview", type: "move", id: dragId, ...at });
    } else if (newType) {
      post({ source: "xt-preview", type: "insert", blockType: newType, ...at, ...(newPreset ? { preset: newPreset } : {}) });
    }
    endDrag();
  };

  /** A drag that leaves the page (back to the editor) shows no stale line. */
  const onDragLeave = (e: DragEvent) => {
    if (e.relatedTarget) return;
    drop = null;
    drawSpots();
    drawZone(null);
  };

  function endDrag() {
    if (dragId) wrapperById(dragId)?.classList.remove("xt-drag-source");
    dragId = null;
    newType = null;
    newPreset = null;
    drop = null;
    spots = [];
    spotLayer.replaceChildren();
    line.style.display = "none";
    drawZone(null);
    document.documentElement.classList.remove("xt-dragging");
  }

  /**
   * Typing on the page: double-click a block's text.
   *
   * A block opts a piece of its markup in with `data-xt-inline="<prop>"`. The text is
   * edited in a box laid over that element, not in the element itself: React owns the
   * element's text, and editing it in place leaves React's idea of the DOM out of step
   * the first time an edit is cancelled. The page re-renders from the document once
   * the editor has applied the change, exactly as for any other edit.
   *
   * Only a CHANGE is sent. Text that is a translation reference shows in the admin's
   * language; opening it and closing it again must not freeze it to that language.
   */
  function startInline(el: HTMLElement, wrapper: HTMLElement) {
    const id = wrapper.dataset.xtBlock;
    const prop = el.dataset.xtInline;
    const r = el.getBoundingClientRect();
    if (!id || !prop || r.width === 0) return;
    const cs = getComputedStyle(el);
    const box = document.createElement("div");
    box.className = "xt-preview-inline";
    box.contentEditable = "plaintext-only";
    box.spellcheck = true;
    box.textContent = el.textContent ?? "";
    for (const k of ["font", "letterSpacing", "lineHeight", "textAlign", "textTransform", "color", "wordSpacing"] as const) {
      box.style[k] = cs[k];
    }
    Object.assign(box.style, {
      top: `${r.top + window.scrollY}px`, left: `${r.left + window.scrollX}px`,
      width: `${Math.max(r.width, 80)}px`, minHeight: `${r.height}px`,
    });
    document.body.append(box);
    el.style.visibility = "hidden";
    inline = { el, box, id, prop, original: (el.textContent ?? "").trim() };
    plus.style.display = "none";
    box.focus();
    const range = document.createRange();
    range.selectNodeContents(box);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    box.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); endInline(false); }
      else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); endInline(true); }
    });
    box.addEventListener("blur", () => endInline(true));
  }

  function endInline(keep: boolean) {
    const cur = inline;
    if (!cur) return;
    inline = null;
    const value = (cur.box.textContent ?? "").replace(/\s+/g, " ").trim();
    cur.box.remove();
    cur.el.style.visibility = "";
    if (keep && value && value !== cur.original) {
      post({ source: "xt-preview", type: "inlineEdit", id: cur.id, prop: cur.prop, value });
    }
  }

  const onDoubleClick = (e: MouseEvent) => {
    if (iconMode || inline) return;
    const el = (e.target as Element | null)?.closest?.("[data-xt-inline]") as HTMLElement | null;
    const wrapper = el ? wrapperFrom(el) : null;
    // Only the open document's blocks: the header's text belongs to another draft.
    if (!el || !wrapper?.dataset.xtDrag) return;
    e.preventDefault();
    e.stopPropagation();
    startInline(el, wrapper);
  };

  /**
   * Undo/redo pressed inside the preview.
   *
   * Key events never cross an iframe boundary, so the editor's own listener cannot
   * see these — and this document is exactly where blocks get dragged into the wrong
   * place, which makes it the most likely place for an admin to reach for Ctrl+Z.
   * Forwarded as intent; the editor owns the stacks, as it owns the document.
   */
  const onKeyDown = (e: KeyboardEvent) => {
    // Typing on the page keeps the browser's own undo for the text being typed.
    if (inline) return;
    const action = shortcutFor(e);
    if (!action) return;
    e.preventDefault();
    post({ source: "xt-preview", type: "shortcut", action });
  };

  // ── editor → preview ─────────────────────────────────────────────────────
  const onMessage = (e: MessageEvent) => {
    if (e.origin !== window.location.origin) return; // never trust a foreign frame
    const data = e.data as { source?: string; type?: string; id?: string | null };
    if (data?.source !== "xt-editor") return;
    if (data.type === "labels") {
      const d = e.data as { audience?: Record<string, string>; chip?: Record<string, string> };
      audienceLabels = d.audience ?? {};
      chipLabels = d.chip ?? {};
      // What an empty section or column says on the page; CSS draws it (coreBlocks.scss).
      document.documentElement.style.setProperty("--xt-empty-label", JSON.stringify(chipLabels.empty ?? ""));
      redraw();
    }

    // A library tile is being dragged in the editor: from now until it ends, a drag
    // over this page is that block. Cleared on `dragNewEnd` as well as on drop — a
    // drag released over the editor never reaches this document at all.
    if (data.type === "dragNew") {
      newType = (e.data as { blockType?: string }).blockType ?? null;
      newPreset = (e.data as { preset?: string }).preset ?? null;
      plus.style.display = "none";
      // Worked out on the first dragover rather than now: the drag may still be over
      // the editor, and the page can scroll before it arrives.
      spots = [];
    }
    if (data.type === "dragNewEnd") endDrag();

    if (data.type === "changes") {
      const d = e.data as { ids?: string[]; show?: boolean };
      changedIds = d.ids ?? [];
      showChanges = d.show === true;
      drawChanges();
    }

    if (data.type === "insertMark") {
      insertMark = (e.data as { mark?: typeof insertMark }).mark ?? null;
      drawMark();
    }

    /**
     * Icon mode on or off.
     *
     * ⚠ Also paints a class on `<html>`, so the page can show that icons are the
     * thing being clicked. Without it an admin clicking an icon and getting the
     * block selected instead has no way to tell which mode they are in.
     */
    if (data.type === "iconMode") {
      iconMode = (e.data as { on?: boolean }).on === true;
      document.documentElement.classList.toggle("xt-icon-mode", iconMode);
    }

    if (data.type === "highlight") {
      selectedId = data.id ?? null;
      const d = e.data as {
        label?: string; removable?: boolean;
        crumbs?: { id: string; label: string }[]; canUp?: boolean; canDown?: boolean;
      };
      selectedLabel = d.label ?? null;
      selectedRemovable = d.removable === true;
      crumbs = d.crumbs ?? [];
      canUp = d.canUp === true;
      canDown = d.canDown === true;
      redraw();
    }

    /**
     * Staged variant tokens.
     *
     * This document serves the PUBLISHED stylesheet, so appearance-draft edits are not
     * in it. The editor sends the CSS it would produce and it goes in LAST, after the
     * served sheet, so equal-specificity rules resolve to the staged one. Replaced
     * wholesale on every message: the editor owns the value, and diffing declarations
     * here would be a second source of truth for what the draft contains.
     */
    if (data.type === "tokens") {
      const css = (e.data as { css?: string }).css ?? "";
      let el = document.getElementById(TOKENS_ID) as HTMLStyleElement | null;
      if (!css.trim()) { el?.remove(); return; }
      if (!el) {
        el = document.createElement("style");
        el.id = TOKENS_ID;
        document.head.appendChild(el);
      }
      el.textContent = css;
    }

    // Which arrangement the editor is showing. The preview hides exactly what the
    // tree hides, because both ask `audienceInView`.
    if (data.type === "audience") {
      const view = (e.data as { audience?: AudienceView | null }).audience ?? null;
      setPreviewAudience(view);
      requestAnimationFrame(redraw);
    }
    // "Viewing on": the date seasonal edge art is judged against; null = today.
    if (data.type === "previewDate") {
      setPreviewDate((e.data as { md?: string | null }).md ?? null);
    }
    // "Viewing at": the hour time-of-day edge art is judged against; null = now.
    if (data.type === "previewHour") {
      const hour = (e.data as { hour?: unknown }).hour;
      setPreviewHour(typeof hour === "number" && hour >= 0 && hour <= 23 ? Math.floor(hour) : null);
    }
    // The editor's unsaved site frame, from the Site layout popover.
    if (data.type === "frame") {
      setLivePreviewFrame((e.data as { frame?: unknown }).frame ?? null);
      requestAnimationFrame(redraw);
    }
    // The editor's working document, pushed on every edit so the preview reflects
    // changes immediately instead of only after a save.
    if (data.type === "document") {
      const d = e.data as { templateKey?: TemplateKey; variant?: string; document?: LayoutDocument };
      if (d.templateKey && d.document) {
        openTemplate = d.templateKey;
        // The variant travels with the document: previewing one page's own layout
        // must not bleed into the template default's preview, or vice versa.
        setLivePreviewDocument(d.templateKey, d.document, d.variant || undefined);
        // The frame follows the block it was drawn around; after a re-render the
        // old element is gone, so re-measure on the next frame.
        requestAnimationFrame(redraw);
      }
    }
  };

  document.addEventListener("mouseover", onOver, true);
  document.addEventListener("mouseleave", onLeave);
  document.addEventListener("click", onClick, true);
  document.addEventListener("dblclick", onDoubleClick, true);
  /*
   * "The editor is looking at this page", for CSS to read.
   *
   * Two rules need it, and both are about the same thing: a block that DREW NOTHING.
   * On the site a rail or a column holding only such blocks collapses, because the
   * visitor is looking at a page with nothing in it. In the editor that would mean
   * dropping a block and seeing the track vanish — so here the track stays and the
   * block says, in its own place, that it drew nothing.
   *
   * Stamped by the BRIDGE because the bridge is the editor's presence in this
   * document: it is installed only in the preview, and removed with it.
   */
  document.documentElement.dataset.xtEditor = "1";

  document.addEventListener("dragstart", onDragStart, true);
  document.addEventListener("dragover", onDragOver);
  document.addEventListener("drop", onDrop);
  document.addEventListener("dragend", endDrag);
  document.addEventListener("dragleave", onDragLeave);
  plus.addEventListener("click", onPlus);
  document.addEventListener("keydown", onKeyDown);
  window.addEventListener("message", onMessage);
  // ⚠ AFTER the listener is attached, never before: this is the whole point of the
  // handshake. The editor answers by pushing everything it holds.
  post({ source: "xt-preview", type: "ready" });
  /** Lists move as the page scrolls past sticky things; re-measure where a drag can go. */
  const onScroll = () => {
    redraw();
    if (!dragId && !newType) return;
    const keep = drop;
    refreshSpots();
    drop = keep
      ? spots.find((sp) => sp.parentId === keep.parentId && sp.beforeId === keep.beforeId && sp.afterId === keep.afterId) ?? null
      : null;
    drawSpots();
  };
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", redraw);

  const stopReopen = reopenTrigger();

  return () => {
    stopReopen();
    document.removeEventListener("mouseover", onOver, true);
    document.removeEventListener("mouseleave", onLeave);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("dblclick", onDoubleClick, true);
    document.removeEventListener("dragstart", onDragStart, true);
    document.removeEventListener("dragover", onDragOver);
    document.removeEventListener("drop", onDrop);
    document.removeEventListener("dragend", endDrag);
    document.removeEventListener("dragleave", onDragLeave);
    plus.removeEventListener("click", onPlus);
    document.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("message", onMessage);
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", redraw);
    endInline(false);
    overlay.remove(); label.remove(); line.remove(); zone.remove(); mark.remove(); plus.remove();
    spotLayer.remove(); changeLayer.remove();
    document.documentElement.classList.remove("xt-dragging");
    delete document.documentElement.dataset.xtEditor;
  };
}
