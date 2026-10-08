/**
 * What the editor produces must come out of the sanitizer UNCHANGED — formatting a
 * member sees in the editor and loses on posting is the bug this pins (alignment,
 * sub/superscript, task lists and mentions were all stripped). And the dangerous
 * still goes.
 */
import { describe, expect, it } from "vitest";
import { sanitizeRichText } from "./richText.js";

describe("the editor's own output survives", () => {
  it("keeps alignment on paragraphs and headings", () => {
    expect(sanitizeRichText('<p style="text-align: right;">r</p>')).toBe('<p style="text-align:right">r</p>');
    expect(sanitizeRichText('<h2 style="text-align: center;">h</h2>')).toBe('<h2 style="text-align:center">h</h2>');
    expect(sanitizeRichText('<p style="text-align: justify;">j</p>')).toContain("text-align:justify");
  });

  it("keeps every inline mark", () => {
    const html = "<p><strong>b</strong><em>i</em><u>u</u><s>s</s><mark>m</mark><sup>x</sup><sub>y</sub><code>c</code></p>";
    expect(sanitizeRichText(html)).toBe(html);
  });

  it("keeps headings, lists, quotes, code blocks and rules", () => {
    const html = '<h3>t</h3><ul><li><p>a</p></li></ul><ol><li><p>b</p></li></ol><blockquote><p>q</p></blockquote><pre><code class="language-js">a()</code></pre><hr />';
    expect(sanitizeRichText(html)).toBe(html);
  });

  it("keeps a task list, with the box read-only", () => {
    const out = sanitizeRichText('<ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked"><span></span></label><div><p>done</p></div></li></ul>');
    expect(out).toContain('<ul data-type="taskList"><li data-checked="true" data-type="taskItem">');
    expect(out).toContain('<input type="checkbox" disabled="disabled" checked="checked" />');
    expect(out).toContain("<div><p>done</p></div>");
  });

  it("keeps a mention as the editor writes it", () => {
    const out = sanitizeRichText('<a href="/u/abc" class="nvc-mention" data-type="mention" data-id="abc">@mara</a>');
    expect(out).toContain('class="nvc-mention"');
    expect(out).toContain('data-type="mention"');
    expect(out).toContain('data-id="abc"');
    expect(out).toContain(">@mara</a>");
  });
});

describe("the dangerous still goes", () => {
  it("allows no other style than text-align, and no other alignment value", () => {
    expect(sanitizeRichText('<p style="text-align:right;color:red;position:fixed">x</p>')).toBe('<p style="text-align:right">x</p>');
    expect(sanitizeRichText('<p style="text-align: url(evil)">x</p>')).toBe("<p>x</p>");
    expect(sanitizeRichText('<span style="text-align:right">x</span>')).toBe("<span>x</span>");
  });

  it("allows only a disabled checkbox as an input", () => {
    expect(sanitizeRichText('<input type="text" value="x">')).toBe('<input type="checkbox" disabled="disabled" />');
    expect(sanitizeRichText('<input type="checkbox" onclick="alert(1)">')).toBe('<input type="checkbox" disabled="disabled" />');
  });

  it("drops scripts, handlers and javascript: links", () => {
    expect(sanitizeRichText('<p onclick="x()">a</p><script>alert(1)</script>')).toBe("<p>a</p>");
    expect(sanitizeRichText('<a href="javascript:alert(1)">x</a>')).not.toContain("javascript");
  });

  it("allows only known classes", () => {
    expect(sanitizeRichText('<a href="/u/a" class="nvc-mention evil">@a</a>')).toContain('class="nvc-mention"');
    expect(sanitizeRichText('<span class="evil">x</span>')).toBe("<span>x</span>");
  });
});
