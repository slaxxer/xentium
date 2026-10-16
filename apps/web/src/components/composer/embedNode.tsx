/**
 * A plugin embed in the text (a poll): a block that stores only a reference and is
 * drawn by the plugin that owns it (`slotRegistry.registerEmbed`).
 *
 * It writes exactly what the server's sanitizer allows (`shared/sanitize/richText.ts`):
 * `<div class="xt-embed" data-xt-embed="<type>" data-id="<id>"></div>`, and its
 * ProseMirror form `{ type: "xtEmbed", attrs: { type, id } }` is what the server
 * reads from an article body (`extractEmbeds` in contracts) — one rule for all three.
 *
 * Registered in every editor and in every renderer of stored editor JSON (the article
 * reader), or an embed would be dropped where the node is unknown. HTML surfaces
 * (forum posts) draw placeholders through `RichHtml` instead.
 */
import { Node, NodeViewWrapper, ReactNodeViewRenderer, mergeAttributes, type NodeViewProps } from "@tiptap/react";
import { EMBED_ID_RE, EMBED_NODE, EMBED_TYPE_RE } from "@xentium/contracts";
import { EmbedView } from "../EmbedView";

function EmbedNodeView({ node, selected }: NodeViewProps) {
  return (
    <NodeViewWrapper className={`xt-embed${selected ? " is-selected" : ""}`} data-drag-handle="">
      <EmbedView type={String(node.attrs.type ?? "")} id={String(node.attrs.id ?? "")} />
    </NodeViewWrapper>
  );
}

export const EmbedNode = Node.create({
  name: EMBED_NODE,
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    // Written by `renderHTML` below, never by TipTap's default attribute output.
    return {
      type: { default: "", renderHTML: () => ({}) },
      id:   { default: "", renderHTML: () => ({}) },
    };
  },

  parseHTML() {
    return [{
      tag: "div[data-xt-embed]",
      getAttrs: (el) => {
        const div = el as HTMLElement;
        const type = div.getAttribute("data-xt-embed") ?? "";
        const id = div.getAttribute("data-id") ?? "";
        return EMBED_TYPE_RE.test(type) && EMBED_ID_RE.test(id) ? { type, id } : false;
      },
    }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, {
      class: "xt-embed",
      "data-xt-embed": node.attrs.type,
      "data-id": node.attrs.id,
    })];
  },

  renderText() {
    return "";
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmbedNodeView);
  },
});
