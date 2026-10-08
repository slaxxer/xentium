/**
 * Alignment belongs to ONE block.
 *
 * TipTap's Enter copies the block's attributes into the new block, so after aligning a
 * paragraph right, pressing Enter at its end started the NEXT paragraph right-aligned
 * too — every following line inherited it until someone noticed and reset it. A
 * member formats paragraph by paragraph, so a paragraph started from the end of an
 * aligned one starts at the default alignment.
 *
 * Splitting a paragraph in the MIDDLE keeps the alignment on both halves: that is the
 * same text, broken in two. Enter itself is untouched — this only arms on the way in
 * and lets every other handler (paragraphs, lists, task lists) do its usual work, then
 * resets the new, still-empty block in the same step.
 */
import { Extension } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";

const key = new PluginKey("alignPerBlock");

export const AlignPerBlock = Extension.create<Record<string, never>, { armed: boolean }>({
  name: "alignPerBlock",
  // Before the list and default keymaps, so it sees the block Enter is leaving.
  priority: 1000,

  addStorage() {
    return { armed: false };
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { $from, empty } = this.editor.state.selection;
        this.storage.armed = empty
          && !!$from.parent.attrs.textAlign
          && $from.parentOffset === $from.parent.content.size;
        return false; // never handled here — Enter does what it always did
      },
    };
  },

  addProseMirrorPlugins() {
    const storage = this.storage;
    return [
      new Plugin({
        key,
        appendTransaction(transactions, _old, state) {
          if (!storage.armed || !transactions.some((tr) => tr.docChanged)) return null;
          storage.armed = false;
          const { $from } = state.selection;
          const block = $from.parent;
          if (!block.isTextblock || block.content.size !== 0 || !block.attrs.textAlign) return null;
          const fresh = block.type.create().attrs.textAlign ?? null;
          if (block.attrs.textAlign === fresh) return null;
          return state.tr.setNodeMarkup($from.before(), undefined, { ...block.attrs, textAlign: fresh });
        },
      }),
    ];
  },
});
