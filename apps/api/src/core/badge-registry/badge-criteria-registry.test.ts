/**
 * What a badge is earned for, and — mostly — when it is NOT.
 *
 * ⚠ The risk in an automatic award is handing a badge to people who did not earn it,
 * so nearly every case here is a refusal. A badge wrongly granted to the whole
 * membership cannot be quietly undone: it is visible on every card they appear on.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../infrastructure/db.js", () => ({ prisma: { user: { findUnique: vi.fn() } } }));

const { badgeCriteriaRegistry } = await import("./badge-criteria-registry.js");

const metric = (key: string, value: number | (() => never)) => ({
  key, label: key,
  valueFor: async () => (typeof value === "function" ? value() : value),
});

beforeEach(() => {
  // ⚠ A fresh registry per case. It is a singleton, so keys registered by one test
  // would otherwise decide the next — and "is this metric present" is exactly what
  // several of these assert.
  (badgeCriteriaRegistry as unknown as { entries: Map<string, unknown> }).entries.clear();
});

describe("meeting a badge's thresholds", () => {
  it("grants when every threshold is met", async () => {
    badgeCriteriaRegistry.register("test", metric("articles", 12));
    badgeCriteriaRegistry.register("test", metric("likes", 340));
    await expect(badgeCriteriaRegistry.meets("u1", { articles: 10, likes: 100 })).resolves.toBe(true);
  });

  /** ⚠ ALL, never any — the whole point of the choice. */
  it("refuses when one threshold is short", async () => {
    badgeCriteriaRegistry.register("test", metric("articles", 12));
    badgeCriteriaRegistry.register("test", metric("likes", 4));
    await expect(badgeCriteriaRegistry.meets("u1", { articles: 10, likes: 100 })).resolves.toBe(false);
  });

  it("counts meeting a threshold exactly as meeting it", async () => {
    badgeCriteriaRegistry.register("test", metric("articles", 10));
    await expect(badgeCriteriaRegistry.meets("u1", { articles: 10 })).resolves.toBe(true);
  });

  /**
   * ⚠⚠ THE dangerous case. `[].every(...)` is true, so a badge switched to "earned"
   * with no thresholds filled in would be handed to the entire membership on the
   * first sweep — silently, and on every card they appear on.
   */
  it("refuses a badge with the reward system on and no thresholds set", async () => {
    await expect(badgeCriteriaRegistry.meets("u1", {})).resolves.toBe(false);
    await expect(badgeCriteriaRegistry.meets("u1", { articles: 0 })).resolves.toBe(false);
  });

  /**
   * ⚠ A threshold whose plugin is disabled is SKIPPED, not failed — its value is
   * unknowable, not zero. Failing it would be defensible; but see the next case for
   * why skipping alone is not enough.
   */
  it("still grants on the thresholds it can measure when another's plugin is gone", async () => {
    badgeCriteriaRegistry.register("test", metric("articles", 12));
    await expect(
      badgeCriteriaRegistry.meets("u1", { articles: 10, "forum.posts": 50 }),
    ).resolves.toBe(true);
  });

  /**
   * ⚠⚠ And the trap that follows from skipping: if EVERY threshold belonged to a
   * plugin that is gone, nothing was actually tested. Disabling the forum would then
   * award every forum badge to everyone.
   */
  it("refuses when every threshold belongs to a plugin that is gone", async () => {
    await expect(
      badgeCriteriaRegistry.meets("u1", { "forum.posts": 50, "forum.threads": 5 }),
    ).resolves.toBe(false);
  });

  /** A metric that throws must never award — a broken plugin is not a pass. */
  it("refuses when a metric throws", async () => {
    badgeCriteriaRegistry.register("test", metric("articles", () => { throw new Error("boom"); }));
    await expect(badgeCriteriaRegistry.meets("u1", { articles: 10 })).resolves.toBe(false);
  });

  it("forgets a plugin's metrics when it is disabled", () => {
    badgeCriteriaRegistry.register("forum", metric("forum.posts", 99));
    expect(badgeCriteriaRegistry.get("forum.posts")).toBeTruthy();
    badgeCriteriaRegistry.deregister("forum");
    expect(badgeCriteriaRegistry.get("forum.posts")).toBeUndefined();
  });
});
