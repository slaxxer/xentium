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
 *   editor  → preview  nv:iconMode    turn icon picking on or off
 *                      nv:highlight   the tree selection changed (with its breadcrumb)
 *                      nv:dragNew     a library tile is being dragged — its type
 *                      nv:insertMark  where the next library pick lands, or nothing
 *                      nv:tokens      staged variant tokens, so a colour edit is
 *                                     visible before it is published
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
 * ## Where a drop lands, once blocks can nest
 *
 * The drop parent is the NEAREST enclosing container or region, walking outwards
 * until one is found that will actually take the dragged block: a `columns` row
 * refuses anything but a `column`, and a container cannot swallow itself or its
 * own descendant. That walk is why hovering a leaf inside a section reorders
 * within the section, and hovering the section's own padding appends inside it.
 *
 * A consequence worth knowing: hovering a container always aims INSIDE it, so
 * the preview cannot place a block as a container's SIBLING. That is what the
 * tree is for — it addresses every level explicitly, and it stays the complete
 * interface while the preview is the fast one.
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
    }
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

/** Nearest legal drop parent: a container wrapper, or a region's own element. */
const DROP_PARENT = "[data-xt-container],[data-xt-region]:not([data-xt-block])";

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

// `childrenOf` and `resolveDropParent` are exported for their tests, which run
// them against DOM the real renderer produced. They are the two functions nesting
// broke — the old versions used `closest("[data-xt-region]")` and `:scope >`,
// which silently resolve to the wrong parent and an empty sibling list the moment
// anything is nested — so they are worth pinning down directly.

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

export interface DropParent { parentId: string | null; region: string; el: HTMLElement }

/**
 * Walk outwards for a container or region that will accept the dragged block.
 *
 * Three reasons a candidate is skipped: it is the dragged block itself, it sits
 * inside the dragged block (both would build a cycle), or its type does not admit
 * this child. Skipping rather than refusing outright means dragging a heading over
 * a `columns` row still has somewhere sensible to go — the row's own parent.
 */
