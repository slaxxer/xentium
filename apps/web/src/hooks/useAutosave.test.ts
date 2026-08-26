import { describe, it, expect } from "vitest";
import { stableStringify, sameValue } from "./useAutosave";

/**
 * These two functions decide whether an ACP form has unsaved changes. Getting
 * that wrong is not a cosmetic bug: a draft that can never match its saved value
 * saves, refetches, disagrees again, and saves forever.
 */
describe("stableStringify", () => {
  it("ignores object key order", () => {
    // Postgres jsonb returns an object's keys in its own order (shortest first),
    // not the order the client wrote them — the case that caused the loop.
    const written = { icon: "link", label: "", url: "https://x" };
    const readBack = { url: "https://x", icon: "link", label: "" };
    expect(stableStringify(written)).toBe(stableStringify(readBack));
  });

  it("sorts keys nested inside arrays", () => {
    expect(stableStringify([{ a: 1, b: 2 }])).toBe(stableStringify([{ b: 2, a: 1 }]));
  });

  it("keeps array order significant", () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it("still separates genuinely different values", () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 1, b: 1 }));
  });

  it("handles null, primitives and empties", () => {
    expect(stableStringify(null)).toBe("null");
    expect(stableStringify("x")).toBe('"x"');
    expect(stableStringify([])).toBe("[]");
    expect(stableStringify({})).toBe("{}");
  });
});

describe("sameValue", () => {
  it("is true for the same data in a different key order", () => {
    expect(sameValue(
      [{ name: "Search", status: "degraded" }],
      [{ status: "degraded", name: "Search" }],
    )).toBe(true);
  });

  it("is false when a value actually changed", () => {
    expect(sameValue(
      [{ name: "Search", status: "degraded" }],
      [{ name: "Search", status: "offline" }],
    )).toBe(false);
  });

  it("distinguishes a missing key from an undefined one the same way JSON does", () => {
    // Both serialise to {} — the settings merge treats them as equal, which is
    // what we want: an absent setting and one explicitly unset are one state.
    expect(sameValue({}, { a: undefined })).toBe(true);
  });
});
