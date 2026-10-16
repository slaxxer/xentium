import { describe, it, expect } from "vitest";
import { escapeLikeVb, unescapeVb, vbBbcodeToHtml } from "./bbcode.js";
import {
  mapChannel, mapForum, mapThread, mapUser, nodeSkipReason, passwordOf, postSkipReason, threadSkipReason,
  type VbNodeRow, type VbThreadRow,
} from "./mapping.js";

describe("vBulletin BBCode", () => {
  it("escapes the stored text like vBulletin does, keeping numeric entities", () => {
    expect(escapeLikeVb(`1 < 2 & "x" &#8364;`)).toBe("1 &lt; 2 &amp; &quot;x&quot; &#8364;");
    expect(vbBbcodeToHtml("<script>alert(1)</script>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("converts marks, links and images", () => {
    const html = vbBbcodeToHtml(`[B]bold[/B] [I]it[/I] [URL=https://x.test/?a=1&b=2]link[/URL] [URL]https://y.test[/URL] [IMG]https://x.test/a.png[/IMG]`);
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>it</em>");
    expect(html).toContain('<a href="https://x.test/?a=1&amp;b=2">link</a>');
    expect(html).toContain('<a href="https://y.test">https://y.test</a>');
    expect(html).toContain('<img src="https://x.test/a.png"/>');
  });

  it("never emits a script link", () => {
    expect(vbBbcodeToHtml("[URL=javascript:alert(1)]x[/URL]")).toBe("x");
    expect(vbBbcodeToHtml("[URL]javascript:alert(1)[/URL]")).toBe("javascript:alert(1)");
    expect(vbBbcodeToHtml("[IMG]javascript:alert(1)[/IMG]")).toBe("[image]");
    expect(vbBbcodeToHtml('[URL="x" onmouseover="y"]z[/URL]')).not.toContain("onmouseover=\"");
  });

  it("reads quote metadata from vB3/4 and vB5/6", () => {
    expect(vbBbcodeToHtml("[QUOTE=alice;123]hi[/QUOTE]")).toBe("<blockquote><p><strong>alice wrote:</strong></p>hi</blockquote>");
    expect(vbBbcodeToHtml("[QUOTE=bob;n456]yo[/QUOTE]")).toContain("<strong>bob wrote:</strong>");
    expect(vbBbcodeToHtml("[QUOTE]plain[/QUOTE]")).toBe("<blockquote>plain</blockquote>");
  });

  it("keeps code verbatim and leaves noparse unparsed", () => {
    expect(vbBbcodeToHtml("[CODE]if (a < b) [B]x[/B]\nnext[/CODE]")).toBe("<pre>if (a &lt; b) [B]x[/B]\nnext</pre>");
    expect(vbBbcodeToHtml("[PHP]<?php echo 1;[/PHP]")).toBe("<pre>&lt;?php echo 1;</pre>");
    expect(vbBbcodeToHtml("[NOPARSE][B]not bold[/B][/NOPARSE]")).toBe("[B]not bold[/B]");
  });

  it("handles lists, mentions, videos, attachments and vB5 images", () => {
    const html = vbBbcodeToHtml(
      "[LIST]\n[*]one\n[*]two[/*]\n[/LIST] [LIST=1][*]a[/LIST] [MENTION=4]alice[/MENTION] " +
      "[VIDEO=youtube;dQw4w9WgXcQ]https://www.youtube.com/watch?v=dQw4w9WgXcQ[/VIDEO] [ATTACH=CONFIG]12[/ATTACH] " +
      '[IMG2=JSON]{"data-align":"none","src":"https://x.test/b.jpg"}[/IMG2]',
    );
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(html).toContain("<ol><li>a</li></ol>");
    expect(html).toContain("@alice");
    expect(html).toContain('<a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">');
    expect(html).toContain("[attachment]");
    expect(html).toContain('<img src="https://x.test/b.jpg"/>');
  });

  it("unwraps layout tags and keeps their text", () => {
    expect(vbBbcodeToHtml("[COLOR=red][SIZE=3]hi[/SIZE][/COLOR] [CENTER]mid[/CENTER]")).toBe("hi mid");
  });

  it("turns stored titles and names back into plain text", () => {
    expect(unescapeVb("Tom &amp; Jerry &quot;&lt;3&quot; &#8364;")).toBe('Tom & Jerry "<3" €');
  });
});

describe("passwords", () => {
  it("carries vB3/4 md5 + salt", () => {
    expect(passwordOf({ userid: 1, username: "a", email: "a@x", joindate: 0, usergroupid: 2, membergroupids: "",
      password: "5F4DCC3B5AA765D61D8327DEB882CF99", salt: "a:b" }))
      .toEqual({ passwordHash: "5f4dcc3b5aa765d61d8327deb882cf99:a:b", passwordScheme: "vb-md5salt" });
  });

  it("carries vB5/6 blowfish and legacy accounts", () => {
    const base = { userid: 1, username: "a", email: "a@x", joindate: 0, usergroupid: 2, membergroupids: "" };
    expect(passwordOf({ ...base, token: "$2y$10$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUVWXYZ012345", scheme: "blowfish:11", secret: "" }))
      .toMatchObject({ passwordScheme: "vb-bcrypt-md5" });
    expect(passwordOf({ ...base, token: "5f4dcc3b5aa765d61d8327deb882cf99", scheme: "legacy", secret: "xyz" }))
      .toEqual({ passwordHash: "5f4dcc3b5aa765d61d8327deb882cf99:xyz", passwordScheme: "vb-md5salt" });
    expect(passwordOf({ ...base, token: "", scheme: "", secret: "" })).toEqual({});
  });
});

describe("mapping", () => {
  it("maps stock groups to roles", () => {
    const u = (usergroupid: number, membergroupids = "") =>
      mapUser({ userid: 1, username: "a", email: "a@x", joindate: 1500000000, usergroupid, membergroupids, password: "", salt: "" })!;
    expect(u(6).role).toBe("admin");
    expect(u(2, "7").role).toBe("moderator");
    expect(u(5).role).toBe("moderator");
    expect(u(2).role).toBeUndefined();
    expect(mapUser({ userid: 2, username: "", email: "a@x", joindate: 0, usergroupid: 2, membergroupids: "" })).toBeNull();
  });

  it("maps vB3/4 forums: categories, forums, link forums", () => {
    expect(mapForum({ forumid: 1, parentid: -1, title: "Cat", description: "", displayorder: 1, options: 1, link: "" }))
      .toMatchObject({ type: "category", parentSourceId: undefined });
    expect(mapForum({ forumid: 2, parentid: 1, title: "A &amp; B", description: "", displayorder: 2, options: 1 | 4, link: "" }))
      .toMatchObject({ type: "forum", parentSourceId: "1", name: "A & B" });
    expect(mapForum({ forumid: 3, parentid: 1, title: "L", description: "", displayorder: 3, options: 4, link: "https://x" })).toBeNull();
  });

  it("decides which vB3/4 threads and posts move over", () => {
    const t = (o: Partial<VbThreadRow>): VbThreadRow =>
      ({ threadid: 1, forumid: 2, title: "T", postuserid: 3, dateline: 0, open: 1, sticky: 0, views: 0, visible: 1, ...o });
    expect(threadSkipReason(t({}))).toBeNull();
    expect(threadSkipReason(t({ open: 10 }))).toMatch(/moved/);
    expect(threadSkipReason(t({ visible: 0 }))).toMatch(/moderation/);
    expect(threadSkipReason(t({ visible: 2 }))).toMatch(/deleted/);
    expect(threadSkipReason(t({ postuserid: 0 }))).toMatch(/guest/);
    expect(mapThread(t({ open: 0, sticky: 1 }))).toMatchObject({ status: "locked", isPinned: true });
    expect(postSkipReason({ visible: 1, userid: 0 })).toMatch(/guest/);
  });

  it("maps vB5/6 channels and content nodes", () => {
    expect(mapChannel({ nodeid: 10, parentid: 2, title: "Main", description: null, displayorder: 1, category: 1 }, 2))
      .toMatchObject({ type: "category", parentSourceId: undefined });
    expect(mapChannel({ nodeid: 11, parentid: 10, title: "General", description: null, displayorder: 1, category: 0 }, 2))
      .toMatchObject({ type: "forum", parentSourceId: "10" });
    const n = (o: Partial<VbNodeRow>): VbNodeRow => ({ nodeid: 20, parentid: 11, starter: 20, userid: 3, title: "T", publishdate: 0,
      open: 1, sticky: 0, showpublished: 1, showapproved: 1, rawtext: "x", edited: null, views: null, ...o });
    expect(nodeSkipReason(n({}))).toBeNull();
    expect(nodeSkipReason(n({ showpublished: 0 }))).toMatch(/unpublished/);
    expect(nodeSkipReason(n({ showapproved: 0 }))).toMatch(/moderation/);
    expect(nodeSkipReason(n({ rawtext: null }))).toMatch(/no text/);
  });
});
