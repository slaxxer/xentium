import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import "./ArticleEditor.scss";

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

interface UseArticleEditorOpts {
  value: unknown;
  onChange: (json: unknown) => void;
}

export function useArticleEditor({ value, onChange }: UseArticleEditorOpts): Editor | null {
  const initial = useMemo(() => {
    if (value && typeof value === "object") return value;
    return EMPTY_DOC;
  }, [value]);

  const editor = useEditor({
    extensions: [StarterKit],
    content: initial as never,
    onUpdate: ({ editor }) => onChange(editor.getJSON()),
    editorProps: {
      attributes: { class: "article-editor__content" },
    },
  });

  // Used to force a React re-render after setContent so editor.isEmpty is re-evaluated
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    if (!editor) return;
    const current = editor.getJSON();
    if (JSON.stringify(current) !== JSON.stringify(initial)) {
      editor.commands.setContent(initial as never, { emitUpdate: false });
      forceUpdate((n) => n + 1);
    }
  }, [initial]);

  return editor;
}

interface ToolButton {
  icon: string;
  label: string;
  isActive: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
  fontStyle?: React.CSSProperties;
}

// `label` holds a translation key under articles → editor.toolbar.*
const GROUPS: ToolButton[][] = [
  [
    { icon: "H1", label: "heading1", isActive: (e) => e.isActive("heading", { level: 1 }), run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
    { icon: "H2", label: "heading2", isActive: (e) => e.isActive("heading", { level: 2 }), run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
    { icon: "H3", label: "heading3", isActive: (e) => e.isActive("heading", { level: 3 }), run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  ],
  [
    { icon: "B", label: "bold",   isActive: (e) => e.isActive("bold"),   run: (e) => e.chain().focus().toggleBold().run(),   fontStyle: { fontWeight: 900 } },
    { icon: "I", label: "italic", isActive: (e) => e.isActive("italic"), run: (e) => e.chain().focus().toggleItalic().run(), fontStyle: { fontStyle: "italic" } },
    { icon: "S", label: "strike", isActive: (e) => e.isActive("strike"), run: (e) => e.chain().focus().toggleStrike().run(), fontStyle: { textDecoration: "line-through" } },
  ],
  [
    { icon: "≡",   label: "bulletList",  isActive: (e) => e.isActive("bulletList"),  run: (e) => e.chain().focus().toggleBulletList().run() },
    { icon: "1.",  label: "orderedList", isActive: (e) => e.isActive("orderedList"), run: (e) => e.chain().focus().toggleOrderedList().run() },
    { icon: "❝",   label: "blockquote",  isActive: (e) => e.isActive("blockquote"),  run: (e) => e.chain().focus().toggleBlockquote().run() },
    { icon: "</>", label: "codeBlock",   isActive: (e) => e.isActive("codeBlock"),   run: (e) => e.chain().focus().toggleCodeBlock().run() },
  ],
  [
    { icon: "⎯",   label: "hr", isActive: () => false, run: (e) => e.chain().focus().setHorizontalRule().run() },
  ],
  [
    { icon: "↩",  label: "undo", isActive: () => false, run: (e) => e.chain().focus().undo().run() },
    { icon: "↪",  label: "redo", isActive: () => false, run: (e) => e.chain().focus().redo().run() },
  ],
];

interface ToolbarProps {
  editor: Editor | null;
  rightSlot?: ReactNode;
}

/** Top-of-column toolbar. Renders nothing until the editor is initialised. */
export function ArticleEditorToolbar({ editor, rightSlot }: ToolbarProps) {
  const { t } = useTranslation("articles");
  if (!editor) return <div className="article-editor__toolbar article-editor__toolbar--empty" />;
  return (
    <div className="article-editor__toolbar">
      {GROUPS.map((tools, gi) => (
        <div className="article-editor__group" key={gi}>
          {tools.map((tb) => (
            <button
              key={tb.icon}
              type="button"
              title={t(`editor.toolbar.${tb.label}`)}
              className={`article-editor__btn ${tb.isActive(editor) ? "is-active" : ""}`}
              onClick={() => tb.run(editor)}
              style={tb.fontStyle}
            >
              {tb.icon}
            </button>
          ))}
          {gi < GROUPS.length - 1 && <div className="article-editor__sep" />}
        </div>
      ))}
      {rightSlot && <div className="article-editor__right">{rightSlot}</div>}
    </div>
  );
}

interface BodyProps {
  editor: Editor | null;
  placeholder?: string;
}

/** Editor content. Renders only the typing surface — no chrome. */
export function ArticleEditorBody({ editor, placeholder }: BodyProps) {
  return (
    <div className="article-editor-body">
      {placeholder && editor?.isEmpty && (
        <div className="article-editor__placeholder">{placeholder}</div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
