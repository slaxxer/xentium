/**
 * The ACP save bar's draft store: what counts as a change, how Save and Discard reach
 * every surface, and the fallbacks that keep shipped plugins and non-ACP pages working.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useState } from "react";
import { DraftFailure, discardAll, saveAll, useDraft, useDraftEpoch, useDraftStore, useSaveBarMounted, type DraftSnapshot } from "./useDraft";

afterEach(() => { cleanup(); vi.useRealTimers(); });

let store: DraftSnapshot;
function Bar() { useSaveBarMounted(); store = useDraftStore(); return null; }

/** A surface with one field. `mode` picks how it saves. */
function Surface({ saved: initial, mode = "promise", withDiscard = true, label = "Name" }: {
  saved: string; mode?: "promise" | "fail" | "fire"; withDiscard?: boolean; label?: string;
}) {
  const [saved, setSaved] = useState(initial);
  const [value, setValue] = useState(initial);
  (Surface as unknown as { set: (v: string) => void }).set = setValue;
  useDraft({
    label,
    value,
    savedValue: saved,
    onSave: (v) => {
      if (mode === "fail") return Promise.reject(new DraftFailure("Too short", "XEC-API-4001", "name"));
      if (mode === "fire") { setTimeout(() => setSaved(v), 10); return undefined; }
      return Promise.resolve().then(() => setSaved(v));
    },
    ...(withDiscard ? { onDiscard: () => setValue(saved) } : {}),
  });
  return <output>{value}</output>;
}
const edit = (v: string) => act(() => (Surface as unknown as { set: (v: string) => void }).set(v));

describe("drafts with a save bar", () => {
  it("count what differs from the server, and nothing else", () => {
    render(<><Bar /><Surface saved="a" /></>);
    expect(store.dirtyCount).toBe(0);
    edit("b");
    expect(store.dirtyCount).toBe(1);
    expect(store.changes[0]!.label).toBe("Name");
    edit("a");                       // typed back to what is saved
    expect(store.dirtyCount).toBe(0);
  });

  it("save only when asked, then report saved", async () => {
    render(<><Bar /><Surface saved="a" /></>);
    edit("b");
    await act(async () => { expect(await saveAll()).toBe(true); });
    expect(store.dirtyCount).toBe(0);
    expect(store.status).toBe("saved");
  });

  it("a failed save names the code and the field, and an edit clears it", async () => {
    render(<><Bar /><Surface saved="a" mode="fail" /></>);
    edit("b");
    await act(async () => { expect(await saveAll()).toBe(false); });
    expect(store.status).toBe("error");
    expect(store.error).toMatchObject({ message: "Too short", code: "XEC-API-4001", field: "name" });
    expect(store.dirtyCount).toBe(1);   // nothing was lost
    edit("bc");
    expect(store.status).toBe("idle");
  });

  it("a plugin that saves with mutate() is done when the server catches up", async () => {
    render(<><Bar /><Surface saved="a" mode="fire" /></>);
    edit("b");
    // Started outside act(): the server's answer has to RENDER before the save can
    // settle, and act() would hold that render back until the save settled.
    let saved: Promise<boolean> | undefined;
    act(() => { saved = saveAll(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(await saved).toBe(true);
    expect(store.dirtyCount).toBe(0);
  });

  it("discard resets a surface that can, and remounts the page for one that cannot", () => {
    let epoch = 0;
    function Epoch() { epoch = useDraftEpoch(); return null; }
    const { container } = render(<><Bar /><Epoch /><Surface saved="a" /></>);
    edit("b");
    act(() => discardAll());
    expect(container.querySelector("output")!.textContent).toBe("a");
    expect(epoch).toBe(0);
    cleanup();

    render(<><Bar /><Epoch /><Surface saved="a" withDiscard={false} /></>);
    edit("b");
    const before = epoch;
    act(() => discardAll());
    expect(epoch).toBe(before + 1);
  });
});

describe("drafts without a save bar", () => {
  it("still autosave — nothing may stop saving because the bar is not there", async () => {
    vi.useFakeTimers();
    const { container } = render(<Surface saved="a" />);
    edit("b");
    await act(async () => { vi.advanceTimersByTime(700); await Promise.resolve(); });
    expect(container.querySelector("output")!.textContent).toBe("b");
    // Saved: a fresh bar would see nothing to do.
    vi.useRealTimers();
    render(<Bar />);
    expect(store.dirtyCount).toBe(0);
  });
});
