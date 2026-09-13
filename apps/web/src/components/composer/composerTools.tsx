/**
 * What each tool DOES, and the glyph it wears.
 *
 * ⚠ Real icons. Both editors drew their toolbars with literal characters — `⫧ ≡ ❝ x₂`
 * — which meant the bar was a row of guesses that rendered differently on every
 * platform and font. These are FontAwesome definitions, already a dependency, drawn
 * through core's wrapper so a site's icon kit restyles the editor too.
 *
 * ⚠ The catalogue is keyed by `ComposerToolId` from contracts, so the ACP page and
 * this file cannot disagree about which tools exist.
 */
import type { Editor } from "@tiptap/react";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faBold, faItalic, faUnderline, faStrikethrough, faHighlighter,
  faSubscript, faSuperscript,
  faListUl, faListOl, faListCheck, faQuoteLeft, faCode, faTerminal, faMinus,
  faAlignLeft, faAlignCenter, faAlignRight, faAlignJustify,
  faLink, faPaperclip, faFaceSmile, faAt, faRotateLeft, faRotateRight,
} from "@fortawesome/free-solid-svg-icons";
import type { ComposerToolId } from "@nodevo/contracts";

export interface ComposerTool {
  icon:  IconDefinition;
  /** i18n key under `composer.tool.` — the tooltip and the ACP's row label. */
  key:   ComposerToolId;
  /** Runs the command. Absent for tools the composer handles itself (see below). */
  run?:      (e: Editor) => void;
  isActive?: (e: Editor) => boolean;
  /** Can it run at all right now? Undo with nothing to undo, for instance. */
  enabled?:  (e: Editor) => boolean;
}

/**
 * ⚠ `link`, `attach`, `emoji` and `mention` have NO `run`. They open a popover, a
 * file dialog or a picker — surfaces the composer owns, because they need anchoring,
 * focus handling and (for attach) a per-surface capability check. The bar renders
 * them from this catalogue and routes the click to the component.
 */
export const COMPOSER_TOOLS: Record<ComposerToolId, ComposerTool> = {
  bold:        { key: "bold",        icon: faBold,          run: (e) => e.chain().focus().toggleBold().run(),        isActive: (e) => e.isActive("bold") },
  italic:      { key: "italic",      icon: faItalic,        run: (e) => e.chain().focus().toggleItalic().run(),      isActive: (e) => e.isActive("italic") },
  underline:   { key: "underline",   icon: faUnderline,     run: (e) => e.chain().focus().toggleUnderline().run(),   isActive: (e) => e.isActive("underline") },
  strike:      { key: "strike",      icon: faStrikethrough, run: (e) => e.chain().focus().toggleStrike().run(),      isActive: (e) => e.isActive("strike") },
  highlight:   { key: "highlight",   icon: faHighlighter,   run: (e) => e.chain().focus().toggleHighlight().run(),   isActive: (e) => e.isActive("highlight") },
  subscript:   { key: "subscript",   icon: faSubscript,     run: (e) => e.chain().focus().toggleSubscript().run(),   isActive: (e) => e.isActive("subscript") },
  superscript: { key: "superscript", icon: faSuperscript,   run: (e) => e.chain().focus().toggleSuperscript().run(), isActive: (e) => e.isActive("superscript") },

  bulletList:  { key: "bulletList",  icon: faListUl,        run: (e) => e.chain().focus().toggleBulletList().run(),  isActive: (e) => e.isActive("bulletList") },
  orderedList: { key: "orderedList", icon: faListOl,        run: (e) => e.chain().focus().toggleOrderedList().run(), isActive: (e) => e.isActive("orderedList") },
  taskList:    { key: "taskList",    icon: faListCheck,     run: (e) => e.chain().focus().toggleTaskList().run(),    isActive: (e) => e.isActive("taskList") },
  blockquote:  { key: "blockquote",  icon: faQuoteLeft,     run: (e) => e.chain().focus().toggleBlockquote().run(),  isActive: (e) => e.isActive("blockquote") },
  codeBlock:   { key: "codeBlock",   icon: faCode,          run: (e) => e.chain().focus().toggleCodeBlock().run(),   isActive: (e) => e.isActive("codeBlock") },
  inlineCode:  { key: "inlineCode",  icon: faTerminal,      run: (e) => e.chain().focus().toggleCode().run(),        isActive: (e) => e.isActive("code") },
  divider:     { key: "divider",     icon: faMinus,         run: (e) => e.chain().focus().setHorizontalRule().run() },

  alignLeft:    { key: "alignLeft",    icon: faAlignLeft,    run: (e) => e.chain().focus().setTextAlign("left").run(),    isActive: (e) => e.isActive({ textAlign: "left" }) },
  alignCenter:  { key: "alignCenter",  icon: faAlignCenter,  run: (e) => e.chain().focus().setTextAlign("center").run(),  isActive: (e) => e.isActive({ textAlign: "center" }) },
  alignRight:   { key: "alignRight",   icon: faAlignRight,   run: (e) => e.chain().focus().setTextAlign("right").run(),   isActive: (e) => e.isActive({ textAlign: "right" }) },
  alignJustify: { key: "alignJustify", icon: faAlignJustify, run: (e) => e.chain().focus().setTextAlign("justify").run(), isActive: (e) => e.isActive({ textAlign: "justify" }) },

  link:    { key: "link",    icon: faLink,      isActive: (e) => e.isActive("link") },
  attach:  { key: "attach",  icon: faPaperclip },
  emoji:   { key: "emoji",   icon: faFaceSmile },
  mention: { key: "mention", icon: faAt },

  undo: { key: "undo", icon: faRotateLeft,  run: (e) => e.chain().focus().undo().run(), enabled: (e) => e.can().undo() },
  redo: { key: "redo", icon: faRotateRight, run: (e) => e.chain().focus().redo().run(), enabled: (e) => e.can().redo() },
};

/** The block picker's options — one control replacing seven buttons. */
export const COMPOSER_BLOCKS = [
  { id: "paragraph", isActive: (e: Editor) => e.isActive("paragraph") && !e.isActive("blockquote"), run: (e: Editor) => e.chain().focus().setParagraph().run() },
  { id: "h1",        isActive: (e: Editor) => e.isActive("heading", { level: 1 }), run: (e: Editor) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { id: "h2",        isActive: (e: Editor) => e.isActive("heading", { level: 2 }), run: (e: Editor) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { id: "h3",        isActive: (e: Editor) => e.isActive("heading", { level: 3 }), run: (e: Editor) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { id: "quote",     isActive: (e: Editor) => e.isActive("blockquote"), run: (e: Editor) => e.chain().focus().toggleBlockquote().run() },
  { id: "code",      isActive: (e: Editor) => e.isActive("codeBlock"), run: (e: Editor) => e.chain().focus().toggleCodeBlock().run() },
] as const;

export type ComposerBlockId = typeof COMPOSER_BLOCKS[number]["id"];

/** Which block the cursor is in — the picker's own label. */
export function currentBlock(editor: Editor | null): ComposerBlockId {
  if (!editor) return "paragraph";
  for (const b of COMPOSER_BLOCKS) {
    if (b.id !== "paragraph" && b.isActive(editor)) return b.id;
  }
  return "paragraph";
}
