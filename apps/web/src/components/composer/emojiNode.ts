/**
 * A custom emoji in the text: the image an admin uploaded (ACP → Content → Emojis),
 * inline, at text size.
 *
 * It writes exactly what the server's sanitizer allows (`shared/sanitize/richText.ts`):
 * `<img class="xt-emoji" src="/uploads/emojis/…" alt=":code:" title=":code:"
 * data-code="code">`. A post stores the image itself, not a reference, so retiring an
 * emoji never breaks a post that used it. In plain text (search, notifications) it is
 * `:code:`.
 *
 * Registered in every editor and in every renderer of stored editor JSON (the article
 * reader), or an emoji in a document would be dropped where the node is unknown.
 */
import { Node, mergeAttributes } from "@tiptap/react";

export interface EmojiAttrs { src: string; code: string }

export const EmojiNode = Node.create({
  name: "xtEmoji",
  inline: true,
  group: "inline",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    // Written by `renderHTML` below, never by TipTap's default (which would add a
    // stray `code="…"` attribute the sanitizer then has to strip).
    return {
      src:  { default: "", renderHTML: () => ({}) },
      code: { default: "", renderHTML: () => ({}) },
    };
  },

  parseHTML() {
    return [{
      tag: "img.xt-emoji",
      getAttrs: (el) => {
        const img = el as HTMLImageElement;
        return { src: img.getAttribute("src") ?? "", code: img.getAttribute("data-code") ?? "" };
      },
    }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const code = String(node.attrs.code ?? "");
    return ["img", mergeAttributes(HTMLAttributes, {
      class: "xt-emoji",
      src: node.attrs.src,
      alt: `:${code}:`,
      title: `:${code}:`,
      "data-code": code,
    })];
  },

  renderText({ node }) {
    return `:${node.attrs.code}:`;
  },
});
