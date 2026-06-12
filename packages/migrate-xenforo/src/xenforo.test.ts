import { describe, it, expect } from "vitest";
import { xfBbcodeToHtml, extractBcryptHash } from "./bbcode.js";
import { mapUser, mapNode, decodeVersionId } from "./mapping.js";

describe("XenForo BBCode", () => {
  it("converts basic marks, links and images", () => {
    const html = xfBbcodeToHtml(
      `Some [B]bold[/B] and [I]italic[/I], a [URL='https://x.test']link[/URL] and [IMG]https://x.test/a.png[/IMG]`,
    );
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain('<a href="https://x.test">link</a>');
    expect(html).toContain('<img src="https://x.test/a.png"/>');
  });

  it("extracts the author from XenForo quote metadata", () => {
    const html = xfBbcodeToHtml(`[QUOTE="alice, post: 123, member: 4"]hi there[/QUOTE]`);
    expect(html).toContain("<blockquote><p><strong>alice wrote:</strong></p>hi there</blockquote>");
  });

  it("handles lists, mentions, media and attachments", () => {
    const html = xfBbcodeToHtml(
      `[LIST]\n[*]one\n[*]two\n[/LIST] hi [USER=4]@alice[/USER] [MEDIA=youtube]dQw4w9WgXcQ[/MEDIA] [ATTACH]55[/ATTACH]`,
    );
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>two</li>");
    expect(html).toContain("@alice");
    expect(html).not.toContain("[USER");
    expect(html).toContain("youtube: dQw4w9WgXcQ");
    expect(html).toContain("[attachment]");
  });

  it("keeps escaped text escaped and converts newlines", () => {
    expect(xfBbcodeToHtml("1 &lt; 2\nnext")).toBe("1 &lt; 2<br/>next");
  });
});

describe("auth hash extraction (PHP-serialized)", () => {
  const BLOB = 'a:1:{s:4:"hash";s:60:"$2y$10$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUVWXYZ012345";}';

  it("extracts bcrypt from XF:Core12 blobs", () => {
    expect(extractBcryptHash("XF:Core12", BLOB)).toMatch(/^\$2y\$10\$/);
    expect(extractBcryptHash("XenForo_Authentication_Core12", Buffer.from(BLOB))).toMatch(/^\$2y\$/);
  });

  it("rejects legacy import schemes", () => {
    expect(extractBcryptHash("XF:Legacy_phpBB3", BLOB)).toBeNull();
    expect(extractBcryptHash("XF:Core12", 'a:1:{s:4:"hash";s:32:"5f4dcc3b5aa765d61d8327deb882cf99";}')).toBeNull();
  });
});

describe("mapping", () => {
  it("maps users with roles and hash handling", () => {
    const admin = mapUser({
      user_id: 1, username: "root", email: "root@x.test", register_date: 1500000000,
      user_state: "valid", is_admin: 1, is_moderator: 1,
      scheme_class: "XF:Core12",
      auth_data: 'a:1:{s:4:"hash";s:60:"$2y$10$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUVWXYZ012345";}',
    })!;
    expect(admin.role).toBe("admin");
    expect(admin.passwordScheme).toBe("bcrypt");

    const legacy = mapUser({
      user_id: 2, username: "old", email: "old@x.test", register_date: 0,
      user_state: "valid", is_admin: 0, is_moderator: 1, scheme_class: "XF:Legacy_vBulletin", auth_data: "x",
    })!;
    expect(legacy.passwordHash).toBeUndefined();
    expect(legacy.role).toBe("moderator");
  });

  it("maps the node tree and skips pages/links", () => {
    expect(mapNode({ node_id: 1, parent_node_id: 0, title: "Cat", description: "", node_type_id: "Category", display_order: 1 }))
      .toMatchObject({ type: "category" });
    expect(mapNode({ node_id: 2, parent_node_id: 1, title: "Gen", description: "", node_type_id: "Forum", display_order: 2 }))
      .toMatchObject({ type: "forum", parentSourceId: "1" });
    expect(mapNode({ node_id: 3, parent_node_id: 1, title: "Link", description: "", node_type_id: "LinkForum", display_order: 3 }))
      .toBeNull();
  });

  it("decodes XenForo version ids", () => {
    expect(decodeVersionId(2021370)).toBe("2.2.13");
    expect(decodeVersionId(2030070)).toBe("2.3.0");
  });
});