export function resolveDropParent(
  from: Element | null,
  draggedType: string,
  dragged: HTMLElement | null,
  /**
   * The OPEN document. The page also renders the site header and footer, which are
   * other documents — a drop must never aim into one, or the editor would be handed
   * a region its document does not have. Omitted, every document is a candidate.
   */
  template?: string | null,
): DropParent | null {
  let el: Element | null = from;
  while (el) {
    const cand = el.closest(DROP_PARENT) as HTMLElement | null;
    if (!cand) return null;
    const parentId = cand.dataset.xtBlock ?? null;
    // `acceptsChild` keys off the block TYPE; the id would look up nothing in the
    // registry and silently reject every container. A region candidate carries no
    // type, which is exactly the null the region case wants.
    const parentType = cand.dataset.xtType ?? null;
    const region = cand.dataset.xtRegion;
    const selfOrInside = !!dragged && (dragged === cand || dragged.contains(cand));
    const otherDocument = !!template && cand.dataset.xtTemplate !== template;
    if (region && !selfOrInside && !otherDocument && acceptsChild(parentType, draggedType)) {
      return { parentId, region, el: cand };
    }
    el = cand.parentElement;
  }
  return null;
}

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
  let drop: { region: string; parentId: string | null; index: number } | null = null;
  /** The library block being dragged in from the editor, announced by `nv:dragNew`. */
  let newType: string | null = null;
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
    reportBounds();
  };

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
    const w = wrapperFrom(e.target);
    if (!w?.dataset.xtBlock) return;
    dragId = w.dataset.xtBlock;
    e.dataTransfer?.setData("text/plain", dragId);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    document.documentElement.classList.add("xt-dragging");
    plus.style.display = "none";
  };

  const onDragOver = (e: DragEvent) => {
    if (!dragId && !newType) return;
    // Near the top or bottom edge the page scrolls itself, so a block can be taken
    // to a spot below the fold — a drag cannot use the wheel.
    const EDGE = 48;
    if (e.clientY < EDGE) window.scrollBy(0, -Math.ceil((EDGE - e.clientY) / 3));
    else if (e.clientY > window.innerHeight - EDGE) window.scrollBy(0, Math.ceil((e.clientY - window.innerHeight + EDGE) / 3));
    const dragged = dragId ? wrapperById(dragId) : null;
    const type = dragId ? dragged?.dataset.xtType ?? "" : newType!;
    const target = resolveDropParent(e.target as Element | null, type, dragged, openTemplate);
    if (!target) { line.style.display = "none"; drawZone(null); drop = null; return; }

    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = dragId ? "move" : "copy";
    document.documentElement.classList.add("xt-dragging");

    // The dragged block stays in the list: `moveBlock` takes the index as the list
    // is BEFORE the block is lifted out, which is exactly what this counts.
    const siblings = childrenOf(target.parentId, target.region);
    const w = wrapperFrom(e.target);

    // Appending is the default, so hovering a container's own padding — rather
    // than one of its children — puts the block at the end of it. Side by side
    // (the tracks of a `columns` row) the halves are left and right, not top and
    // bottom.
    const across = target.el.dataset.xtType === "columns";
    let index = siblings.length;
    if (w) {
      const own = siblings.find((s) => s === w || s.contains(w));
      const i = own ? siblings.indexOf(own) : -1;
      const rect = own ? boxOf(own) : null;
      if (i !== -1 && rect) {
        const after = across ? e.clientX > rect.left + rect.width / 2 : e.clientY > rect.top + rect.height / 2;
        index = i + (after ? 1 : 0);
      }
    }
    drop = { region: target.region, parentId: target.parentId, index };
    drawZone(target.parentId ? target.el : null);

    // Draw the insertion line where the block will actually land.
    const at = siblings[Math.min(index, siblings.length - 1)];
    const rect = at ? boxOf(at) : null;
    if (rect) {
      const atEnd = index >= siblings.length;
      line.style.display = "block";
      if (across) {
        Object.assign(line.style, {
          top:    `${rect.top + window.scrollY}px`,
          left:   `${(atEnd ? rect.right + 4 : rect.left - 5) + window.scrollX}px`,
          width:  "3px",
          height: `${rect.height}px`,
        });
      } else {
        Object.assign(line.style, {
          top:    `${(atEnd ? rect.bottom + 3 : rect.top - 4) + window.scrollY}px`,
          left:   `${rect.left + window.scrollX}px`,
          width:  `${rect.width}px`,
          height: "",
        });
      }
    } else {
      // An empty container or region has no sibling to anchor to; the drop
      // parent's own box is the honest place to show the line.
      const r = (boxOf(target.el) ?? target.el.getBoundingClientRect());
      line.style.display = "block";
      Object.assign(line.style, {
        top:    `${r.top + r.height / 2 + window.scrollY}px`,
        left:   `${r.left + window.scrollX}px`,
        width:  `${r.width}px`,
        height: "",
      });
    }
  };

  const onDrop = (e: DragEvent) => {
    if (!drop || (!dragId && !newType)) return;
    e.preventDefault();
    if (dragId) {
      post({
        source: "xt-preview", type: "move", id: dragId,
        region: drop.region, parentId: drop.parentId, index: drop.index,
      });
    } else if (newType) {
      post({
        source: "xt-preview", type: "insert", blockType: newType,
        region: drop.region, parentId: drop.parentId, index: drop.index,
      });
    }
    endDrag();
  };

  /** A drag that leaves the page (back to the editor) shows no stale line. */
  const onDragLeave = (e: DragEvent) => {
    if (e.relatedTarget) return;
    line.style.display = "none";
    drawZone(null);
    drop = null;
  };

  function endDrag() {
    dragId = null;
    newType = null;
    drop = null;
    line.style.display = "none";
    drawZone(null);
    document.documentElement.classList.remove("xt-dragging");
  }

  /**
   * Undo/redo pressed inside the preview.
   *
   * Key events never cross an iframe boundary, so the editor's own listener cannot
   * see these — and this document is exactly where blocks get dragged into the wrong
   * place, which makes it the most likely place for an admin to reach for Ctrl+Z.
   * Forwarded as intent; the editor owns the stacks, as it owns the document.
   */
  const onKeyDown = (e: KeyboardEvent) => {
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
      redraw();
    }

    // A library tile is being dragged in the editor: from now until it ends, a drag
    // over this page is that block. Cleared on `dragNewEnd` as well as on drop — a
    // drag released over the editor never reaches this document at all.
    if (data.type === "dragNew") {
      newType = (e.data as { blockType?: string }).blockType ?? null;
      plus.style.display = "none";
    }
    if (data.type === "dragNewEnd") endDrag();

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
  window.addEventListener("scroll", redraw, true);
  window.addEventListener("resize", redraw);

  const stopReopen = reopenTrigger();

  return () => {
    stopReopen();
    document.removeEventListener("mouseover", onOver, true);
    document.removeEventListener("mouseleave", onLeave);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("dragstart", onDragStart, true);
    document.removeEventListener("dragover", onDragOver);
    document.removeEventListener("drop", onDrop);
    document.removeEventListener("dragend", endDrag);
    document.removeEventListener("dragleave", onDragLeave);
    plus.removeEventListener("click", onPlus);
    document.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("message", onMessage);
    window.removeEventListener("scroll", redraw, true);
    window.removeEventListener("resize", redraw);
    overlay.remove(); label.remove(); line.remove(); zone.remove(); mark.remove(); plus.remove();
    document.documentElement.classList.remove("xt-dragging");
    delete document.documentElement.dataset.xtEditor;
  };
}
