import { describe, it, expect } from "vitest";
import { isWoltlabHtml, wcfBbcodeToHtml, woltlabHtmlToHtml, woltlabMessageToHtml } from "./message.js";
import { boardKind, isLanguageKey, passwordOf, postSkipReason, prefixesOf, threadSkipReason } from "./mapping.js";

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64");

describe("WoltLab HTML messages", () => {
  it("turns quotes into blockquotes with the author", () => {
    expect(woltlabHtmlToHtml('<woltlab-quote data-author="alice" data-link="https://x.test/p/1"><p>hi</p></woltlab-quote>'))
      .toBe("<blockquote><p><strong>alice wrote:</strong></p><p>hi</p></blockquote>");
    expect(woltlabHtmlToHtml("<woltlab-quote><p>anon</p></woltlab-quote>")).toBe("<blockquote><p>anon</p></blockquote>");
  });

  it("escapes a quote author", () => {
    expect(woltlabHtmlToHtml('<woltlab-quote data-author="&lt;b&gt;x&lt;/b&gt;"></woltlab-quote>')).toContain("&lt;b&gt;x&lt;/b&gt; wrote:");
  });

  it("handles metacode: attachments, media, mentions", () => {
    const html = woltlabHtmlToHtml(
      `<p><woltlab-metacode data-name="attach" data-attributes="${b64([12, "auto", true])}"></woltlab-metacode> ` +
      `<woltlab-metacode data-name="media" data-attributes="${b64(["https://youtu.be/abc"])}"></woltlab-metacode> ` +
      `<woltlab-metacode data-name="user" data-attributes="${b64([3])}">alice</woltlab-metacode></p>`,
    );
    expect(html).toContain("[attachment]");
    expect(html).toContain('<a href="https://youtu.be/abc">https://youtu.be/abc</a>');
    expect(html).toContain("alice");
    expect(html).not.toContain("woltlab-");
  });

  it("unwraps spoilers and replaces smileys with their meaning", () => {
    expect(woltlabHtmlToHtml('<woltlab-spoiler data-label="x"><p>hidden</p></woltlab-spoiler>')).toBe("<p>hidden</p>");
    expect(woltlabHtmlToHtml('<p>hi <img src="https://x.test/smilies/a.png" alt=":)" class="smiley" height="23"></p>')).toBe("<p>hi :)</p>");
  });
});

describe("Burning Board 4 BBCode", () => {
  it("is detected and converted", () => {
    expect(isWoltlabHtml("[b]x[/b]")).toBe(false);
    expect(isWoltlabHtml("<p>x</p>")).toBe(true);
    expect(woltlabMessageToHtml("[quote='alice','https://x.test']hi[/quote] [b]b[/b] [url='https://ok.test']ok[/url] & <x>"))
      .toBe('<blockquote><p><strong>alice wrote:</strong></p>hi</blockquote> <strong>b</strong> <a href="https://ok.test">ok</a> &amp; &lt;x&gt;');
  });

  it("never emits a script link and keeps code verbatim", () => {
    expect(wcfBbcodeToHtml("[url=javascript:alert(1)]x[/url]")).toBe("x");
    expect(wcfBbcodeToHtml("[code]a < b [b]x[/b][/code]")).toBe("<pre>a &lt; b [b]x[/b]</pre>");
  });
});

describe("passwords", () => {
  it("reads WoltLab's stored formats", () => {
    expect(passwordOf("Bcrypt:$2y$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234")).toMatchObject({ passwordScheme: "bcrypt" });
    expect(passwordOf("DoubleBcrypt:$2a$08$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234")).toMatchObject({ passwordScheme: "wcf-double-bcrypt" });
    expect(passwordOf("$2a$08$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234")).toMatchObject({ passwordScheme: "wcf-double-bcrypt" });
    expect(passwordOf(`wcf1:${"a".repeat(40)}:${"b".repeat(40)}`)).toEqual({ passwordHash: `${"a".repeat(40)}:${"b".repeat(40)}`, passwordScheme: "wcf1" });
    expect(passwordOf("phpbb3:$H$9abcdefgh")).toEqual({});
    expect(passwordOf("invalid:")).toEqual({});
    expect(passwordOf(null)).toEqual({});
  });
});

describe("mapping", () => {
  it("reads the instance from --prefix", () => {
    expect(prefixesOf(undefined)).toEqual({ wcf: "wcf1_", wbb: "wbb1_", n: 1 });
    expect(prefixesOf("3")).toMatchObject({ wcf: "wcf3_", wbb: "wbb3_" });
    expect(prefixesOf("wcf2_")).toMatchObject({ wcf: "wcf2_" });
  });

  it("maps board types and skips", () => {
    expect(boardKind(0)).toBe("forum");
    expect(boardKind(1)).toBe("category");
    expect(boardKind(2)).toBeNull();
    expect(threadSkipReason({ userID: 1 })).toBeNull();
    expect(threadSkipReason({ userID: 1, movedThreadID: 9 })).toMatch(/moved/);
    expect(threadSkipReason({ userID: null })).toMatch(/guest/);
    expect(postSkipReason({ userID: 1, isDisabled: 1 })).toMatch(/moderation/);
    expect(isLanguageKey("wbb.board.board3.title")).toBe(true);
    expect(isLanguageKey("General talk")).toBe(false);
  });
});
