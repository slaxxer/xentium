import { describe, it, expect } from "vitest";
import { safeReturnTo } from "./returnTo";

describe("safeReturnTo", () => {
  it("keeps in-app relative paths", () => {
    expect(safeReturnTo("/admin/appearance")).toBe("/admin/appearance");
    expect(safeReturnTo("/articles/hello?page=2#top")).toBe("/articles/hello?page=2#top");
  });

  it("falls back to / for nothing", () => {
    expect(safeReturnTo(null)).toBe("/");
    expect(safeReturnTo(undefined)).toBe("/");
    expect(safeReturnTo("")).toBe("/");
  });

  it("rejects absolute and protocol-relative URLs", () => {
    expect(safeReturnTo("https://evil.com")).toBe("/");
    expect(safeReturnTo("//evil.com")).toBe("/");
    expect(safeReturnTo("javascript:alert(1)")).toBe("/");
    expect(safeReturnTo("evil.com")).toBe("/");
  });

  // The react-router GHSA bypass (Dependabot #40): a single leading slash
  // followed by a backslash is protocol-relative once the browser normalises it.
  it("rejects backslash escapes", () => {
    expect(safeReturnTo("/\\evil.com")).toBe("/");
    expect(safeReturnTo("/\\/evil.com")).toBe("/");
    expect(safeReturnTo("/admin\\..\\..\\evil.com")).toBe("/");
  });

  it("rejects control characters and spaces that browsers strip", () => {
    expect(safeReturnTo("/\t/evil.com")).toBe("/");
    expect(safeReturnTo("/\n/evil.com")).toBe("/");
    expect(safeReturnTo("/\r/evil.com")).toBe("/");
    expect(safeReturnTo("/\0/evil.com")).toBe("/");
    expect(safeReturnTo("/ /evil.com")).toBe("/");
    expect(safeReturnTo("/\x7f/evil.com")).toBe("/");
  });
});
