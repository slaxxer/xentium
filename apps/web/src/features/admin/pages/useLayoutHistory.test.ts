/**
 * The layout editor's undo stack.
 *
 * @vitest-environment jsdom
 *
 * The behaviours worth pinning are the ones a naive stack gets wrong: a burst of
 * keystrokes must collapse into ONE step (otherwise undo walks back through a heading
 * one character at a time and the structural edit an admin wants is unreachable), a
 * fresh edit after an undo must drop the redo branch it forked from, and the stack
 * must be bounded — the editor is long-lived and every entry is a whole document.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { LayoutDocument } from "@nodevo/contracts";
import { useLayoutHistory, type LayoutSnapshot } from "./useLayoutHistory";

/** Documents are opaque to the hook — only identity matters, so a marker suffices. */
const doc = (marker: string): LayoutDocument => ({
  templateKey: "home",
  schemaVersion: 1,
  regions: { main: [{ id: marker, type: "heading", props: {} }] },
});

const snap = (marker: string, selectedId: string | null = null): LayoutSnapshot => ({
  doc: doc(marker),
  selectedId,
});

const markerOf = (s: LayoutSnapshot | null) => s?.doc.regions.main?.[0]?.id ?? null;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("useLayoutHistory", () => {
  it("starts empty", () => {
    const { result } = renderHook(() => useLayoutHistory());
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("undo returns the recorded state and redo returns what was current", () => {
    const { result } = renderHook(() => useLayoutHistory());

    act(() => { result.current.record(snap("a")); });
    expect(result.current.canUndo).toBe(true);

    let undone: LayoutSnapshot | null = null;
    act(() => { undone = result.current.undo(snap("b")); });
    expect(markerOf(undone)).toBe("a");
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);

    let redone: LayoutSnapshot | null = null;
    act(() => { redone = result.current.redo(snap("a")); });
    expect(markerOf(redone)).toBe("b");
    expect(result.current.canRedo).toBe(false);
    // The redone step is undoable again — it went back onto the past stack.
    expect(result.current.canUndo).toBe(true);
  });

  it("undo on an empty stack returns null rather than throwing", () => {
    const { result } = renderHook(() => useLayoutHistory());
    let out: LayoutSnapshot | null = snap("x");
    act(() => { out = result.current.undo(snap("current")); });
    expect(out).toBeNull();
    expect(result.current.canRedo).toBe(false); // nothing was banked
  });

  it("carries the selection, so undoing a delete reselects the block", () => {
    const { result } = renderHook(() => useLayoutHistory());
    act(() => { result.current.record(snap("a", "block-7")); });

    let undone: LayoutSnapshot | null = null;
    act(() => { undone = result.current.undo(snap("b", null)); });
    expect(undone!.selectedId).toBe("block-7");
  });

  it("coalesces a burst of edits to the same target into one step", () => {
    const { result } = renderHook(() => useLayoutHistory());

    // Three keystrokes in the same field, each recording the state before it.
    act(() => { result.current.record(snap("typed-0"), "props:b1"); });
    vi.advanceTimersByTime(100);
    act(() => { result.current.record(snap("typed-1"), "props:b1"); });
    vi.advanceTimersByTime(100);
    act(() => { result.current.record(snap("typed-2"), "props:b1"); });

    // One undo, landing before the burst began — not after its second character.
    let undone: LayoutSnapshot | null = null;
    act(() => { undone = result.current.undo(snap("typed-3")); });
    expect(markerOf(undone)).toBe("typed-0");
    expect(result.current.canUndo).toBe(false);
  });

  it("starts a new step for a different target", () => {
    const { result } = renderHook(() => useLayoutHistory());
    act(() => { result.current.record(snap("a"), "props:b1"); });
    act(() => { result.current.record(snap("b"), "props:b2"); });

    let undone: LayoutSnapshot | null = null;
    act(() => { undone = result.current.undo(snap("c")); });
    expect(markerOf(undone)).toBe("b");
    expect(result.current.canUndo).toBe(true);
  });

  it("starts a new step once the burst goes quiet", () => {
    const { result } = renderHook(() => useLayoutHistory());
    act(() => { result.current.record(snap("a"), "props:b1"); });
    vi.advanceTimersByTime(5_000); // a pause, then typing resumes
    act(() => { result.current.record(snap("b"), "props:b1"); });

    let undone: LayoutSnapshot | null = null;
    act(() => { undone = result.current.undo(snap("c")); });
    expect(markerOf(undone)).toBe("b");
    expect(result.current.canUndo).toBe(true);
  });

  it("an unkeyed edit never coalesces, even back to back", () => {
    const { result } = renderHook(() => useLayoutHistory());
    // Two drags in quick succession are two steps; only keyed edits merge.
    act(() => { result.current.record(snap("a")); });
    act(() => { result.current.record(snap("b")); });

    let undone: LayoutSnapshot | null = null;
    act(() => { undone = result.current.undo(snap("c")); });
    expect(markerOf(undone)).toBe("b");
    expect(result.current.canUndo).toBe(true);
  });

  it("a new edit drops the redo branch it forked from", () => {
    const { result } = renderHook(() => useLayoutHistory());
    act(() => { result.current.record(snap("a")); });
    act(() => { result.current.undo(snap("b")); });
    expect(result.current.canRedo).toBe(true);

    act(() => { result.current.record(snap("a")); });
    expect(result.current.canRedo).toBe(false);
  });

  it("coalescing into an existing burst also drops the redo branch", () => {
    const { result } = renderHook(() => useLayoutHistory());
    act(() => { result.current.record(snap("a"), "props:b1"); });
    act(() => { result.current.undo(snap("b")); });
    // Re-record onto the now-empty past: a fresh entry, then a coalescing one.
    act(() => { result.current.record(snap("c"), "props:b1"); });
    act(() => { result.current.undo(snap("d")); });
    expect(result.current.canRedo).toBe(true);
    act(() => { result.current.record(snap("e"), "props:b1"); });
    expect(result.current.canRedo).toBe(false);
  });

  it("is bounded, dropping the oldest entries", () => {
    const { result } = renderHook(() => useLayoutHistory());
    // 60 discrete steps against a limit of 50.
    for (let i = 0; i < 60; i++) {
      act(() => { result.current.record(snap(`s${i}`)); });
    }
    let last: LayoutSnapshot | null = null;
    for (let i = 0; i < 50; i++) {
      act(() => { last = result.current.undo(snap("current")); });
    }
    // The 50 most recent survived, so the last one reached is s10 — not s0.
    expect(markerOf(last)).toBe("s10");
    expect(result.current.canUndo).toBe(false);
  });

  it("clear empties both stacks", () => {
    const { result } = renderHook(() => useLayoutHistory());
    act(() => { result.current.record(snap("a")); });
    act(() => { result.current.undo(snap("b")); });
    expect(result.current.canRedo).toBe(true);

    act(() => { result.current.clear(); });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("survives repeats faster than a render, as a held-down Ctrl+Z produces", () => {
    const { result } = renderHook(() => useLayoutHistory());
    act(() => { result.current.record(snap("a")); });
    act(() => { result.current.record(snap("b")); });
    act(() => { result.current.record(snap("c")); });

    // Three undos inside ONE act: React has not re-rendered between them, so a hook
    // reading its stacks from state would return "c" every time.
    const seen: (string | null)[] = [];
    act(() => {
      seen.push(markerOf(result.current.undo(snap("d"))));
      seen.push(markerOf(result.current.undo(snap("c"))));
      seen.push(markerOf(result.current.undo(snap("b"))));
    });
    expect(seen).toEqual(["c", "b", "a"]);
  });
});
