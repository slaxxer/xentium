/**
 * Undo/redo for the layout editor.
 *
 * The editor AUTOSAVES, which quietly removed the escape hatch every other editor
 * has: there is no "don't save" any more, so a drag that lands a block in the wrong
 * column is persisted before an admin has finished regretting it. Reset is not that
 * escape — it goes all the way back to the code default and takes the good edits
 * with it. This is the missing step.
 *
 * The stacks hold WHOLE documents rather than inverse operations. Layout documents
 * are small (a page is tens of nodes), the tree ops are already pure, and a snapshot
 * cannot drift out of sync with the thing it claims to undo — which an inverse-op log
 * can, and does, the first time an operation is added without its inverse.
 *
 * Selection travels with the snapshot. Undoing a delete and then having to hunt for
 * the block in the tree is most of the value gone.
 */
import { useCallback, useRef, useState } from "react";
import type { LayoutDocument } from "@xentium/contracts";

/** A point in the edit history: the document, and what was selected at the time. */
export interface LayoutSnapshot {
  doc: LayoutDocument;
  selectedId: string | null;
}

interface Entry extends LayoutSnapshot {
  /** Groups a burst of edits into one step. `null` never coalesces. */
  coalesceKey: string | null;
  at: number;
}

/**
 * How far back an admin can go. Deep enough to cover a session's worth of
 * rearranging, bounded because every entry is a full document and the editor is
 * long-lived — an admin can sit on this page all afternoon.
 */
const LIMIT = 50;

/** Edits to the same target within this window are one undo step. */
const COALESCE_MS = 900;

export interface LayoutHistory {
  canUndo: boolean;
  canRedo: boolean;
  /**
   * Record the state being left behind, BEFORE applying an edit.
   *
   * `coalesceKey` collapses a run of edits to the same target — typing in a props
   * field fires one of these per keystroke, and an undo per character is not an
   * undo anybody wants.
   */
  record: (previous: LayoutSnapshot, coalesceKey?: string) => void;
  /** The state to go back to, or `null` when there is nothing to undo. */
  undo: (current: LayoutSnapshot) => LayoutSnapshot | null;
  redo: (current: LayoutSnapshot) => LayoutSnapshot | null;
  /** Drop both stacks — a different document is being edited, or the server replaced this one. */
  clear: () => void;
}

export function useLayoutHistory(): LayoutHistory {
  // Stacks live in refs, not state: a held-down Ctrl+Z fires repeat events faster
  // than React re-renders, and reading the stack from state would make every repeat
  // after the first act on the same stale array.
  const past = useRef<Entry[]>([]);
  const future = useRef<LayoutSnapshot[]>([]);
  // The buttons' enabled state is derived from the stacks, so something has to ask
  // for a render when they change.
  const [, bump] = useState(0);
  const sync = useCallback(() => bump((n) => n + 1), []);

  const record = useCallback((previous: LayoutSnapshot, coalesceKey?: string) => {
    const top = past.current[past.current.length - 1];
    const now = Date.now();

    // Already holding the state from before this burst began — which is exactly what
    // an undo should restore, so extend the burst instead of stacking another entry.
    if (coalesceKey && top && top.coalesceKey === coalesceKey && now - top.at < COALESCE_MS) {
      top.at = now;
      future.current = [];
      sync();
      return;
    }

    past.current.push({ ...previous, coalesceKey: coalesceKey ?? null, at: now });
    // Oldest first: the far end of a long session is the least likely to be wanted.
    if (past.current.length > LIMIT) past.current.shift();
    // A fresh edit forks the timeline; the redo branch it forked from is unreachable.
    future.current = [];
    sync();
  }, [sync]);

  const undo = useCallback((current: LayoutSnapshot): LayoutSnapshot | null => {
    const entry = past.current.pop();
    if (!entry) return null;
    future.current.push(current);
    sync();
    return { doc: entry.doc, selectedId: entry.selectedId };
  }, [sync]);

  const redo = useCallback((current: LayoutSnapshot): LayoutSnapshot | null => {
    const entry = future.current.pop();
    if (!entry) return null;
    // Redone steps go back on the undo stack as discrete entries: they were separated
    // by an undo, so coalescing them into whatever follows would be wrong.
    past.current.push({ ...current, coalesceKey: null, at: Date.now() });
    sync();
    return entry;
  }, [sync]);

  const clear = useCallback(() => {
    past.current = [];
    future.current = [];
    sync();
  }, [sync]);

  return {
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    record, undo, redo, clear,
  };
}
