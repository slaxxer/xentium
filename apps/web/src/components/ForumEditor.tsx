/**
 * ForumEditor — shared rich-text editor used across all forum surfaces:
 *   Thread creation · Thread replies · Quick edit · Full editor
 *
 * Toolbar groups mirror TipTap's Simple Editor example plus extras.
 */
import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Link from "@tiptap/extension-link";
import Highlight from "@tiptap/extension-highlight";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import Placeholder from "@tiptap/extension-placeholder";
import "./ForumEditor.scss";

// ── Public handle ─────────────────────────────────────────────────────────────

export interface ForumEditorHandle {
  getHTML: () => string;
  isEmpty: () => boolean;
  setContent: (html: string) => void;
  clear: () => void;
}

// ── Toolbar helpers ───────────────────────────────────────────────────────────

interface ToolBtn {
  icon: string;
  title: string;
  action: (e: Editor) => void;
  active?: (e: Editor) => boolean;
  style?: React.CSSProperties;
}

const SEP = null;

function makeTools(_e: Editor): Array<ToolBtn | null> {
  return [
    // History
    { icon: "↩", title: "Undo", action: (ed) => ed.chain().focus().undo().run() },
    { icon: "↪", title: "Redo", action: (ed) => ed.chain().focus().redo().run() },
    SEP,
    // Headings
    { icon: "H1", title: "Heading 1", action: (ed) => ed.chain().focus().toggleHeading({ level: 1 }).run(), active: (ed) => ed.isActive("heading", { level: 1 }) },
    { icon: "H2", title: "Heading 2", action: (ed) => ed.chain().focus().toggleHeading({ level: 2 }).run(), active: (ed) => ed.isActive("heading", { level: 2 }) },
    { icon: "H3", title: "Heading 3", action: (ed) => ed.chain().focus().toggleHeading({ level: 3 }).run(), active: (ed) => ed.isActive("heading", { level: 3 }) },
    SEP,
    // Inline formatting
    { icon: "B",  title: "Bold",      action: (ed) => ed.chain().focus().toggleBold().run(),          active: (ed) => ed.isActive("bold"),      style: { fontWeight: 900 } },
    { icon: "I",  title: "Italic",    action: (ed) => ed.chain().focus().toggleItalic().run(),         active: (ed) => ed.isActive("italic"),    style: { fontStyle: "italic" } },
    { icon: "U",  title: "Underline", action: (ed) => ed.chain().focus().toggleUnderline().run(),     active: (ed) => ed.isActive("underline"), style: { textDecoration: "underline" } },
    { icon: "S",  title: "Strike",    action: (ed) => ed.chain().focus().toggleStrike().run(),         active: (ed) => ed.isActive("strike"),    style: { textDecoration: "line-through" } },
    { icon: "▪",  title: "Highlight", action: (ed) => ed.chain().focus().toggleHighlight().run(),     active: (ed) => ed.isActive("highlight") },
    { icon: "x₂", title: "Subscript",   action: (ed) => ed.chain().focus().toggleSubscript().run(),   active: (ed) => ed.isActive("subscript") },
    { icon: "x²", title: "Superscript", action: (ed) => ed.chain().focus().toggleSuperscript().run(), active: (ed) => ed.isActive("superscript") },
    SEP,
    // Alignment
    { icon: "⫧",  title: "Align left",    action: (ed) => ed.chain().focus().setTextAlign("left").run(),    active: (ed) => ed.isActive({ textAlign: "left" }) },
    { icon: "≡",  title: "Align center",  action: (ed) => ed.chain().focus().setTextAlign("center").run(),  active: (ed) => ed.isActive({ textAlign: "center" }) },
    { icon: "⫨",  title: "Align right",   action: (ed) => ed.chain().focus().setTextAlign("right").run(),   active: (ed) => ed.isActive({ textAlign: "right" }) },
    { icon: "☰",  title: "Justify",       action: (ed) => ed.chain().focus().setTextAlign("justify").run(), active: (ed) => ed.isActive({ textAlign: "justify" }) },
    SEP,
    // Lists
    { icon: "•≡", title: "Bullet list",  action: (ed) => ed.chain().focus().toggleBulletList().run(),  active: (ed) => ed.isActive("bulletList") },
    { icon: "1.", title: "Ordered list", action: (ed) => ed.chain().focus().toggleOrderedList().run(), active: (ed) => ed.isActive("orderedList") },
    { icon: "☑",  title: "Task list",    action: (ed) => ed.chain().focus().toggleTaskList().run(),    active: (ed) => ed.isActive("taskList") },
    SEP,
    // Blocks
    { icon: "❝",  title: "Blockquote",  action: (ed) => ed.chain().focus().toggleBlockquote().run(), active: (ed) => ed.isActive("blockquote") },
    { icon: "<>", title: "Code block",   action: (ed) => ed.chain().focus().toggleCodeBlock().run(),   active: (ed) => ed.isActive("codeBlock"),  style: { fontFamily: "monospace" } },
    { icon: "`",  title: "Inline code",  action: (ed) => ed.chain().focus().toggleCode().run(),        active: (ed) => ed.isActive("code"),       style: { fontFamily: "monospace" } },
    { icon: "—",  title: "Divider",      action: (ed) => ed.chain().focus().setHorizontalRule().run() },
    SEP,
    // Link
    { icon: "🔗", title: "Link", action: (ed) => {
        const prev = ed.getAttributes("link").href as string | undefined;
        const url = window.prompt("Enter URL:", prev ?? "https://");
        if (url === null) return;
        if (!url) { ed.chain().focus().unsetLink().run(); return; }
        ed.chain().focus().setLink({ href: url, target: "_blank" }).run();
      }, active: (ed) => ed.isActive("link") },
  ];
}

