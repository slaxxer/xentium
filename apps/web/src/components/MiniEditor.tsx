/**
 * `MiniEditor` — now a thin adapter over `Composer`.
 *
 * ⚠ THE NAME AND THE PROPS ARE THE CONTRACT. This module is a host global
 * (`__XENTIUM_HOST__.webMiniEditor`) that BUILT plugin bundles import — the messaging
 * plugin's conversation and new-message pages among them. A shipped bundle cannot be
 * edited from this repo, so the export keeps its name, its props and its handle, and
 * every one of those surfaces gets the redesigned editor with no plugin rebuild.
 *
 * The same reasoning as `AutosaveStatus` → `SaveChip`: replace the implementation,
 * keep the import path.
 *
 * ⚠ `variant="inline"` — this is the comments-and-wall editor, which is the variant
 * that collapses to one row until it is needed.
 */
import { forwardRef, useImperativeHandle, useRef, type ReactNode } from "react";
import { Composer, type ComposerHandle, type ComposerVariant } from "./composer/Composer";

export interface MiniEditorHandle {
  clear:   () => void;
  isEmpty: () => boolean;
}

interface MiniEditorProps {
  onChange: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
  onSubmit?: () => void;
  className?: string;
  /** Pre-fill on mount, or when the value changes. */
  initialHtml?: string;
  /**
   * Opt into another presentation.
   *
   * ⚠ New, and optional, so SHIPPED bundles are unaffected: they pass nothing and
   * keep the panel. The messaging plugin's conversation view is the one that wants
   * `dock` (one row, Enter sends) — it gets it at its next rebuild, without any
   * change here.
   */
  variant?: ComposerVariant;
  /** `dock`: Enter sends, Shift+Enter is a newline. */
  enterSends?: boolean;
  /** Passed to the Composer: what Preview shows (e.g. a post card). */
  renderPreview?: (html: string) => ReactNode;
}

export const MiniEditor = forwardRef<MiniEditorHandle, MiniEditorProps>(
  ({ onChange, placeholder, disabled, onSubmit, className, initialHtml,
     variant = "panel", enterSends, renderPreview }, ref) => {
    const inner = useRef<ComposerHandle>(null);

    // The old two-method handle, forwarded onto the composer's larger one.
    useImperativeHandle(ref, () => ({
      clear:   () => inner.current?.clear(),
      isEmpty: () => inner.current?.isEmpty() ?? true,
    }));

    return (
      <Composer
        ref={inner}
        /**
         * ⚠ `panel` by default, not `inline`. These callers draw their OWN submit
         * button outside the editor and expect a box that is open and ready —
         * collapsing would hide the editor behind a click they never asked their
         * users for. The inline variant is opt-in, through `Composer` directly.
         */
        variant={variant}
        enterSends={enterSends}
        renderPreview={renderPreview}
        onChange={onChange}
        placeholder={placeholder}
        initialHtml={initialHtml}
        disabled={disabled}
        onSubmit={onSubmit}
        className={className}
        minHeight={104}
        /* The caller's own Post button stays where it is; Ctrl+Enter still posts. */
        submitInBar={false}
        /* No endpoint to attach to on a comment, a wall post or a private message. */
        canAttach={false}
      />
    );
  },
);
MiniEditor.displayName = "MiniEditor";
