import { describe, expect, it } from "vitest";
import { OWN_ADDRESS_SAMPLES, resolveOldAddress } from "@xentium/migrate-core";
import { xenforoRedirects } from "./redirects.js";

describe("XenForo redirects", () => {
  it.each([
    ["/threads/welcome-everyone.12/", "thread", "12"],
    ["/community/threads/welcome.12/page-3", "thread", "12"],
    ["/index.php?threads/welcome.12/", "thread", "12"],
    ["/threads/12/", "thread", "12"],
    ["/threads/welcome.12/post-345", "post", "345"],
    ["/posts/345/", "post", "345"],
    ["/goto/post?id=345", "post", "345"],
    ["/forums/general.3/", "forum_node", "3"],
    ["/categories/main.1/", "forum_node", "1"],
    ["/members/alice.7/", "user", "7"],
  ])("%s → %s %s", (uri, entity, id) => {
    expect(resolveOldAddress(xenforoRedirects, uri)).toEqual({ entity, id });
  });

  it("leaves our own addresses alone", () => {
    for (const uri of OWN_ADDRESS_SAMPLES) expect(resolveOldAddress(xenforoRedirects, uri), uri).toBeNull();
  });
});
