import { describe, it, expect } from "vitest";
import { convertPostText } from "./postText.js";
import { detectScheme, mapUser, mapForum } from "./mapping.js";

describe("legacy post text (3.0/3.1 bbcode_uid)", () => {
  const UID = "1a2b3c4d";

  it("strips the uid and converts basic bbcode", () => {
    const html = convertPostText(
      `Some [b:${UID}]bold[/b:${UID}] and [i:${UID}]italic[/i:${UID}] text`, UID,
    );
    expect(html).toBe("Some <strong>bold</strong> and <em>italic</em> text");
  });

  it("converts quotes with author, links, images and lists", () => {
    const html = convertPostText(
      `[quote=&quot;alice&quot;:${UID}]hi[/quote:${UID}]` +
      `[url=https://x.test:${UID}]link[/url:${UID}]` +
      `[img:${UID}]https://x.test/a.png[/img:${UID}]` +
      `[list:${UID}][*:${UID}]one[/*:m:${UID}][*:${UID}]two[/*:m:${UID}][/list:u:${UID}]`,
      UID,
    );
    expect(html).toContain("<blockquote><p><strong>alice wrote:</strong></p>hi</blockquote>");
    expect(html).toContain('<a href="https://x.test">link</a>');
    expect(html).toContain('<img src="https://x.test/a.png"/>');
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
  });

  it("replaces smilies with their code and unwraps magic links", () => {
    const html = convertPostText(
      `hello <!-- s:) --><img src="{SMILIES_PATH}/icon_smile.gif" alt=":)" title="Smile" /><!-- s:) --> ` +
      `<!-- m --><a class="postlink" href="https://x.test">https://x.test</a><!-- m -->`,
      UID,
    );
    expect(html).toContain("hello :)");
    expect(html).toContain('<a href="https://x.test">https://x.test</a>');
    expect(html).not.toContain("<!--");
  });

  it("preserves phpBB's entity escaping and converts newlines", () => {
    const html = convertPostText(`1 &lt; 2\nnew line`, "");
    expect(html).toBe("1 &lt; 2<br/>new line");
  });
});

describe("s9e post text (3.2+ XML)", () => {
  it("unwraps plain <t> posts", () => {
    expect(convertPostText("<t>Just plain text<br/>second line</t>", null))
      .toBe("Just plain text<br/>second line");
  });

  it("converts rich <r> posts, dropping the bbcode source markers", () => {
    const html = convertPostText(
      `<r><B><s>[b]</s>bold<e>[/b]</e></B> and <URL url="https://x.test"><s>[url]</s>x<e>[/url]</e></URL> ` +
      `<E>:lol:</E><QUOTE author="bob"><s>[quote=bob]</s>quoted<e>[/quote]</e></QUOTE></r>`,
      null,
    );
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('<a href="https://x.test">x</a>');
    expect(html).toContain(":lol:");
    expect(html).toContain("<blockquote><p><strong>bob wrote:</strong></p>quoted</blockquote>");
    expect(html).not.toContain("[b]");
  });

  it("escapes text content (no raw HTML smuggling)", () => {
    const html = convertPostText(`<t>evil &lt;script&gt;alert(1)&lt;/script&gt;</t>`, null);
    expect(html).not.toContain("<script>");
  });
});

describe("mapping", () => {
  it("detects password schemes", () => {
    expect(detectScheme("$2y$10$abcdefghij")).toBe("bcrypt");
    expect(detectScheme("$H$9abcdefghij")).toBe("phpass");
    expect(detectScheme("$P$9abcdefghij")).toBe("phpass");
    expect(detectScheme("5f4dcc3b5aa765d61d8327deb882cf99")).toBeUndefined();
  });

  it("maps founders to admin and keeps hashes only for supported schemes", () => {
    const founder = mapUser(
      { user_id: 1, username: "root", user_email: "root@x.test", user_password: "$2y$10$x", user_regdate: 1600000000, user_type: 3 },
      undefined,
    )!;
    expect(founder.role).toBe("admin");
    expect(founder.passwordScheme).toBe("bcrypt");

    const md5User = mapUser(
      { user_id: 2, username: "old", user_email: "old@x.test", user_password: "5f4dcc3b5aa765d61d8327deb882cf99", user_regdate: 0, user_type: 0 },
      "moderator",
    )!;
    expect(md5User.passwordHash).toBeUndefined();
    expect(md5User.role).toBe("moderator");
  });

  it("maps the forum tree and drops link forums", () => {
    expect(mapForum({ forum_id: 1, parent_id: 0, forum_name: "Cat", forum_desc: "", forum_type: 0, left_id: 1 }, 0))
      .toMatchObject({ type: "category", parentSourceId: undefined });
    expect(mapForum({ forum_id: 2, parent_id: 1, forum_name: "General", forum_desc: "Talk", forum_type: 1, left_id: 2 }, 1))
      .toMatchObject({ type: "forum", parentSourceId: "1" });
    expect(mapForum({ forum_id: 3, parent_id: 1, forum_name: "Link", forum_desc: "", forum_type: 2, left_id: 3 }, 2))
      .toBeNull();
  });
});
