import { describe, expect, it } from "vitest";
import { resolveOldAddress, type RedirectSpec } from "./redirects.js";

describe("resolveOldAddress", () => {
  const spec: RedirectSpec = {
    patterns: [
      { entity: "post", regex: String.raw`^/t/\d+\?p=(?<id>\d+)` },
      { entity: "thread", regex: String.raw`^/t/(?<id>\d+)` },
      { entity: "thread", regex: String.raw`^/(?:[^/?]+/)+(?<id>\d+)-` },
    ],
    exact: [{ entity: "forum_node", path: "/news/2020-archive", sourceId: "9" }],
  };

  it("prefers a post over the thread it names", () => {
    expect(resolveOldAddress(spec, "/t/5?p=12")).toEqual({ entity: "post", id: "12" });
    expect(resolveOldAddress(spec, "/T/5")).toEqual({ entity: "thread", id: "5" });
  });

  it("lets an exact address win over another kind's pattern", () => {
    expect(resolveOldAddress(spec, "/news/2020-archive")).toEqual({ entity: "forum_node", id: "9" });
  });

  it("returns null for anything else", () => {
    expect(resolveOldAddress(spec, "/about")).toBeNull();
  });
});
