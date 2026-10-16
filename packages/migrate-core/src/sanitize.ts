import sanitizeHtml from "sanitize-html";
import { toEditorHtml } from "./editorHtml.js";

/**
 * Prepares an imported forum post or private message for storage.
 *
 * Two steps. First the post is reshaped into exactly the HTML our editor saves
 * (toEditorHtml), so it looks and edits like a native post. Then it is sanitized: the
 * forum sanitizes a post when a member saves it and renders the stored HTML as is, and
 * imported posts skip that save path. Without this, a `[URL=javascript:…]` in an old
 * board's BBCode would become a live script link.
 *
 * The allowlist mirrors core's rich-text sanitizer for what the editor emits: no plain
 * images (the editor keeps only our own emoji images in posts), safe link protocols.
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "hr", "strong", "b", "em", "i", "u", "s", "del",
    "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "code", "a", "ul", "ol", "li",
  ],
  allowedAttributes: { a: ["href", "target", "rel"], ol: ["start"], pre: ["class"], code: ["class"] },
  allowedClasses: { pre: [/^language-[\w-]+$/], code: [/^language-[\w-]+$/] },
  allowedSchemes: ["http", "https", "mailto"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
};

export function sanitizeImportedPost(html: string): string {
  return sanitizeHtml(toEditorHtml(html), OPTIONS);
}
