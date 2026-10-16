import { describe, expect, it } from "vitest";
import { OWN_ADDRESS_SAMPLES, resolveOldAddress } from "@xentium/migrate-core";
import { woltlabRedirects } from "./redirects.js";

describe("WoltLab redirects", () => {
  it.each([
    ["/forum/index.php?thread/12-welcome/", "thread", "12"],
    ["/forum/thread/12-welcome/", "thread", "12"],
    ["/index.php/Thread/12-welcome/", "thread", "12"],
    ["/forum/thread/12/", "thread", "12"],
    ["/forum/index.php?thread/12-welcome/&postID=345#post345", "post", "345"],
    ["/forum/thread/12-welcome/?postID=345", "post", "345"],
    ["/index.php?page=Thread&threadID=12", "thread", "12"],
    ["/forum/index.php?board/3-general/", "forum_node", "3"],
    ["/index.php?article/5-news/", "article", "5"],
    ["/index.php?user/7-alice/", "user", "7"],
    ["/user/7-alice/", "user", "7"],
  ])("%s → %s %s", (uri, entity, id) => {
    expect(resolveOldAddress(woltlabRedirects, uri)).toEqual({ entity, id });
  });

  it("leaves our own addresses alone", () => {
    for (const uri of OWN_ADDRESS_SAMPLES) expect(resolveOldAddress(woltlabRedirects, uri), uri).toBeNull();
  });
});
