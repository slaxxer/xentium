import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { toast, getToasts, onToast, registerToastCategory, getToastCategoryDef, __resetToasts } from "./toast";

describe("toast store", () => {
  beforeEach(() => { vi.useFakeTimers(); __resetToasts(); });
  afterEach(() => { vi.useRealTimers(); });

  it("shows a toast and auto-dismisses after its category duration", () => {
    toast.success("saved");
    expect(getToasts()).toHaveLength(1);
    vi.advanceTimersByTime(3400);
    expect(getToasts()).toHaveLength(1);
    vi.advanceTimersByTime(200);
    expect(getToasts()).toHaveLength(0);
  });

  it("errors live longer than successes", () => {
    toast.success("ok");
    toast.error("boom");
    vi.advanceTimersByTime(4000);
    expect(getToasts().map((t) => t.category)).toEqual(["error"]);
    vi.advanceTimersByTime(7000);
    expect(getToasts()).toHaveLength(0);
  });

  it("dedups identical messages into a ×N counter and restarts the clock", () => {
    toast.success("saved");
    vi.advanceTimersByTime(3000);
    toast.success("saved");
    expect(getToasts()).toHaveLength(1);
    expect(getToasts()[0]!.count).toBe(2);
    vi.advanceTimersByTime(3000);            // would have expired without restart
    expect(getToasts()).toHaveLength(1);
    vi.advanceTimersByTime(600);
    expect(getToasts()).toHaveLength(0);
  });

  it("caps visible toasts at 4 and promotes from the queue", () => {
    for (let i = 0; i < 6; i++) toast.info(`msg ${i}`);
    expect(getToasts()).toHaveLength(4);
    toast.dismiss(getToasts()[0]!.id);
    expect(getToasts()).toHaveLength(4);      // one promoted
    expect(getToasts().some((t) => t.message === "msg 4")).toBe(true);
  });

  it("pause freezes the timer, resume continues from the remainder", () => {
    const id = toast.success("hover me");     // 3500ms
    vi.advanceTimersByTime(3000);
    toast.pause(id);
    vi.advanceTimersByTime(60_000);           // frozen
    expect(getToasts()).toHaveLength(1);
    toast.resume(id);
    vi.advanceTimersByTime(400);
    expect(getToasts()).toHaveLength(1);      // ~500ms remained
    vi.advanceTimersByTime(200);
    expect(getToasts()).toHaveLength(0);
  });

  it("notifies bus listeners for every emit (plugin hook)", () => {
    const seen: string[] = [];
    const off = onToast((t) => seen.push(`${t.category}:${t.message}`));
    toast.warning("careful");
    off();
    toast.info("silent to the bus");
    expect(seen).toEqual(["warning:careful"]);
  });

  it("supports plugin-registered custom categories with their own duration", () => {
    registerToastCategory({ id: "reputation", color: "var(--c-accent)", duration: 1000 });
    expect(getToastCategoryDef("reputation")?.color).toBe("var(--c-accent)");
    toast.emit("reputation", "+10 rep");
    expect(getToasts()[0]!.duration).toBe(1000);
    vi.advanceTimersByTime(1100);
    expect(getToasts()).toHaveLength(0);
  });
});
