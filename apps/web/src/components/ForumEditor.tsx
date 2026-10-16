/**
 * `ForumEditor` — now a thin adapter over `Composer`.
 *
 * ⚠ THE NAME AND THE PROPS ARE THE CONTRACT. This module is a host global
 * (`__XENTIUM_HOST__.webForumEditor`) that BUILT plugin bundles import — the forum
 * plugin's new-thread, thread-reply and post-edit pages. A shipped bundle cannot be
 * edited from this repo, so the export keeps its name, its props and its four-method
 * handle, and all three surfaces get the redesigned editor with no plugin rebuild.
 *
 * ⚠ `canAttach` is TRUE here, because the forum does have an attachment endpoint —
 * but only once the post exists (`POST /posts/:id/attachments`), so the forum's own
 * page keeps owning the upload and the composer's paperclip only asks it to start.
 * A caller that passes no `onAttach` gets a disabled paperclip with a reason.
 */
import { forwardRef, useImperativeHandle, useRef } from "react";
import { Composer, type ComposerHandle } from "./composer/Composer";

export interface ForumEditorHandle {
  getHTML:    () => string;
  isEmpty:    () => boolean;
  setContent: (html: string) => void;
  clear:      () => void;
}

interface ForumEditorProps {
  onChange?:   (html: string) => void;
  placeholder?: string;
  initialHtml?: string;
  disabled?:   boolean;
  minHeight?:  number;
  onSubmit?:   () => void;
  /** New in the redesign, and optional: a caller that has an upload path says so. */
  onAttach?:   () => void;
  /** New in the redesign: the quote strip, instead of markup pasted into the body. */
  replyTo?:    { name: string; excerpt?: string } | null;
  onDismissReply?: () => void;
}

export const ForumEditor = forwardRef<ForumEditorHandle, ForumEditorProps>(
  ({ onChange, placeholder, initialHtml, disabled, minHeight = 160, onSubmit,
     onAttach, replyTo, onDismissReply }, ref) => {
    const inner = useRef<ComposerHandle>(null);

    useImperativeHandle(ref, () => ({
      getHTML:    () => inner.current?.getHTML() ?? "",
      isEmpty:    () => inner.current?.isEmpty() ?? true,
      setContent: (html) => inner.current?.setContent(html),
      clear:      () => inner.current?.clear(),
    }));

    return (
      <Composer
        ref={inner}
        variant="panel"
        onChange={onChange}
        placeholder={placeholder}
        initialHtml={initialHtml}
        // Every caller of this adapter writes a forum post (threads, replies, edits).
        surface="forum.post"
        disabled={disabled}
        minHeight={minHeight}
        onSubmit={onSubmit}
        replyTo={replyTo}
        onDismissReply={onDismissReply}
        onAttach={onAttach}
        canAttach={!!onAttach}
        /* Every forum surface draws its own Post / Save button already. */
        submitInBar={false}
      />
    );
  },
);
ForumEditor.displayName = "ForumEditor";
