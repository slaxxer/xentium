import { describe, expect, it } from "vitest";
import { smileysToEmoji } from "./smileys.js";
import { sanitizeImportedPost } from "./sanitize.js";

describe("smileysToEmoji", () => {
  it.each([
    ["hello :)", "hello 🙂"], [":D great", "😄 great"], ["no :( really", "no 🙁 really"],
    ["wink ;-).", "wink 😉."], ["I :lol: and :rolleyes:", "I 😂 and 🙄"], ["love <3", "love ❤️"],
    ["(:", "🙂"],
  ])("%s", (input, out) => expect(smileysToEmoji(input)).toBe(out));

  it.each([
    "see http://example.com/a", "meet at 12:30", "foo:)", "item 8) and B)", "a:b", "note: done", "x:Dy",
  ])("leaves %s alone", (input) => expect(smileysToEmoji(input)).toBe(input));
});

describe("in imported posts", () => {
  it("converts text but not code or links", () => {
    const html = sanitizeImportedPost('<p>nice :) <code>if (a :) b)</code> <a href="https://x.test/:)">see :)</a></p><pre>x = :D</pre>');
    expect(html).toContain("nice 🙂");
    expect(html).toContain("<code>if (a :) b)</code>");
    expect(html).toContain(">see :)</a>");
    expect(html).toContain("x = :D");
  });
});
