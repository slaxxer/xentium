import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReleaseNotes, parseNotes } from "./ReleaseNotes";

const html = (source: string) => renderToStaticMarkup(<ReleaseNotes source={source} />);

describe("release notes", () => {
  it("reads a changelog's headings, lists and paragraphs", () => {
    const blocks = parseNotes("## Title\n\n### Added\n\n- **One.** First\n  wrapped line\n- Two\n\nA paragraph\nover two lines.");
    expect(blocks).toEqual([
      { kind: "heading", level: 2, text: "Title" },
      { kind: "heading", level: 3, text: "Added" },
      { kind: "list", ordered: false, items: ["**One.** First wrapped line", "Two"] },
      { kind: "paragraph", text: "A paragraph over two lines." },
    ]);
  });

  it("keeps a code block as it is", () => {
    expect(parseNotes("```bash\nnpm install xentium@1\n# not a heading\n```")).toEqual([
      { kind: "code", text: "npm install xentium@1\n# not a heading" },
    ]);
  });

  it("renders inline code, bold and links, and never raw HTML", () => {
    const out = html("Run `xentium update` **now**, see [the guide](https://doc.xentium.org). <img src=x onerror=alert(1)>");
    expect(out).toContain("<code>xentium update</code>");
    expect(out).toContain("<strong>now</strong>");
    expect(out).toContain('href="https://doc.xentium.org"');
    expect(out).not.toContain("<img");
  });

  it("drops a link that is not http(s)", () => {
    const out = html("[click](javascript:alert(1))");
    expect(out).not.toContain("href");
    expect(out).toContain("click");
  });

  it("does not read snake_case as emphasis", () => {
    expect(html("the xcf_oauth_accounts table")).not.toContain("<em>");
  });
});
