// @vitest-environment jsdom
/**
 * Alignment belongs to one block: Enter at the end of an aligned paragraph starts the
 * next one at the default; splitting in the middle keeps both halves aligned; lists
 * behave the same; aligning one paragraph never touches another.
 */
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import { AlignPerBlock } from "./alignPerBlock";

let editor: Editor | null = null;
afterEach(() => { editor?.destroy(); editor = null; });

const make = (html: string) => {
  editor = new Editor({ extensions: [StarterKit, TextAlign.configure({ types: ["heading", "paragraph"] }), AlignPerBlock], content: html });
  return editor;
};
const aligns = (e: Editor) => {
  const out: Array<[string, string | null]> = [];
  e.state.doc.descendants((n) => { if (n.isTextblock) out.push([n.textContent, n.attrs.textAlign ?? null]); });
  return out;
};
/** Put the cursor after `text` inside the first block that contains it. */
const caretAfter = (e: Editor, text: string) => {
  let pos = -1;
  e.state.doc.descendants((n, p) => {
    if (pos < 0 && n.isText && n.text!.includes(text)) pos = p + n.text!.indexOf(text) + text.length;
  });
  e.commands.setTextSelection(pos);
};

describe("alignment belongs to one block", () => {
  it("starts the next paragraph at the default", () => {
    const e = make('<p style="text-align: right">first</p><p>second</p>');
    caretAfter(e, "first");
    e.commands.keyboardShortcut("Enter");
    e.commands.insertContent("new");
    expect(aligns(e)).toEqual([["first", "right"], ["new", null], ["second", null]]);
  });

  it("keeps both halves aligned when a paragraph is split in the middle", () => {
    const e = make('<p style="text-align: center">one two</p>');
    caretAfter(e, "one");
    e.commands.keyboardShortcut("Enter");
    expect(aligns(e)).toEqual([["one", "center"], [" two", "center"]]);
  });

  it("does the same inside a list", () => {
    const e = make('<ul><li><p style="text-align: right">item</p></li></ul>');
    caretAfter(e, "item");
    e.commands.keyboardShortcut("Enter");
    e.commands.insertContent("next");
    // (StarterKit keeps an empty paragraph after a list; only the items matter here.)
    expect(aligns(e).slice(0, 2)).toEqual([["item", "right"], ["next", null]]);
  });

  it("aligns only the paragraph the cursor is in", () => {
    const e = make("<p>first</p><p>second</p>");
    caretAfter(e, "fir");
    e.commands.setTextAlign("right");
    expect(aligns(e)).toEqual([["first", "right"], ["second", null]]);
  });
});
