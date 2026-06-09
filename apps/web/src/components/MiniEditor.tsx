import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useEditor, EditorContent, ReactRenderer, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Mention from "@tiptap/extension-mention";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Link from "@tiptap/extension-link";
import Highlight from "@tiptap/extension-highlight";
import Superscript from "@tiptap/extension-superscript";
import Subscript from "@tiptap/extension-subscript";
import { authStore } from "../lib/authStore";
import "./MiniEditor.scss";

/* ── Minimal local suggestion types ─────────────────────────────────────── */
interface SuggestionKeyDownProps {
  event: KeyboardEvent;
}

/* ── Types ─────────────────────────────────────────────────────────────── */

interface MentionUser {
  id: string;      // username — used as mention id
  label: string;   // displayed as @label
  avatar: string | null;
}

/* ── Mention dropdown list ──────────────────────────────────────────────── */

interface MentionListHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

interface MentionListProps {
  items: MentionUser[];
  command: (item: MentionUser) => void;
}

const MentionList = forwardRef<MentionListHandle, MentionListProps>(
  ({ items, command }, ref) => {
    const [activeIdx, setActiveIdx] = useState(0);

    useEffect(() => setActiveIdx(0), [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown({ event }) {
        if (event.key === "ArrowUp") {
          setActiveIdx((i) => Math.max(0, i - 1));
          return true;
        }
        if (event.key === "ArrowDown") {
          setActiveIdx((i) => Math.min(items.length - 1, i + 1));
          return true;
        }
        if (event.key === "Enter") {
          const item = items[activeIdx];
          if (item) command(item);
          return true;
        }
        return false;
      },
    }));

    if (!items.length) return null;

    return (
      <ul className="mini-editor__mention-list" role="listbox">
        {items.map((item, i) => (
          <li
            key={item.id}
            role="option"
            aria-selected={i === activeIdx}
            className={`mini-editor__mention-item${i === activeIdx ? " is-active" : ""}`}
            onMouseDown={(e) => {
              e.preventDefault();
              command(item);
            }}
          >
            <div className="mini-editor__mention-av">
              {item.avatar ? (
                <img src={`/uploads/${item.avatar}`} alt="" />
              ) : (
                item.label.slice(0, 2).toUpperCase()
              )}
            </div>
            <span className="mini-editor__mention-name">@{item.label}</span>
          </li>
        ))}
      </ul>
    );
  },
);
MentionList.displayName = "MentionList";

/* ── User search ────────────────────────────────────────────────────────── */

async function searchUsers(query: string): Promise<MentionUser[]> {
  if (!query) return [];
  try {
    const token = authStore.token;
    const res = await fetch(`/api/users/search?q=${encodeURIComponent(query)}&limit=6`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: "include",
    });
    if (!res.ok) return [];
    const data: Array<{ id: string; username: string; avatar: string | null }> = await res.json();
    return data.map((u) => ({ id: u.username, label: u.username, avatar: u.avatar }));
  } catch {
    return [];
  }
}

/* ── Suggestion popup renderer ──────────────────────────────────────────── */

