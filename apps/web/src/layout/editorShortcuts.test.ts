/**
 * The undo/redo chord matcher.
 *
 * @vitest-environment jsdom
 *
 * Shared by the editor and by the preview iframe, which forwards these because key
 * events do not cross a frame boundary. The case that matters most is the negative
 * one: a text field owns its own undo stack, and claiming Ctrl+Z while a heading is
 * being typed would make a typo uncorrectable except by reverting the layout.
 */
import { describe, expect, it } from "vitest";
import { shortcutFor, type ShortcutLike } from "./editorShortcuts";

const ev = (over: Partial<ShortcutLike> = {}): ShortcutLike => ({
  key: "z", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
  target: null, ...over,
});

// The ATTRIBUTE, not the property: jsdom implements neither `isContentEditable` nor
// the `contentEditable` reflection, so assigning the property would set a plain expando
// and quietly test nothing.
const el = (tag: string, contentEditable = false) => {
  const node = document.createElement(tag);
  if (contentEditable) node.setAttribute("contenteditable", "true");
  return node;
};

describe("shortcutFor", () => {
  it("matches undo on both Ctrl and Cmd", () => {
    expect(shortcutFor(ev({ ctrlKey: true }))).toBe("undo");
    expect(shortcutFor(ev({ metaKey: true }))).toBe("undo");
  });

  it("matches redo on Shift+Z and on Y", () => {
    expect(shortcutFor(ev({ ctrlKey: true, shiftKey: true }))).toBe("redo");
    expect(shortcutFor(ev({ ctrlKey: true, key: "y" }))).toBe("redo");
    expect(shortcutFor(ev({ metaKey: true, shiftKey: true }))).toBe("redo");
    // Shift is irrelevant once the key is Y — both spellings mean redo.
    expect(shortcutFor(ev({ ctrlKey: true, key: "y", shiftKey: true }))).toBe("redo");
  });

  it("is case-insensitive, since Shift+Z reports an uppercase key", () => {
    expect(shortcutFor(ev({ ctrlKey: true, key: "Z", shiftKey: true }))).toBe("redo");
    expect(shortcutFor(ev({ ctrlKey: true, key: "Z" }))).toBe("undo");
  });

  it("ignores the chord without a modifier", () => {
    expect(shortcutFor(ev())).toBeNull();
    expect(shortcutFor(ev({ shiftKey: true }))).toBeNull();
  });

  it("ignores other keys", () => {
    expect(shortcutFor(ev({ ctrlKey: true, key: "s" }))).toBeNull();
    expect(shortcutFor(ev({ ctrlKey: true, key: "a" }))).toBeNull();
  });

  it("declines when Alt is held — that is a different chord", () => {
    expect(shortcutFor(ev({ ctrlKey: true, altKey: true }))).toBeNull();
  });

  it("leaves text entry alone, so a field keeps its own undo stack", () => {
    for (const tag of ["input", "textarea", "select"]) {
      expect(shortcutFor(ev({ ctrlKey: true, target: el(tag) }))).toBeNull();
    }
    expect(shortcutFor(ev({ ctrlKey: true, target: el("div", true) }))).toBeNull();
  });

  it("leaves a child of an editable region alone too", () => {
    // Where the keystroke actually lands in a rich-text field.
    const region = el("div", true);
    const inner = document.createElement("span");
    region.appendChild(inner);
    expect(shortcutFor(ev({ ctrlKey: true, target: inner }))).toBeNull();
  });

  it("does not treat contenteditable=\"false\" as text entry", () => {
    const node = document.createElement("div");
    node.setAttribute("contenteditable", "false");
    expect(shortcutFor(ev({ ctrlKey: true, target: node }))).toBe("undo");
  });

  it("still matches over a non-editable element", () => {
    expect(shortcutFor(ev({ ctrlKey: true, target: el("div") }))).toBe("undo");
    expect(shortcutFor(ev({ ctrlKey: true, target: el("button") }))).toBe("undo");
  });

  it("tolerates a target that is not an element", () => {
    // `document` and `window` both arrive as targets on a bubbled keydown.
    expect(shortcutFor(ev({ ctrlKey: true, target: document }))).toBe("undo");
    expect(shortcutFor(ev({ ctrlKey: true, target: window }))).toBe("undo");
  });
});
