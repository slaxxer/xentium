/**
 * Editor ⇄ preview bridge (ADR-0005).
 *
 * The preview is a real route in an iframe, so it is a separate document with its
 * own JS context. This module runs INSIDE that document and talks to the editor
 * over `postMessage`:
 *
 *   preview → editor   nv:select   an admin clicked a block
 *                      nv:move     an admin dragged a block to a new position
 *   editor  → preview  nv:highlight  the tree selection changed
 *                      nv:tokens     staged variant tokens, so a colour edit is
 *                                    visible before it is published
 *
 * Why an overlay instead of styling the block: each block is wrapped in a
 * `display: contents` element so the preview's layout is identical to the live
 * page. Such a wrapper has no box of its own, so it cannot show an outline —
 * instead the bridge measures the block's first real element and draws a
 * separate, absolutely positioned frame over it. Nothing about the page's own
 * styling is touched, which is the point: the preview must not lie.
 *
 * Dragging happens entirely within this document (both source and target are
 * here), so it uses ordinary HTML5 drag events. Only the RESULT crosses the
 * frame boundary, as a single `nv:move` message — the editor owns the document
 * and remains the single source of truth.
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

import type { AudienceView, LayoutDocument, TemplateKey } from "@nodevo/contracts";
import { acceptsChild } from "./blockRegistry";
import { shortcutFor } from "./editorShortcuts";
import { setLivePreviewDocument, setPreviewAudience } from "./useLayout";

const OVERLAY_ID = "nv-preview-overlay";
const TOKENS_ID = "nv-preview-tokens";
const LABEL_ID = "nv-preview-label";
const LINE_ID = "nv-preview-dropline";

type Msg =
  | { source: "nv-preview"; type: "select"; id: string }
  | {
      source: "nv-preview";
      type: "move";
      id: string;
      region: string;
      /** Container the block should land in, or null for the region itself. */
      parentId: string | null;
      index: number;
    }
  /** A keystroke this document swallowed that belongs to the editor around it. */
  | { source: "nv-preview"; type: "shortcut"; action: "undo" | "redo" };

const post = (msg: Msg) => window.parent?.postMessage(msg, window.location.origin);

/** Nearest legal drop parent: a container wrapper, or a region's own element. */
const DROP_PARENT = "[data-nv-container],[data-nv-region]:not([data-nv-block])";

/** The block's first real element — the `display: contents` wrapper has no box. */
function boxOf(wrapper: Element): DOMRect | null {
  const el = wrapper.querySelector(":scope > *");
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return rect.width === 0 && rect.height === 0 ? null : rect;
}

/** Every block wrapper, in document order — which is also tree order. */
const allWrappers = (): HTMLElement[] =>
  [...document.querySelectorAll("[data-nv-block]")] as HTMLElement[];

// `childrenOf` and `resolveDropParent` are exported for their tests, which run
// them against DOM the real renderer produced. They are the two functions nesting
// broke — the old versions used `closest("[data-nv-region]")` and `:scope >`,
// which silently resolve to the wrong parent and an empty sibling list the moment
// anything is nested — so they are worth pinning down directly.

/** Looked up by scanning rather than by selector: a block id comes from a stored
 *  document, so it is not guaranteed to be safe to interpolate into one. */
const wrapperById = (id: string): HTMLElement | null =>
  allWrappers().find((el) => el.dataset.nvBlock === id) ?? null;

/**
 * A drop parent's direct children.
 *
 * Parentage is read from `data-nv-parent`, which the renderer stamps, because a
 * container's real element sits between its wrapper and its children's wrappers —
 * so `:scope > [data-nv-block]` matches nothing once anything is nested.
 */