// ── Component ─────────────────────────────────────────────────────────────────

interface ForumEditorProps {
  onChange?: (html: string) => void;
  placeholder?: string;
  initialHtml?: string;
  disabled?: boolean;
  minHeight?: number;
  onSubmit?: () => void;
}

export const ForumEditor = forwardRef<ForumEditorHandle, ForumEditorProps>(
  ({ onChange, placeholder, initialHtml, disabled, minHeight = 160, onSubmit }, ref) => {
    const prevInitial = useRef<string | undefined>(undefined);
    const [hasContent, setHasContent] = useState(!!initialHtml);

    const editor = useEditor({
      extensions: [
        StarterKit,
        Underline,
        TextAlign.configure({ types: ["heading", "paragraph"] }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Link.configure({ openOnClick: false, autolink: true }),
        Highlight,
        Subscript,
        Superscript,
        Placeholder.configure({ placeholder: placeholder ?? "Write something…" }),
      ],
      content: initialHtml ?? "",
      editable: !disabled,
      onUpdate: ({ editor: ed }) => {
        const html = ed.isEmpty ? "" : ed.getHTML();
        onChange?.(html);
      },
      editorProps: {
        handleKeyDown(_view, event) {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && onSubmit) {
            onSubmit();
            return true;
          }
          return false;
        },
      },
    });

    // Sync initialHtml when it changes (e.g. quote inserted)
    useEffect(() => {
      if (!editor || initialHtml === prevInitial.current) return;
      prevInitial.current = initialHtml;
      if (initialHtml) {
        editor.commands.setContent(initialHtml);
        setHasContent(true);
        onChange?.(editor.getHTML());
      }
    }, [editor, initialHtml, onChange]);

    useEffect(() => {
      if (!editor) return;
      editor.setEditable(!disabled);
    }, [editor, disabled]);

    useImperativeHandle(ref, () => ({
      getHTML: () => (editor?.isEmpty ? "" : editor?.getHTML() ?? ""),
      isEmpty: () => editor?.isEmpty ?? true,
      setContent: (html: string) => {
        editor?.commands.setContent(html);
        setHasContent(!!html);
        onChange?.(html);
      },
      clear: () => {
        editor?.commands.clearContent(true);
        setHasContent(false);
        onChange?.("");
      },
    }));

    const tools = editor ? makeTools(editor) : [];

    return (
      <div className={`forum-editor${disabled ? " forum-editor--disabled" : ""}`}>
        {/* ── Toolbar ──────────────────────────────────────────────────── */}
        <div className="forum-editor__toolbar">
          {tools.map((t, i) =>
            t === null ? (
              <div key={`sep-${i}`} className="forum-editor__sep" />
            ) : (
              <button
                key={t.title}
                type="button"
                title={t.title}
                className={`forum-editor__btn${editor && t.active?.(editor) ? " is-active" : ""}`}
                style={t.style}
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (editor && !disabled) t.action(editor);
                }}
                disabled={!editor || disabled}
              >
                {t.icon}
              </button>
            ),
          )}
        </div>

        {/* ── Content ──────────────────────────────────────────────────── */}
        <div className="forum-editor__body" style={{ minHeight }}>
          {!hasContent && editor?.isEmpty && placeholder && (
            <div className="forum-editor__placeholder" aria-hidden>{placeholder}</div>
          )}
          <EditorContent editor={editor} />
        </div>
      </div>
    );
  },
);

ForumEditor.displayName = "ForumEditor";
