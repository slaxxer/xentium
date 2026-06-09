import { describe, it, expect } from "vitest";
import { tiptapToPlain } from "./tiptapPlain";

describe("tiptapToPlain", () => {
  it("extracts text from a paragraph", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello world" }] },
      ],
    };
    expect(tiptapToPlain(doc)).toBe("Hello world");
  });

  it("joins multiple blocks with a newline", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Line 1" }] },
        { type: "paragraph", content: [{ type: "text", text: "Line 2" }] },
      ],
    };
    expect(tiptapToPlain(doc)).toMatch(/Line 1\s+Line 2/);
  });

  it("flattens nested marks", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "bold ", marks: [{ type: "bold" }] },
            { type: "text", text: "italic", marks: [{ type: "italic" }] },
          ],
        },
      ],
    };
    expect(tiptapToPlain(doc)).toBe("bold italic");
  });

  it("returns empty string for null/undefined/non-object input", () => {
    expect(tiptapToPlain(null)).toBe("");
    expect(tiptapToPlain(undefined)).toBe("");
    expect(tiptapToPlain("string")).toBe("");
    expect(tiptapToPlain(42)).toBe("");
  });

  it("walks heading + list content", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "item 1" }] },
              ],
            },
          ],
        },
      ],
    };
    const out = tiptapToPlain(doc);
    expect(out).toContain("Title");
    expect(out).toContain("item 1");
  });
});
