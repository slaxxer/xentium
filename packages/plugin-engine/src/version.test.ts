/**
 * Compatibility bounds. The rule that keeps the ecosystem working — a bound
 * without a prerelease names a release LINE — must survive the rule that lets a
 * plugin say "I need alpha.11": a bound WITH a prerelease is exact.
 */
import { describe, expect, it } from "vitest";
import { compareVersions, meetsMinimum, withinMaximum } from "./version.js";
import { assertCompatible } from "./manifest.js";

describe("compareVersions", () => {
  it("puts a prerelease below its release and compares identifiers numerically", () => {
    expect(compareVersions("1.0.0-alpha.11", "1.0.0")).toBe(-1);
    expect(compareVersions("1.0.0-alpha.10", "1.0.0-alpha.9")).toBe(1);
    expect(compareVersions("1.1.0-alpha.1", "1.0.0")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });
});

describe("meetsMinimum", () => {
  it("reads a bound without a prerelease as the whole line, alphas included", () => {
    expect(meetsMinimum("1.0.0-alpha.3", "1.0")).toBe(true);
    expect(meetsMinimum("1.0.0-alpha.3", "1.0.0")).toBe(true);
    expect(meetsMinimum("0.9.9", "1.0")).toBe(false);
  });

  it("reads a bound with a prerelease exactly", () => {
    expect(meetsMinimum("1.0.0-alpha.10", "1.0.0-alpha.11")).toBe(false);
    expect(meetsMinimum("1.0.0-alpha.11", "1.0.0-alpha.11")).toBe(true);
    expect(meetsMinimum("1.0.0", "1.0.0-alpha.11")).toBe(true);
    expect(meetsMinimum("1.2.0", "1.0.0-alpha.11")).toBe(true);
  });
});

describe("withinMaximum", () => {
  it("applies the same two readings to a ceiling", () => {
    expect(withinMaximum("1.4.0-beta.1", "1.4")).toBe(true);
    expect(withinMaximum("1.5.0", "1.4")).toBe(false);
    expect(withinMaximum("1.0.0", "1.0.0-rc.1")).toBe(false);
  });
});

describe("assertCompatible", () => {
  const manifest = (minXentiumVersion: string) =>
    ({ id: "fx", name: "FX", version: "1.0.0", vendor: "X", minXentiumVersion }) as never;

  it("refuses an older prerelease than the plugin needs, and names both versions", () => {
    expect(() => assertCompatible(manifest("1.0.0-alpha.11"), "1.0.0-alpha.10"))
      .toThrow(/requires Xentium 1\.0\.0-alpha\.11\+ \(this is 1\.0\.0-alpha\.10\)/);
    expect(() => assertCompatible(manifest("1.0.0-alpha.11"), "1.0.0-alpha.11")).not.toThrow();
    expect(() => assertCompatible(manifest("1.0"), "1.0.0-alpha.1")).not.toThrow();
  });
});
