import { describe, expect, it } from "vitest";
import { prefixedLink } from "./profileLink";

const GH = "https://github.com/";

describe("prefixedLink", () => {
  it("appends a name to the prefix", () => {
    expect(prefixedLink(GH, "octocat")).toEqual({ href: "https://github.com/octocat", text: "octocat" });
    expect(prefixedLink(GH, " @octocat ")).toEqual({ href: "https://github.com/octocat", text: "octocat" });
  });
  it("uses a full address on the same site as typed, showing the name", () => {
    expect(prefixedLink(GH, "https://github.com/slaxxer")).toEqual({ href: "https://github.com/slaxxer", text: "slaxxer" });
  });
  it("does not link an address on another site", () => {
    expect(prefixedLink(GH, "https://evil.example/x")).toBeNull();
    expect(prefixedLink(GH, "javascript:alert(1)")).toEqual({ href: "https://github.com/javascript%3Aalert(1)", text: "javascript:alert(1)" });
  });
  it("keeps a path's slashes and encodes the rest", () => {
    expect(prefixedLink(GH, "org/repo")?.href).toBe("https://github.com/org/repo");
    expect(prefixedLink(GH, "a b?c")?.href).toBe("https://github.com/a%20b%3Fc");
  });
  it("needs an http(s) prefix and a name", () => {
    expect(prefixedLink("javascript:", "x")).toBeNull();
    expect(prefixedLink(GH, "  ")).toBeNull();
  });
});