export const childrenOf = (parentId: string | null, region: string): HTMLElement[] =>
  allWrappers().filter((el) =>
    parentId == null
      ? el.dataset.nvParent === "" && el.dataset.nvRegion === region
      : el.dataset.nvParent === parentId,
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
): DropParent | null {
  let el: Element | null = from;
  while (el) {
    const cand = el.closest(DROP_PARENT) as HTMLElement | null;
    if (!cand) return null;
    const parentId = cand.dataset.nvBlock ?? null;
    // `acceptsChild` keys off the block TYPE; the id would look up nothing in the
    // registry and silently reject every container. A region candidate carries no
    // type, which is exactly the null the region case wants.
    const parentType = cand.dataset.nvType ?? null;
    const region = cand.dataset.nvRegion;
    const selfOrInside = !!dragged && (dragged === cand || dragged.contains(cand));
    if (region && !selfOrInside && acceptsChild(parentType, draggedType)) {
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

export function installPreviewBridge(): () => void {
  const overlay = ensure(OVERLAY_ID, "nv-preview-overlay");
  const label = ensure(LABEL_ID, "nv-preview-label");
  const line = ensure(LINE_ID, "nv-preview-dropline");

  let hovered: HTMLElement | null = null;
  let selectedId: string | null = null;
  let dragId: string | null = null;
  let drop: { region: string; parentId: string | null; index: number } | null = null;

  const wrapperFrom = (target: EventTarget | null): HTMLElement | null =>
    (target as Element | null)?.closest?.("[data-nv-block]") as HTMLElement | null;

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
    label.style.display = "block";
    label.textContent = wrapper.dataset.nvType ?? "block";
    Object.assign(label.style, {
      top:  `${rect.top + window.scrollY}px`,
      left: `${rect.left + window.scrollX}px`,
    });
  }

  const redraw = () => {
    const target = hovered ?? (selectedId ? wrapperById(selectedId) : null);
    frame(target, !hovered && !!selectedId);
  };

  // ── hover ────────────────────────────────────────────────────────────────
  const onOver = (e: MouseEvent) => {
    const w = wrapperFrom(e.target);
    if (w === hovered) return;
    hovered = w;
    if (w) w.setAttribute("draggable", "true");
    redraw();
  };
  const onLeave = () => { hovered = null; redraw(); };

  // ── click to select ──────────────────────────────────────────────────────
  const onClick = (e: MouseEvent) => {
    const w = wrapperFrom(e.target);
    if (!w?.dataset.nvBlock) return;
    // Selecting must not also follow a link or submit something in the preview.
    e.preventDefault();
    e.stopPropagation();
    selectedId = w.dataset.nvBlock;
    post({ source: "nv-preview", type: "select", id: selectedId });
    redraw();
  };

  // ── drag within the preview ──────────────────────────────────────────────
  const onDragStart = (e: DragEvent) => {
    const w = wrapperFrom(e.target);
    if (!w?.dataset.nvBlock) return;
    dragId = w.dataset.nvBlock;
    e.dataTransfer?.setData("text/plain", dragId);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  };

  const onDragOver = (e: DragEvent) => {
    if (!dragId) return;
    const dragged = wrapperById(dragId);
    const target = resolveDropParent(e.target as Element | null, dragged?.dataset.nvType ?? "", dragged);
    if (!target) { line.style.display = "none"; return; }

    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";

    const siblings = childrenOf(target.parentId, target.region);
    const w = wrapperFrom(e.target);

    // Appending is the default, so hovering a container's own padding — rather
    // than one of its children — puts the block at the end of it.
    let index = siblings.length;
    if (w) {
      const i = siblings.indexOf(w);
      const rect = boxOf(w);
      if (i !== -1 && rect) index = i + (e.clientY > rect.top + rect.height / 2 ? 1 : 0);
    }
    drop = { region: target.region, parentId: target.parentId, index };

    // Draw the insertion line where the block will actually land.
    const at = siblings[Math.min(index, siblings.length - 1)];
    const rect = at ? boxOf(at) : null;
    if (rect) {
      const atEnd = index >= siblings.length;
      line.style.display = "block";
      Object.assign(line.style, {
        top:   `${(atEnd ? rect.bottom : rect.top) + window.scrollY}px`,
        left:  `${rect.left + window.scrollX}px`,
        width: `${rect.width}px`,
      });
    } else {
      // An empty container or region has no sibling to anchor to; the drop
      // parent's own box is the honest place to show the line.
      const r = (boxOf(target.el) ?? target.el.getBoundingClientRect());
      line.style.display = "block";
      Object.assign(line.style, {
        top:   `${r.top + window.scrollY}px`,
        left:  `${r.left + window.scrollX}px`,
        width: `${r.width}px`,
      });
    }
  };

  const onDrop = (e: DragEvent) => {
    if (!dragId || !drop) return;
    e.preventDefault();
    post({
      source: "nv-preview", type: "move", id: dragId,
      region: drop.region, parentId: drop.parentId, index: drop.index,
    });
    endDrag();
  };

  function endDrag() {
    dragId = null;
    drop = null;
    line.style.display = "none";
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
    post({ source: "nv-preview", type: "shortcut", action });
  };

  // ── editor → preview ─────────────────────────────────────────────────────
  const onMessage = (e: MessageEvent) => {
    if (e.origin !== window.location.origin) return; // never trust a foreign frame
    const data = e.data as { source?: string; type?: string; id?: string | null };
    if (data?.source !== "nv-editor") return;
    if (data.type === "highlight") { selectedId = data.id ?? null; redraw(); }

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
    // The editor's working document, pushed on every edit so the preview reflects
    // changes immediately instead of only after a save.
    if (data.type === "document") {
      const d = e.data as { templateKey?: TemplateKey; variant?: string; document?: LayoutDocument };
      if (d.templateKey && d.document) {
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
  document.addEventListener("dragstart", onDragStart, true);
  document.addEventListener("dragover", onDragOver);
  document.addEventListener("drop", onDrop);
  document.addEventListener("dragend", endDrag);
  document.addEventListener("keydown", onKeyDown);
  window.addEventListener("message", onMessage);
  window.addEventListener("scroll", redraw, true);
  window.addEventListener("resize", redraw);

  return () => {
    document.removeEventListener("mouseover", onOver, true);
    document.removeEventListener("mouseleave", onLeave);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("dragstart", onDragStart, true);
    document.removeEventListener("dragover", onDragOver);
    document.removeEventListener("drop", onDrop);
    document.removeEventListener("dragend", endDrag);
    document.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("message", onMessage);
    window.removeEventListener("scroll", redraw, true);
    window.removeEventListener("resize", redraw);
    overlay.remove(); label.remove(); line.remove();
  };
}
