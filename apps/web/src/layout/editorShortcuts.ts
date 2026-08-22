/**
 * What counts as undo/redo, defined once.
 *
 * Two documents listen for these: the editor itself, and the preview iframe, which
 * forwards them because key events never cross a frame boundary. Deciding "is this
 * an undo" separately in each is how the two drift — the preview would keep swallowing
 * a chord the editor had stopped honouring, or vice versa — so both ask this.
 */

/** The shape both call sites have: a real KeyboardEvent, or anything resembling one. */
export interface ShortcutLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
}

/** Elements that own their own undo stack, which must not be hijacked. */
const TEXT_ENTRY = /^(INPUT|TEXTAREA|SELECT)$/;

function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  if (TEXT_ENTRY.test(el.tagName)) return true;
  // `isContentEditable` is the right question — it is true for descendants of an
  // editable region too, which is where the keystroke actually lands in a rich-text
  // field. The attribute walk backs it up: jsdom does not implement the property, so
  // relying on it alone would make this untestable and would silently pass anything
  // in a headless environment.
  if (el.isContentEditable === true) return true;
  return typeof el.closest === "function"
    && el.closest("[contenteditable]:not([contenteditable='false'])") !== null;
}

/**
 * `"undo"`, `"redo"`, or `null` when the chord is not one of them.
 *
 * Ctrl+Y is honoured alongside Ctrl+Shift+Z for the Windows muscle memory. Alt is
 * excluded rather than ignored: Ctrl+Alt+Z is a distinct chord on several layouts,
 * and claiming it would eat a keystroke meant for something else.
 *
 * Returns `null` while a text field has focus — correcting a typo in a heading must
 * not instead revert the block's arrangement.
 */
export function shortcutFor(e: ShortcutLike): "undo" | "redo" | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (key !== "z" && key !== "y") return null;
  if (isTextEntry(e.target)) return null;
  return key === "y" || e.shiftKey ? "redo" : "undo";
}
