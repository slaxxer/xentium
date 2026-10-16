import { describe, expect, it } from "vitest";
import { OWN_ADDRESS_SAMPLES, resolveOldAddress, type RedirectSpec } from "@xentium/migrate-core";
import { classicRedirects, nodeRedirects } from "./redirects.js";

describe("vBulletin 3/4 redirects", () => {
  it.each([
    ["/showthread.php?t=12", "thread", "12"],
    ["/forum/showthread.php?12-Welcome", "thread", "12"],
    ["/showthread.php/12-Welcome", "thread", "12"],
    ["/showthread.php?t=12&page=2", "thread", "12"],
    ["/showthread.php?p=345#post345", "post", "345"],
    ["/showpost.php?p=345&postcount=4", "post", "345"],
    ["/showthread.php?12-Welcome&p=345", "post", "345"],
    ["/threads/12-Welcome?p=345", "post", "345"],
    ["/threads/12-Welcome", "thread", "12"],
    ["/forumdisplay.php?f=3", "forum_node", "3"],
    ["/forumdisplay.php?3-General", "forum_node", "3"],
    ["/forums/3-General", "forum_node", "3"],
    ["/member.php?u=7", "user", "7"],
    ["/member.php?7-alice", "user", "7"],
    ["/members/7-alice", "user", "7"],
  ])("%s → %s %s", (uri, entity, id) => {
    expect(resolveOldAddress(classicRedirects, uri)).toEqual({ entity, id });
  });

  it("leaves our own addresses alone", () => {
    for (const uri of OWN_ADDRESS_SAMPLES) expect(resolveOldAddress(classicRedirects, uri), uri).toBeNull();
  });
});

describe("vBulletin 5/6 redirects", async () => {
  // The route table, as a fake connection: two channels, one named like a topic.
  const conn = { query: async () => [[{ prefix: "forum/main-category/general", contentid: 11 }, { prefix: "forum/2020-archive", contentid: 12 }]] };
  const spec: RedirectSpec = await nodeRedirects(conn as never, "");

  it.each([
    ["/forum/main-category/general/20-first-topic", "thread", "20"],
    ["/forum/main-category/general/20-first-topic/page2", "thread", "20"],
    ["/forum/main-category/general/20-first-topic?p=21#post21", "post", "21"],
    ["/forum/main-category/general", "forum_node", "11"],
    ["/forum/main-category/general/", "forum_node", "11"],
    ["/forum/2020-archive", "forum_node", "12"],
    ["/member/7-alice", "user", "7"],
  ])("%s → %s %s", (uri, entity, id) => {
    expect(resolveOldAddress(spec, uri)).toEqual({ entity, id });
  });

  it("leaves our own addresses alone", () => {
    for (const uri of OWN_ADDRESS_SAMPLES) {
      // "/forum/2020-archive" is this board's own channel in the fixture above.
      if (uri === "/forum/2020-archive") continue;
      expect(resolveOldAddress(spec, uri), uri).toBeNull();
    }
  });
});
