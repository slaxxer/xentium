import { describe, it, expect } from "vitest";
import { sanitizeImportedPost } from "./sanitize.js";

describe("imported posts", () => {
  it("drops script links, scripts and handlers", () => {
    expect(sanitizeImportedPost('<a href="javascript:alert(1)">x</a>')).toBe("<p><a target=\"_blank\" rel=\"noopener noreferrer nofollow\">x</a></p>");
    expect(sanitizeImportedPost('<p onclick="x()">hi</p><script>bad()</script>')).toBe("<p>hi</p>");
    expect(sanitizeImportedPost('<a href="//evil.test">x</a>')).not.toContain("evil.test");
  });

  it("comes out in the editor's own shape", () => {
    expect(sanitizeImportedPost("Hello <strong>world</strong><br/><br/>Second line<br/>same para"))
      .toBe("<p>Hello <strong>world</strong></p><p>Second line<br />same para</p>");
    expect(sanitizeImportedPost("<pre>a &lt; b</pre>")).toBe("<pre><code>a &lt; b</code></pre>");
    expect(sanitizeImportedPost('<blockquote><p><strong>alice wrote:</strong></p>hi</blockquote>'))
      .toBe("<blockquote><p><strong>alice wrote:</strong></p><p>hi</p></blockquote>");
    expect(sanitizeImportedPost("<ul><li>one</li><li>two</li></ul>")).toBe("<ul><li><p>one</p></li><li><p>two</p></li></ul>");
    expect(sanitizeImportedPost("<blockquote>q</blockquote><br/>Hi!<br/>")).toBe("<blockquote><p>q</p></blockquote><p>Hi!</p>");
  });

  it("turns outside images into links, as the editor keeps no outside images in posts", () => {
    expect(sanitizeImportedPost('<img src="https://x.test/a.png"/>'))
      .toBe('<p><a target="_blank" rel="noopener noreferrer nofollow" href="https://x.test/a.png">https://x.test/a.png</a></p>');
    expect(sanitizeImportedPost('<img src="data:image/png;base64,AAA"/>')).toBe("<p></p>");
  });

  it("links get the editor's rel", () => {
    expect(sanitizeImportedPost('<a href="https://ok.test">ok</a>')).toBe('<p><a target="_blank" rel="noopener noreferrer nofollow" href="https://ok.test">ok</a></p>');
  });
});
