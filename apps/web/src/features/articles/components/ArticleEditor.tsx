import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import { AlignPerBlock } from "../../../components/composer/alignPerBlock";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Highlight from "@tiptap/extension-highlight";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import Image from "@tiptap/extension-image";
import Mention from "@tiptap/extension-mention";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import "./ArticleEditor.scss";

/** The complete extension set shared by the editor and the read-only renderer
 *  (ArticleContent). Keep both in sync or stored marks won't render.
 *  StarterKit v3 already bundles Link + Underline, so we configure Link here
 *  rather than re-adding it (which would duplicate-register). */
export const RICH_EXTENSIONS = [
  StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  AlignPerBlock,
  TaskList,
  TaskItem.configure({ nested: true }),
  Highlight,
  Subscript,
  Superscript,
  Image.configure({ inline: false, HTMLAttributes: { class: "article-editor__image" } }),
  // An article body is written in the Composer, where @mentions are on by default.
  // Without the node here the renderer DROPPED a mention from the published article.
  // Display only (no suggestion popup): the same link the Composer writes.
  Mention.configure({
    renderHTML({ node }) {
      return ["a", {
        href: `/u/${node.attrs.id}`, class: "nvc-mention", "data-type": "mention", "data-id": node.attrs.id,
      }, `@${node.attrs.label ?? node.attrs.id}`];
    },
    renderText({ node }) { return `@${node.attrs.label ?? node.attrs.id}`; },
  }),
];

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
    extensions: RICH_EXTENSIONS,
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
    { icon: "↩",  label: "undo", isActive: () => false, run: (e) => e.chain().focus().undo().run() },
    { icon: "↪",  label: "redo", isActive: () => false, run: (e) => e.chain().focus().redo().run() },
  ],
  [
    { icon: "H1", label: "heading1", isActive: (e) => e.isActive("heading", { level: 1 }), run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
    { icon: "H2", label: "heading2", isActive: (e) => e.isActive("heading", { level: 2 }), run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
    { icon: "H3", label: "heading3", isActive: (e) => e.isActive("heading", { level: 3 }), run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  ],
  [
    { icon: "B", label: "bold",      isActive: (e) => e.isActive("bold"),      run: (e) => e.chain().focus().toggleBold().run(),      fontStyle: { fontWeight: 900 } },
    { icon: "I", label: "italic",    isActive: (e) => e.isActive("italic"),    run: (e) => e.chain().focus().toggleItalic().run(),    fontStyle: { fontStyle: "italic" } },
    { icon: "U", label: "underline", isActive: (e) => e.isActive("underline"), run: (e) => e.chain().focus().toggleUnderline().run(), fontStyle: { textDecoration: "underline" } },
    { icon: "S", label: "strike",    isActive: (e) => e.isActive("strike"),    run: (e) => e.chain().focus().toggleStrike().run(),    fontStyle: { textDecoration: "line-through" } },
    { icon: "▪",  label: "highlight",    isActive: (e) => e.isActive("highlight"),    run: (e) => e.chain().focus().toggleHighlight().run() },
    { icon: "x₂", label: "subscript",    isActive: (e) => e.isActive("subscript"),    run: (e) => e.chain().focus().toggleSubscript().run() },
    { icon: "x²", label: "superscript",  isActive: (e) => e.isActive("superscript"),  run: (e) => e.chain().focus().toggleSuperscript().run() },
  ],
  [
    { icon: "⫧", label: "alignLeft",    isActive: (e) => e.isActive({ textAlign: "left" }),    run: (e) => e.chain().focus().setTextAlign("left").run() },
    { icon: "≡", label: "alignCenter",  isActive: (e) => e.isActive({ textAlign: "center" }),  run: (e) => e.chain().focus().setTextAlign("center").run() },
    { icon: "⫨", label: "alignRight",   isActive: (e) => e.isActive({ textAlign: "right" }),   run: (e) => e.chain().focus().setTextAlign("right").run() },
    { icon: "☰", label: "alignJustify", isActive: (e) => e.isActive({ textAlign: "justify" }), run: (e) => e.chain().focus().setTextAlign("justify").run() },
  ],
  [
    { icon: "•≡",  label: "bulletList",  isActive: (e) => e.isActive("bulletList"),  run: (e) => e.chain().focus().toggleBulletList().run() },
    { icon: "1.",  label: "orderedList", isActive: (e) => e.isActive("orderedList"), run: (e) => e.chain().focus().toggleOrderedList().run() },
    { icon: "☑",   label: "taskList",    isActive: (e) => e.isActive("taskList"),    run: (e) => e.chain().focus().toggleTaskList().run() },
  ],
  [
    { icon: "❝",   label: "blockquote",  isActive: (e) => e.isActive("blockquote"),  run: (e) => e.chain().focus().toggleBlockquote().run() },
    { icon: "</>", label: "codeBlock",   isActive: (e) => e.isActive("codeBlock"),   run: (e) => e.chain().focus().toggleCodeBlock().run(),   fontStyle: { fontFamily: "monospace" } },
    { icon: "`",   label: "code",        isActive: (e) => e.isActive("code"),        run: (e) => e.chain().focus().toggleCode().run(),        fontStyle: { fontFamily: "monospace" } },
    { icon: "⎯",   label: "hr",          isActive: () => false,                      run: (e) => e.chain().focus().setHorizontalRule().run() },
  ],
  [
    { icon: "🔗", label: "link", isActive: (e) => e.isActive("link"), run: (e) => {
      const prev = e.getAttributes("link").href as string | undefined;
      const url = window.prompt("Enter URL:", prev ?? "https://");
      if (url === null) return;
      if (!url) { e.chain().focus().unsetLink().run(); return; }
      e.chain().focus().setLink({ href: url, target: "_blank" }).run();
    } },
  ],
];

interface ToolbarProps {
  editor: Editor | null;
  rightSlot?: ReactNode;
  /** When provided, an image button appears that uploads the picked file and
   *  inserts it into the body at the cursor. Returns the public URL. */
  onUploadImage?: (file: File) => Promise<string>;
}

/** Top-of-column toolbar. Renders nothing until the editor is initialised. */
export function ArticleEditorToolbar({ editor, rightSlot, onUploadImage }: ToolbarProps) {
  const { t } = useTranslation("articles");
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const handleImagePicked = async (file: File | null) => {
    if (!file || !editor || !onUploadImage) return;
    try {
      const url = await onUploadImage(file);
      editor.chain().focus().setImage({ src: url }).run();
    } catch {
      /* surfaced by the caller's mutation/toast */
    }
  };

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
      {onUploadImage && (
        <div className="article-editor__group">
          <div className="article-editor__sep" />
          <button
            type="button"
            title={t("editor.toolbar.image")}
            className="article-editor__btn"
            onClick={() => imageInputRef.current?.click()}
          >
            🖼
          </button>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            style={{ display: "none" }}
            onChange={(e) => {
              void handleImagePicked(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
        </div>
      )}
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
