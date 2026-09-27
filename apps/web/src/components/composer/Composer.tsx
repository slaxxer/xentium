/**
 * The Composer — one editor for every surface that writes something.
 *
 * It replaces `MiniEditor` (article comments, profile wall) and `ForumEditor`
 * (threads, replies, quick edit) — two components that had drifted into two
 * different toolbars, two placeholder mechanisms, two sets of glyph characters, and
 * mentions on only one of them. Both now render this.
 *
 * ⚠ THE SIGNATURE MOVE: the toolbar is at the BOTTOM, docked to the action bar
 * beside the button it serves. Writing starts at the top-left of the surface where
 * the cursor already is, chrome sits where the hands are, and at phone width the bar
 * lands above the keyboard instead of scrolling off the top.
 *
 * ⚠ Three variants, one component:
 *   `inline` — collapsed to a single row until it is needed (comments, the wall)
 *   `panel`  — always open, for a page whose whole job is this (a new thread)
 *   `dock`   — one row, formatting behind `Aa`, Enter sends (private messages)
 *
 * ⚠ The tool set is an ADMIN's choice, read from `/appearance/composer`. The bar
 * renders what the config puts there, the rest goes to the overflow tray, and a tool
 * switched off appears nowhere. See `useComposerConfig`.
 */
import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useEditor, EditorContent } from "@tiptap/react";
import type { AnyExtension, JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Mention from "@tiptap/extension-mention";
import TextAlign from "@tiptap/extension-text-align";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Highlight from "@tiptap/extension-highlight";
import Superscript from "@tiptap/extension-superscript";
import Subscript from "@tiptap/extension-subscript";
import Placeholder from "@tiptap/extension-placeholder";
import { FontAwesomeIcon } from "../Icon";
import {
  faEllipsis, faPaperPlane, faReply, faXmark, faFont, faAt, faPaperclip,
} from "@fortawesome/free-solid-svg-icons";
import type { ComposerToolId } from "@xentium/contracts";
import { useAuth } from "../../hooks/useAuth";
import { COMPOSER_TOOLS } from "./composerTools";
import { buildMentionSuggestion } from "./mentions";
import { BlockPicker, OverflowTray, LinkPopover, EmojiPicker } from "./popovers";
import { useComposerConfig } from "./useComposerConfig";
import "./Composer.scss";

export type ComposerVariant = "inline" | "panel" | "dock";

export interface ComposerHandle {
  /** The HTML, or "" when the document is empty. */
  getHTML:    () => string;
  /** The ProseMirror document — for a surface that STORES JSON (articles). */
  getJSON:    () => JSONContent | null;
  isEmpty:    () => boolean;
  setContent: (html: string) => void;
  clear:      () => void;
  focus:      () => void;
}

export interface ComposerProps {
  variant?:    ComposerVariant;
  onChange?:   (html: string) => void;
  placeholder?: string;
  initialHtml?: string;
  /**
   * ⚠ For a surface that stores ProseMirror JSON rather than HTML — articles. Their
   * reader renders the JSON with its own extension set, so the document must never
   * pass through HTML on the way to storage: that would drop any node the HTML
   * round-trip does not know. When given, it wins over `initialHtml`.
   */
  initialJson?: JSONContent | null;
  onChangeJson?: (json: JSONContent) => void;
  /** Nodes a surface needs beyond the shared set — an article's images. */
  extraExtensions?: AnyExtension[];
  /**
   * Off where the reader cannot draw a mention node (articles render with their own
   * extension set, which has none). Hides the tool and the hint as well. Default on.
   */
  mentions?:   boolean;
  disabled?:   boolean;
  /** Ctrl/⌘+Enter, and the primary button. */
  onSubmit?:   () => void;
  /** Shown on the primary button. Defaults to "Post". */
  submitLabel?: string;
  /** Rendered while a submit is in flight — the button also disables itself. */
  busy?:       boolean;
  /** Offered beside the primary button; absent means no Cancel. */
  onCancel?:   () => void;
  minHeight?:  number;
  className?:  string;
  /**
   * What is being replied to, as a dismissible strip.
   *
   * ⚠ Context, NOT pre-pasted markup in the body. Both old editors dropped the
   * quoted text into the document, so the first thing a member did was delete
   * someone else's words out of their own reply.
   */
  replyTo?:    { name: string; excerpt?: string } | null;
  onDismissReply?: () => void;
  /**
   * Does THIS surface have somewhere to put a file? Attachments exist only where a
   * plugin provides an endpoint, so the paperclip is disabled (with a reason in its
   * tooltip) everywhere else rather than promising an upload that cannot happen.
   */
  canAttach?:  boolean;
  onAttach?:   () => void;
  /** `dock` only: Enter sends, Shift+Enter is a newline. */
  enterSends?: boolean;
  /**
   * Does the action bar draw the primary button?
   *
   * ⚠ False for a caller that already has its own Post button outside the editor —
   * which is every existing surface, because both old editors were toolbar-plus-body
   * and nothing else. Ctrl+Enter still fires `onSubmit`; only the button is
   * suppressed, so a page cannot end up with two.
   */
  submitInBar?: boolean;
  /**
   * Where the tool row sits.
   *
   * ⚠ `bottom` is the redesign's default and the reason the composer exists: chrome
   * beside the button it serves, above the keyboard on a phone. `top` is for a
   * surface that is ALREADY a tall page of its own — the forum's thread composer,
   * whose canvas asks for it, where the body is 360px and a bottom bar would be a
   * screen away from the title you just typed. The bottom row becomes a status
   * strip there instead.
   */
  toolbarPosition?: "top" | "bottom";
  /** Words and characters, under the body. `panel` + `top` shows them by default. */
  showStats?: boolean;
}

/** ⌘ on a Mac, Ctrl everywhere else — the hint has to match the actual key. */
function shortcutLabel(): string {
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  return mac ? "⌘↵" : "Ctrl↵";
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer({
  variant = "panel",
  onChange, placeholder, initialHtml, initialJson, onChangeJson, extraExtensions, mentions = true,
  disabled, onSubmit, submitLabel, busy,
  onCancel, minHeight, className, replyTo, onDismissReply,
  canAttach, onAttach, enterSends, submitInBar = true,
  toolbarPosition = "bottom", showStats,
}, ref) {
  const { t } = useTranslation("common");
  const { user } = useAuth();
  const { config, tools: allTools } = useComposerConfig();
  const tools = useMemo(
    () => (mentions ? allTools : allTools.filter((x) => x.id !== "mention")),
    [allTools, mentions],
  );

  /** `inline` starts closed; every other variant is open from the start. */
  const [open, setOpen] = useState(variant !== "inline");
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [popover, setPopover] = useState<null | "overflow" | "link" | "emoji">(null);
  /** `dock` hides formatting behind `Aa` — chat first, editor second. */
  const [showTools, setShowTools] = useState(variant !== "dock");
  const prevInitial = useRef<string | undefined>(undefined);
  const prevJson = useRef<string | undefined>(undefined);

  /**
   * ⚠ `onSubmit` is read through a ref inside the key handler. TipTap builds its
   * keymap ONCE; a captured prop would keep calling the first render's submit, which
   * on a page that re-renders per keystroke means posting stale content.
   */
  const onChangeJsonRef = useRef(onChangeJson);
  onChangeJsonRef.current = onChangeJson;
  const submitRef = useRef(onSubmit);
  submitRef.current = onSubmit;
  const enterSendsRef = useRef(enterSends);
  enterSendsRef.current = enterSends;

  const editor = useEditor({
    extensions: [
      /**
       * ⚠ StarterKit 3.x ALREADY bundles Link and Underline, so adding the packages
       * again registered two extensions under one name — TipTap warns
       * "Duplicate extension names found: ['link','underline']" and the behaviour of
       * the loser is undefined. Both old editors did exactly this. Configured
       * through the kit instead.
       */
      StarterKit.configure({
        link: { openOnClick: false, autolink: true },
      }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight,
      Subscript,
      Superscript,
      Placeholder.configure({ placeholder: placeholder ?? t("composer.placeholder") }),
      /**
       * ⚠ Mentions on EVERY surface now, unless an admin switched them off. The
       * extension has to be present from the start: TipTap's extension list is fixed
       * at creation, so this reads the config's default rather than waiting for the
       * request and rebuilding the editor underneath the writer.
       */
      ...(extraExtensions ?? []),
      ...(mentions ? [Mention.configure({
        HTMLAttributes: {},
        renderHTML({ node }) {
          return ["a", {
            href: `/u/${node.attrs.id}`,
            class: "nvc-mention",
            "data-type": "mention",
            "data-id": node.attrs.id,
          }, `@${node.attrs.label ?? node.attrs.id}`];
        },
        renderText({ node }) { return `@${node.attrs.label ?? node.attrs.id}`; },
        suggestion: buildMentionSuggestion(),
      })] : []),
    ],
    content: initialJson ?? initialHtml ?? "",
    editable: !disabled,
    onUpdate: ({ editor: e }) => {
      onChange?.(e.isEmpty ? "" : e.getHTML());
      onChangeJsonRef.current?.(e.getJSON());
    },
    editorProps: {
      attributes: { class: "nvc-content" },
      handleKeyDown(_view, event) {
        const submit = submitRef.current;
        if (!submit) return false;
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          submit();
          return true;
        }
        // Chat convention, and only where it was asked for.
        if (enterSendsRef.current && event.key === "Enter" && !event.shiftKey) {
          submit();
          return true;
        }
        return false;
      },
    },
  });

  // Follow `initialHtml` when it changes — a quote inserted, an edit loaded.
  useEffect(() => {
    if (!editor || initialHtml === prevInitial.current) return;
    prevInitial.current = initialHtml;
    if (initialHtml) {
      editor.commands.setContent(initialHtml);
      onChange?.(editor.getHTML());
    }
  }, [editor, initialHtml, onChange]);

  // Follow `initialJson` the same way — an article loaded, a local draft restored.
  // ⚠ Compared as text and against what the editor already holds: the caller feeds
  // `onChangeJson` back in as `initialJson`, and resetting to the same document on
  // every keystroke would throw the caret to the end.
  useEffect(() => {
    if (!editor || initialJson == null) return;
    const next = JSON.stringify(initialJson);
    if (next === prevJson.current) return;
    prevJson.current = next;
    if (next !== JSON.stringify(editor.getJSON())) {
      editor.commands.setContent(initialJson, { emitUpdate: false });
    }
  }, [editor, initialJson]);

  // ⚠ `false`: setEditable() emits an update by default, so every mount — and every
  // save that disables the editor for a moment — reported the untouched document as
  // an edit. A surface comparing against what it saved (articles) then saw a change
  // that never happened and kept a local "unsaved draft" of it.
  useEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [editor, disabled]);

  useImperativeHandle(ref, () => ({
    getHTML:    () => (editor?.isEmpty ? "" : editor?.getHTML() ?? ""),
    getJSON:    () => editor?.getJSON() ?? null,
    isEmpty:    () => editor?.isEmpty ?? true,
    setContent: (html) => { editor?.commands.setContent(html); onChange?.(html); },
    clear:      () => {
      editor?.commands.clearContent(true);
      onChange?.("");
      /* ⚠ Back to one row. A caller clears after a successful post, and the inline
         variant's whole point is that it is not there until it is needed — leaving
         an empty open editor above the comment just written is the state the
         collapse exists to avoid. */
      if (variant === "inline") setOpen(false);
    },
    focus:      () => { setOpen(true); editor?.commands.focus(); },
  }));

  /** A tool the composer owns rather than the editor. */
  const runOwn = useCallback((id: ComposerToolId) => {
    if (id === "link")    { setPopover((p) => (p === "link" ? null : "link")); return; }
    if (id === "emoji")   { setPopover((p) => (p === "emoji" ? null : "emoji")); return; }
    if (id === "attach")  { onAttach?.(); return; }
    if (id === "mention") { editor?.chain().focus().insertContent("@").run(); return; }
  }, [editor, onAttach]);

  const barTools = useMemo(
    () => config.bar.filter((id) => tools.find((x) => x.id === id)?.where === "bar"),
    [config.bar, tools],
  );
  const hasOverflow = tools.some((x) => x.where === "overflow");
  const shortcut = shortcutLabel();
  const text  = editor?.getText() ?? "";
  const chars = text.length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  /* ── The action bar ─────────────────────────────────────────────────────── */

  const actionBar = (
    <div className={`nvc-bar nvc-bar--${toolbarPosition}${variant === "dock" ? " nvc-bar--dock" : ""}`}>
      {/* `dock` keeps the bar to one row until `Aa` is pressed. */}
      {variant === "dock" && (
        <button
          type="button"
          title={t("composer.formatting")}
          aria-label={t("composer.formatting")}
          aria-pressed={showTools}
          className={`nvc-bar__aa${showTools ? " is-on" : ""}`}
          onClick={() => setShowTools((v) => !v)}
        >
          <FontAwesomeIcon className="nvc-ic" icon={faFont} />
        </button>
      )}

      {showTools && (
        <>
          {variant !== "dock" && <BlockPicker editor={editor} disabled={disabled} />}
          {variant !== "dock" && <span className="nvc-bar__sep" />}

          {barTools.map((id) => {
            const tool = COMPOSER_TOOLS[id];
            const on  = !!(editor && tool.isActive?.(editor));
            const off = id === "attach" && !canAttach;
            const can = !off && (!editor || !tool.enabled || tool.enabled(editor));
            return (
              <button
                key={id}
                type="button"
                title={off ? t("composer.attachUnavailable") : t(`composer.tool.${id}`)}
                aria-label={t(`composer.tool.${id}`)}
                className={`nvc-bar__tool${on ? " is-on" : ""}`}
                disabled={disabled || !can}
                // ⚠ preventDefault on mousedown, or pressing a tool blurs the
                // editor and the command lands on no selection.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (tool.run && editor) tool.run(editor);
                  else runOwn(id);
                }}
              >
                <FontAwesomeIcon className="nvc-ic" icon={tool.icon} />
              </button>
            );
          })}

          {hasOverflow && (
            <div className="nvc-bar__more">
              <button
                type="button"
                title={t("composer.more")}
                aria-label={t("composer.more")}
                className={`nvc-bar__tool${popover === "overflow" ? " is-on" : ""}`}
                disabled={disabled}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setPopover((p) => (p === "overflow" ? null : "overflow"))}
              >
                <FontAwesomeIcon className="nvc-ic" icon={faEllipsis} />
              </button>
              {popover === "overflow" && (
                <OverflowTray
                  editor={editor}
                  tools={tools}
                  onClose={() => setPopover(null)}
                  onTool={(id) => { setPopover(null); runOwn(id); }}
                />
              )}
            </div>
          )}
        </>
      )}

      <span className="nvc-bar__gap" />

      {/* ⚠ On top, the mode toggle lives in the TOOL ROW. Floating it over the
          body's top-right corner put two controls in the same 40px. */}
      {toolbarPosition === "top" && variant !== "dock" && (
        <ModeToggle mode={mode} onMode={setMode} />
      )}

      {/* The dead "Ctrl+Enter to post" string became the button's own hint; the
          panel variant shows what it has instead. */}
      {/* ⚠ Only when the bar is the BOTTOM row. With the tools on top the status
          strip below the body already carries the count, and printing it twice is
          the duplication this redesign set out to remove. */}
      {variant === "panel" && toolbarPosition === "bottom" && chars > 0 && (
        <span className="nvc-bar__meta">{t("composer.chars", { count: chars })}</span>
      )}
      {variant === "dock" && (
        <span className="nvc-bar__meta nvc-bar__meta--hide-sm">{t("composer.enterSends")}</span>
      )}

      {submitInBar && onCancel && (
        <button type="button" className="nvc-btn" onClick={onCancel} disabled={busy}>
          {t("actions.cancel")}
        </button>
      )}

      {submitInBar && onSubmit && (variant === "dock"
        ? (
          <button
            type="button"
            className="nvc-send"
            title={submitLabel ?? t("composer.send")}
            aria-label={submitLabel ?? t("composer.send")}
            disabled={disabled || busy}
            onClick={onSubmit}
          >
            <FontAwesomeIcon className="nvc-ic" icon={faPaperPlane} />
          </button>
        )
        : (
          <button
            type="button"
            className="nvc-btn nvc-btn--primary"
            disabled={disabled || busy}
            onClick={onSubmit}
          >
            {busy ? t("composer.posting") : (submitLabel ?? t("composer.post"))}
            <span className="nvc-btn__kbd">{shortcut}</span>
          </button>
        ))}
    </div>
  );

  /**
   * The status strip: what the surface can do, and how much has been written.
   *
   * ⚠ Only when the toolbar is on TOP. With the bar at the bottom these hints are
   * already in it (the shortcut lives inside the button, the character count sits
   * beside it), and printing them twice is how the old editors ended up with a dead
   * "Ctrl+Enter to post" string nobody maintained.
   */
  const stats = (
    <div className="nvc-stats">
      {mentions && <span><FontAwesomeIcon className="nvc-ic" icon={faAt} />{t("composer.hintMention")}</span>}
      <span>
        <kbd>{shortcut.replace("↵", "")}</kbd><kbd>↵</kbd>{t("composer.hintPost")}
      </span>
      {canAttach && (
        <span><FontAwesomeIcon className="nvc-ic" icon={faPaperclip} />{t("composer.hintDrop")}</span>
      )}
      <span className="nvc-stats__count">
        {t("composer.words", { count: words })} · {t("composer.chars", { count: chars })}
      </span>
    </div>
  );

  /* ── Collapsed (inline, at rest) ────────────────────────────────────────── */

  if (variant === "inline" && !open) {
    const initials = user?.username?.slice(0, 2).toUpperCase() ?? "?";
    return (
      <button
        type="button"
        /* ⚠ NOT also `nvc`: that class is the open shell and sets
           `flex-direction: column`, which stood the collapsed row on its end. */
        className={`nvc--collapsed${className ? ` ${className}` : ""}`}
        onClick={() => { setOpen(true); setTimeout(() => editor?.commands.focus(), 0); }}
      >
        <span className="nvc-collapsed__av">
          {user?.avatar ? <img src={user.avatar} alt="" /> : initials}
        </span>
        <span className="nvc-collapsed__hint">{placeholder ?? t("composer.placeholder")}</span>
        {/* ⚠ The three affordances stay visible while collapsed: they are what says
            the box can do more than plain text. They are decoration here — the row
            itself opens the composer. */}
        <span className="nvc-collapsed__tools" aria-hidden>
          {(["attach", "emoji", "mention"] as ComposerToolId[])
            .filter((id) => tools.find((x) => x.id === id)?.where !== "off")
            .map((id) => (
              <span key={id} className="nvc-collapsed__tool">
                <FontAwesomeIcon className="nvc-ic" icon={COMPOSER_TOOLS[id].icon} />
              </span>
            ))}
        </span>
      </button>
    );
  }

  /* ── Open ───────────────────────────────────────────────────────────────── */

  return (
    <div
      className={[
        "nvc",
        `nvc--${variant}`,
        disabled ? "is-disabled" : "",
        className ?? "",
      ].filter(Boolean).join(" ")}
    >
      {/* Who is writing, and Write / Preview. The inline variant only. */}
      {variant === "inline" && (
        <div className="nvc-head">
          <span className="nvc-head__av">
            {user?.avatar
              ? <img src={user.avatar} alt="" />
              : (user?.username?.slice(0, 2).toUpperCase() ?? "?")}
          </span>
          <span className="nvc-head__as">
            {t("composer.writingAs")} <strong>{user?.username}</strong>
          </span>
          <span className="nvc-bar__gap" />
          <ModeToggle mode={mode} onMode={setMode} />
        </div>
      )}

      {replyTo && (
        <div className="nvc-reply">
          <FontAwesomeIcon className="nvc-ic" icon={faReply} />
          <span className="nvc-reply__text">
            {t("composer.replyingTo")} <strong>{replyTo.name}</strong>
            {replyTo.excerpt && <> — “{replyTo.excerpt}”</>}
          </span>
          {onDismissReply && (
            <button type="button" className="nvc-reply__x" onClick={onDismissReply}
              title={t("actions.cancel")} aria-label={t("actions.cancel")}>
              <FontAwesomeIcon className="nvc-ic" icon={faXmark} />
            </button>
          )}
        </div>
      )}

      {/* ⚠ The tool row goes ABOVE the body when asked for — see `toolbarPosition`. */}
      {toolbarPosition === "top" && (
        <div className={`nvc-dock nvc-dock--top`}>
          {actionBar}
          {popover === "link" && editor && (
            <div className="nvc-dock__pop"><LinkPopover editor={editor} onClose={() => setPopover(null)} /></div>
          )}
          {popover === "emoji" && (
            <div className="nvc-dock__pop">
              <EmojiPicker onClose={() => setPopover(null)}
                onPick={(emoji) => editor?.chain().focus().insertContent(emoji).run()} />
            </div>
          )}
        </div>
      )}

      {/* ⚠ The editable element is only as tall as its text, while `minHeight` makes
          the BOX taller: a click in the empty lower part of the box landed on this
          div and focused nothing. A press on the body itself (never on the text, the
          mode toggle or a popover) puts the caret at the end instead. */}
      <div
        className="nvc-body"
        style={minHeight ? { minHeight } : undefined}
        onMouseDown={(e) => {
          if (mode !== "write" || !editor) return;
          const el = e.target as HTMLElement;
          if (el !== e.currentTarget && !el.classList.contains("nvc-editor")) return;
          e.preventDefault();
          editor.commands.focus("end");
        }}
      >
        {/* The panel variant floats the toggle over the body — it has no header.
            Not when the tools are on top: it sits in that row instead. */}
        {variant === "panel" && toolbarPosition === "bottom" && (
          <div className="nvc-body__mode">
            <ModeToggle mode={mode} onMode={setMode} />
          </div>
        )}

        {mode === "write"
          ? <EditorContent editor={editor} className="nvc-editor" />
          : (
            /**
             * ⚠ The preview renders the editor's OWN html, which TipTap produced from
             * its schema — not free text from a user. The server sanitises again on
             * write (`sanitizeRichText`), which is where the real boundary is.
             */
            <div
              className="nvc-preview"
              dangerouslySetInnerHTML={{
                __html: editor?.isEmpty
                  ? `<p class="nvc-preview__empty">${t("composer.previewEmpty")}</p>`
                  : (editor?.getHTML() ?? ""),
              }}
            />
          )}
      </div>

      {toolbarPosition === "bottom" ? (
        <div className="nvc-dock nvc-dock--bottom">
          {actionBar}
          {popover === "link" && editor && (
            <div className="nvc-dock__pop">
              <LinkPopover editor={editor} onClose={() => setPopover(null)} />
            </div>
          )}
          {popover === "emoji" && (
            <div className="nvc-dock__pop">
              <EmojiPicker
                onClose={() => setPopover(null)}
                onPick={(emoji) => editor?.chain().focus().insertContent(emoji).run()}
              />
            </div>
          )}
        </div>
      ) : (showStats ?? true) && stats}
    </div>
  );
});

/** Write / Preview. Shared by the two variants that have room for it. */
function ModeToggle({ mode, onMode }: { mode: "write" | "preview"; onMode: (m: "write" | "preview") => void }) {
  const { t } = useTranslation("common");
  return (
    <span className="nvc-modes" role="tablist">
      {(["write", "preview"] as const).map((m) => (
        <button
          key={m}
          type="button"
          role="tab"
          aria-selected={mode === m}
          className={`nvc-modes__btn${mode === m ? " is-on" : ""}`}
          onClick={() => onMode(m)}
        >
          {t(`composer.${m}`)}
        </button>
      ))}
    </span>
  );
}
