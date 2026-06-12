import { describe, it, expect } from "vitest";
import { htmlToTipTap, htmlToText } from "./htmlToTipTap.js";

describe("htmlToTipTap", () => {
  it("converts wpautop-style plain text (blank lines = paragraphs)", () => {
    const doc = htmlToTipTap("First paragraph.\n\nSecond paragraph\nwith a soft break.");
    expect(doc.type).toBe("doc");
    expect(doc.content).toHaveLength(2);
    expect(doc.content![0]!.type).toBe("paragraph");
    expect(doc.content![0]!.content![0]!.text).toContain("First paragraph.");
    // single newline inside a chunk becomes a hardBreak
    expect(doc.content![1]!.content!.some((n) => n.type === "hardBreak")).toBe(true);
  });

  it("converts headings, lists, blockquotes and code blocks", () => {
    const doc = htmlToTipTap(
      `<h2>Title</h2><ul><li>one</li><li>two</li></ul><blockquote><p>quoted</p></blockquote><pre>const x = 1;</pre>`,
    );
    const types = doc.content!.map((n) => n.type);
    expect(types).toEqual(["heading", "bulletList", "blockquote", "codeBlock"]);
    expect(doc.content![0]!.attrs).toEqual({ level: 2 });
    expect(doc.content![1]!.content).toHaveLength(2);
    expect(doc.content![3]!.content![0]!.text).toBe("const x = 1;");
  });

  it("applies inline marks and links", () => {
    const doc = htmlToTipTap(`<p>Hi <strong>bold <em>both</em></strong> and <a href="https://x.test">link</a></p>`);
    const para = doc.content![0]!;
    const both = para.content!.find((n) => n.text === "both")!;
    expect(both.marks!.map((m) => m.type).sort()).toEqual(["bold", "italic"]);
    const link = para.content!.find((n) => n.text === "link")!;
    expect(link.marks![0]).toEqual({ type: "link", attrs: { href: "https://x.test" } });
  });

  it("keeps images and survives unknown tags", () => {
    const doc = htmlToTipTap(`<figure><img src="/a.png" alt="A"></figure><center>legacy <font>text</font></center>`);
    const flat = JSON.stringify(doc);
    expect(flat).toContain('"src":"/a.png"');
    expect(flat).toContain("legacy text");
  });

  it("never returns an empty document", () => {
    expect(htmlToTipTap("").content).toHaveLength(1);
    expect(htmlToTipTap("<script>evil()</script>").content!.length).toBeGreaterThan(0);
  });
});

describe("htmlToText", () => {
  it("strips tags and normalizes whitespace", () => {
    expect(htmlToText("<p>Hello <b>world</b></p><p>Bye</p>")).toBe("Hello world\nBye");
  });
});
