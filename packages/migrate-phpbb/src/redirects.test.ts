import { describe, expect, it } from "vitest";
import { OWN_ADDRESS_SAMPLES, resolveOldAddress } from "@xentium/migrate-core";
import { phpbbRedirects } from "./redirects.js";

describe("phpBB redirects", () => {
  it.each([
    ["/viewtopic.php?t=12", "thread", "12"],
    ["/forum/viewtopic.php?f=2&t=12&start=20", "thread", "12"],
    ["/forum/viewtopic.php?f=2&amp;t=12", "thread", "12"],
    ["/viewtopic.php?p=345#p345", "post", "345"],
    ["/viewtopic.php?f=2&t=12&p=345", "post", "345"],
    ["/viewforum.php?f=3", "forum_node", "3"],
    ["/memberlist.php?mode=viewprofile&u=7", "user", "7"],
  ])("%s → %s %s", (uri, entity, id) => {
    expect(resolveOldAddress(phpbbRedirects, uri)).toEqual({ entity, id });
  });

  it("leaves our own addresses alone", () => {
    for (const uri of OWN_ADDRESS_SAMPLES) expect(resolveOldAddress(phpbbRedirects, uri), uri).toBeNull();
  });
});