/* eslint-disable @typescript-eslint/no-explicit-any */
function buildSuggestion() {
  return {
    items: ({ query }: { query: string }) => searchUsers(query),

    render: (): any => {
      let renderer: ReactRenderer<MentionListHandle, MentionListProps>;
      let popup: HTMLDivElement;

      function positionPopup(clientRect: (() => DOMRect | null) | null | undefined) {
        if (!popup || !clientRect) return;
        const rect = clientRect();
        if (!rect) return;
        popup.style.left = `${rect.left + window.scrollX}px`;
        popup.style.top = `${rect.bottom + window.scrollY + 4}px`;
      }

      return {
        onStart(props: any) {
          popup = document.createElement("div");
          popup.className = "mini-editor__mention-portal";
          document.body.appendChild(popup);

          renderer = new ReactRenderer<MentionListHandle, MentionListProps>(MentionList, {
            props: { items: props.items as MentionUser[], command: props.command as (item: MentionUser) => void },
            editor: props.editor,
          });
          popup.appendChild(renderer.element);
          positionPopup(props.clientRect);
        },

        onUpdate(props: any) {
          renderer.updateProps({ items: props.items as MentionUser[], command: props.command as (item: MentionUser) => void });
          positionPopup(props.clientRect);
        },

        onKeyDown(props: SuggestionKeyDownProps) {
          if (props.event.key === "Escape") {
            popup.remove();
            renderer.destroy();
            return true;
          }
          return renderer.ref?.onKeyDown(props) ?? false;
        },

        onExit() {
          popup.remove();
          renderer.destroy();
        },
      };
    },
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ── Toolbar tools ──────────────────────────────────────────────────────── */

interface ToolDef {
  icon: string;
  label: string;
  isActive: (e: Editor) => boolean;
  run: (e: Editor) => void;
  style?: React.CSSProperties;
}

// null = visual separator
const TOOL_GROUPS: Array<ToolDef | null> = [
  { icon:"H1", label:"Heading 1",  isActive:(e)=>e.isActive("heading",{level:1}), run:(e)=>e.chain().focus().toggleHeading({level:1}).run() },
  { icon:"H2", label:"Heading 2",  isActive:(e)=>e.isActive("heading",{level:2}), run:(e)=>e.chain().focus().toggleHeading({level:2}).run() },
  { icon:"H3", label:"Heading 3",  isActive:(e)=>e.isActive("heading",{level:3}), run:(e)=>e.chain().focus().toggleHeading({level:3}).run() },
  null,
  { icon:"B",  label:"Bold",       isActive:(e)=>e.isActive("bold"),      run:(e)=>e.chain().focus().toggleBold().run(),      style:{fontWeight:900} },
  { icon:"I",  label:"Italic",     isActive:(e)=>e.isActive("italic"),    run:(e)=>e.chain().focus().toggleItalic().run(),    style:{fontStyle:"italic"} },
  { icon:"U",  label:"Underline",  isActive:(e)=>e.isActive("underline"), run:(e)=>e.chain().focus().toggleUnderline().run(),style:{textDecoration:"underline"} },
  { icon:"S",  label:"Strike",     isActive:(e)=>e.isActive("strike"),    run:(e)=>e.chain().focus().toggleStrike().run(),    style:{textDecoration:"line-through"} },
  { icon:"▪",  label:"Highlight",  isActive:(e)=>e.isActive("highlight"), run:(e)=>e.chain().focus().toggleHighlight().run() },
  { icon:"x₂", label:"Subscript",  isActive:(e)=>e.isActive("subscript"),   run:(e)=>e.chain().focus().toggleSubscript().run() },
  { icon:"x²", label:"Superscript",isActive:(e)=>e.isActive("superscript"), run:(e)=>e.chain().focus().toggleSuperscript().run() },
  null,
  { icon:"⫧",  label:"Align left",   isActive:(e)=>e.isActive({textAlign:"left"}),    run:(e)=>e.chain().focus().setTextAlign("left").run() },
  { icon:"≡",  label:"Align center", isActive:(e)=>e.isActive({textAlign:"center"}),  run:(e)=>e.chain().focus().setTextAlign("center").run() },
  { icon:"⫨",  label:"Align right",  isActive:(e)=>e.isActive({textAlign:"right"}),   run:(e)=>e.chain().focus().setTextAlign("right").run() },
  null,
  { icon:"•≡", label:"Bullets",      isActive:(e)=>e.isActive("bulletList"),  run:(e)=>e.chain().focus().toggleBulletList().run() },
  { icon:"1.", label:"Numbered",     isActive:(e)=>e.isActive("orderedList"), run:(e)=>e.chain().focus().toggleOrderedList().run() },
  { icon:"☑",  label:"Task list",    isActive:(e)=>e.isActive("taskList"),    run:(e)=>e.chain().focus().toggleTaskList().run() },
  null,
  { icon:"❝",  label:"Blockquote",  isActive:(e)=>e.isActive("blockquote"), run:(e)=>e.chain().focus().toggleBlockquote().run() },
  { icon:"<>", label:"Code block",  isActive:(e)=>e.isActive("codeBlock"),  run:(e)=>e.chain().focus().toggleCodeBlock().run(), style:{fontFamily:"monospace",fontSize:10} },
  { icon:"`",  label:"Inline code", isActive:(e)=>e.isActive("code"),       run:(e)=>e.chain().focus().toggleCode().run(),      style:{fontFamily:"monospace"} },
  { icon:"—",  label:"Divider",     isActive:()=>false,                      run:(e)=>e.chain().focus().setHorizontalRule().run() },
  null,
  { icon:"🔗", label:"Link", isActive:(e)=>e.isActive("link"), run:(e)=>{
      const prev = e.getAttributes("link").href as string|undefined;
      const url = window.prompt("Enter URL:", prev ?? "https://");
      if(url===null) return;
      if(!url){ e.chain().focus().unsetLink().run(); return; }
      e.chain().focus().setLink({href:url,target:"_blank"}).run();
    }},
];

/* ── Public interface ───────────────────────────────────────────────────── */

export interface MiniEditorHandle {
  clear: () => void;
  isEmpty: () => boolean;
}

interface MiniEditorProps {
  onChange: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
  onSubmit?: () => void;
  className?: string;
  /** Optionally pre-fill the editor with HTML content on mount or when this value changes. */
  initialHtml?: string;
}

export const MiniEditor = forwardRef<MiniEditorHandle, MiniEditorProps>(
  ({ onChange, placeholder, disabled, onSubmit, className, initialHtml }, ref) => {
    const editorRef = useRef<Editor | null>(null);
    const prevInitialHtml = useRef<string | undefined>(undefined);
    // Track whether we have content from initialHtml to suppress placeholder
    const [hasSetContent, setHasSetContent] = useState(!!initialHtml);

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
        Mention.configure({
          HTMLAttributes: {},
          renderHTML({ node }) {
            return [
              "a",
              {
                href: `/u/${node.attrs.id}`,
                class: "mini-editor__mention-link",
                "data-type": "mention",
                "data-id": node.attrs.id,
              },
              `@${node.attrs.label ?? node.attrs.id}`,
            ];
          },
          renderText({ node }) {
            return `@${node.attrs.label ?? node.attrs.id}`;
          },
          suggestion: buildSuggestion(),
        }),
      ],
      onUpdate: ({ editor: e }) => {
        onChange(e.isEmpty ? "" : e.getHTML());
      },
      editorProps: {
        attributes: { class: "mini-editor__content" },
        handleKeyDown(_view, event) {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && onSubmit) {
            onSubmit();
            return true;
          }
          return false;
        },
      },
      editable: !disabled,
    });

    useEffect(() => {
      editorRef.current = editor;
    }, [editor]);

    // Set initial HTML content when provided or when it changes
    useEffect(() => {
      if (!editor || initialHtml === prevInitialHtml.current) return;
      prevInitialHtml.current = initialHtml;
      if (initialHtml) {
        editor.commands.setContent(initialHtml);
        setHasSetContent(true);
        onChange(editor.getHTML());
      }
    }, [editor, initialHtml, onChange]);

    useEffect(() => {
      if (!editor) return;
      editor.setEditable(!disabled);
    }, [editor, disabled]);

    useImperativeHandle(ref, () => ({
      clear() {
        editorRef.current?.commands.clearContent(true);
        onChange("");
      },
      isEmpty() {
        return editorRef.current?.isEmpty ?? true;
      },
    }));

    return (
      <div
        className={[
          "mini-editor",
          className,
          disabled ? "mini-editor--disabled" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="mini-editor__toolbar">
          {TOOL_GROUPS.map((t, i) =>
            t === null ? (
              <div key={`sep-${i}`} style={{ width:1, height:16, background:"var(--c-border)", margin:"0 3px", flexShrink:0 }} />
            ) : (
              <button
                key={t.icon}
                type="button"
                title={t.label}
                className={`mini-editor__btn${editor && t.isActive(editor) ? " is-active" : ""}`}
                style={t.style}
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (editor) t.run(editor);
                }}
                disabled={!editor || disabled}
              >
                {t.icon}
              </button>
            )
          )}
          <span className="mini-editor__hint">@ to mention · Ctrl+Enter to post</span>
        </div>

        <div className="mini-editor__body">
          {!hasSetContent && editor?.isEmpty && placeholder && (
            <div className="mini-editor__placeholder" aria-hidden>
              {placeholder}
            </div>
          )}
          <EditorContent editor={editor} />
        </div>
      </div>
    );
  },
);
MiniEditor.displayName = "MiniEditor";
